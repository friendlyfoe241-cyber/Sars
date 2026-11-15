"""Orchestration: request -> discovery -> selection -> retrieval -> alignment ->
analysis -> files.

Service roles
  ASF Search   discovery of granules (metadata)
  CMR          verification of the chosen granules + concept IDs/variable names (metadata)
  Harmony      spatial + variable subsetting and delivery of float GeoTIFF data
Credentials are only read inside retrieval.get_client().

The search / cmr / retrieve / reader callables are injectable so the
orchestration can be tested without network access.
"""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from . import discovery, events, outputs, raster, retrieval
from .analysis import ChangeResult
from .config import AnalysisRequest
from .errors import UnsupportedEventError
from .selection import SelectedPair, select_pair

# Analysis runs on a subsampled grid when the requested area would exceed this
# many pixels (every k-th pixel, no smoothing), so that peak memory stays
# bounded on small hosts (e.g. a 512 MB container): a 100 x 100 km AOI at the
# native 20 m is 25M pixels = 100 MB *per array*.  The result reports the
# analysis grid's actual pixel size.  Override with NISAR_MAX_ANALYSIS_PIXELS.
MAX_ANALYSIS_PIXELS = int(os.environ.get("NISAR_MAX_ANALYSIS_PIXELS", "6000000"))

API_ROLES = {
    "ASF Search API": "discovery of NISAR L2 GCOV granules and their metadata",
    "NASA CMR": "verification of selected granules; collection/granule concept IDs; variable names",
    "NASA Harmony": "bbox + polarisation-layer subsetting; delivers the float GeoTIFF data",
}


@dataclass
class RunResult:
    stats: dict
    paths: dict
    metadata: dict
    selection: SelectedPair | None
    result: ChangeResult


def _versions() -> dict:
    out = {"python": platform.python_version()}
    for name in ("numpy", "pandas", "rasterio", "harmony"):
        try:
            mod = __import__(name)
            out[name] = getattr(mod, "__version__", "unknown")
        except ImportError:
            out[name] = None
    return out


def _require_supported(event_type: str):
    """Raise before any network or file work if the event has no implemented method."""
    method = events.get_method(event_type)
    if not method.supported:
        raise UnsupportedEventError(
            f"'{method.name}' analysis is not implemented, and the deforestation method must "
            f"not be reused for it. What it needs: {method.requirements}")
    return method


def _decimation_note(decimated: raster.Raster, factor: int) -> dict:
    px = decimated.pixel_size_m()
    return {
        "factor": factor,
        "reason": (f"the requested area has {decimated.data.size * factor * factor} pixels at the "
                   f"product resolution; analysis runs on every {factor}-th pixel so that memory "
                   f"use stays bounded (limit: {MAX_ANALYSIS_PIXELS} pixels)"),
        "native_pixel_size_m_approx": [round(px[0] / factor, 3), round(px[1] / factor, 3)],
        "analysis_pixel_size_m_approx": [round(px[0], 3), round(px[1], 3)],
        "sampling": "subsampled (values are untouched product pixels; no smoothing)",
    }


def _fit_grid(before: raster.Raster, after: raster.Raster,
              max_pixels: int | None = None):
    """Subsample both rasters to fit `max_pixels` (same factor for both, so
    co-registered grids stay co-registered).  Returns (before, after, note)."""
    cap = MAX_ANALYSIS_PIXELS if max_pixels is None else max_pixels
    factor = raster.decimation_factor(before.data.size, cap)
    if factor <= 1:
        return before, after, None
    before = raster.decimate(before, factor)
    after = raster.decimate(after, factor)
    return before, after, _decimation_note(before, factor)


def _read_pair(reader, path_b, path_a, units: str):
    """Read two rasters with the decimation applied at read time when the
    reader supports it, so peak memory stays bounded for large files."""
    k = 1
    try:
        k = max(raster.decimation_factor(raster.peek_pixels(path_b), MAX_ANALYSIS_PIXELS),
                raster.decimation_factor(raster.peek_pixels(path_a), MAX_ANALYSIS_PIXELS))
    except Exception:
        pass  # a non-file reader (test double); run_from_rasters fits the grid in memory
    try:
        before = reader(path_b, units, decimate=k)
        after = reader(path_a, units, decimate=k)
    except TypeError:
        # a reader that does not support decimation: run_from_rasters will
        # subsample the returned arrays in memory and record the note
        return reader(path_b, units), reader(path_a, units), None
    return before, after, (_decimation_note(before, k) if k > 1 else None)


def _analyse(request: AnalysisRequest, before: raster.Raster, after: raster.Raster):
    method = _require_supported(request.event_type)
    after_aligned, align_info = raster.align_pair(
        before, after, request.resampling, request.min_overlap_fraction)
    result = method.analyse(before, after_aligned, request)
    return method, result, align_info


def _metadata(request, method, result, before, align_info, *, granules, selection_text,
              cmr, retrieval_info, mode, decimation=None) -> dict:
    return {
        "schema_version": 1,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "request": request.to_dict(),
        "location": {"bbox_west_south_east_north": list(request.bbox)},
        "observation_dates": {"requested_before": request.before_date.isoformat(),
                              "requested_after": request.after_date.isoformat()},
        "polarisation": request.polarisation,
        "source_granules": granules,
        "selection_explanation": selection_text,
        "cmr_verification": cmr,
        "retrieval": retrieval_info,
        "processing": {
            "event_method": method.name,
            "method_summary": method.summary,
            "input_units": request.input_units,
            "units_of_results": "dB (10*log10 of linear power)",
            "thresholds": {"change_db": request.thresholds.change_db,
                           "direction": request.thresholds.direction,
                           "db_valid_min": request.thresholds.db_valid_min,
                           "db_valid_max": request.thresholds.db_valid_max},
            "alignment": align_info,
            "analysis_grid": before.grid_info(),
            "analysis_grid_decimation": decimation,
            "speckle_filtering": "none",
        },
        "apis_used": API_ROLES if mode == "api" else {},
        "limitations": events.GENERAL_LIMITATIONS + method.limitations,
        "software": _versions(),
    }


def run_from_rasters(request: AnalysisRequest, before: raster.Raster, after: raster.Raster,
                     out_dir, *, pixel_csv_max=None, write_geotiff=True, granules=None,
                     selection_text=None, cmr=None, retrieval_info=None,
                     mode="rasters", decimation=None) -> RunResult:
    request.validate()
    before, after, fit_note = _fit_grid(before, after)
    method, result, align_info = _analyse(request, before, after)
    meta = _metadata(request, method, result, before, align_info, granules=granules,
                     selection_text=selection_text, cmr=cmr, retrieval_info=retrieval_info,
                     mode=mode, decimation=fit_note or decimation)
    paths = outputs.write_all(result, before, meta, Path(out_dir), pixel_csv_max=pixel_csv_max,
                              write_geotiff=write_geotiff)
    return RunResult(result.stats, paths, meta, None, result)


def run_from_files(request: AnalysisRequest, before_tif, after_tif, out_dir, **kw) -> RunResult:
    """Compare two float GeoTIFFs you already have (e.g. earlier Harmony downloads)."""
    request.validate()
    _require_supported(request.event_type)
    before, after, decimation = _read_pair(raster.read_geotiff, before_tif, after_tif,
                                           request.input_units)
    return run_from_rasters(
        request, before, after, out_dir, mode="local_files", decimation=decimation,
        granules={"note": "local files supplied by the user; no catalogue metadata",
                  "before_file": str(before_tif), "after_file": str(after_tif)}, **kw)


def run_analysis(request: AnalysisRequest, out_dir, *, cache_dir=None, pixel_csv_max=None,
                 write_geotiff=True, search=discovery.search_asf, cmr=discovery.cmr_lookup,
                 retrieve=retrieval.retrieve_subset, reader=raster.read_geotiff) -> RunResult:
    """Full pipeline against the live NASA services."""
    request.validate()
    _require_supported(request.event_type)  # fail early for unsupported events (no network use)

    tol = timedelta(days=request.date_tolerance_days)
    start = datetime.combine(request.before_date, time.min, tzinfo=timezone.utc) - tol
    end = datetime.combine(request.after_date, time.max, tzinfo=timezone.utc) + tol
    granules = search(request.bbox, start, end)

    selection = select_pair(granules, request)
    cmr_info = {"before": cmr(selection.before), "after": cmr(selection.after)}
    warnings_ = [f"CMR start time for {role} granule differs from ASF's."
                 for role, info in cmr_info.items() if info.get("start_time_matches_asf") is False]

    cache = Path(cache_dir) if cache_dir else Path(out_dir) / ".cache"
    pol = request.polarisation
    tif_b, info_b = retrieve(selection.before, request.bbox, pol, cache, cmr_info["before"])
    tif_a, info_a = retrieve(selection.after, request.bbox, pol, cache, cmr_info["after"])
    before, after, decimation = _read_pair(reader, tif_b, tif_a, request.input_units)

    text = selection.explanation + warnings_
    run = run_from_rasters(
        request, before, after, out_dir, pixel_csv_max=pixel_csv_max, write_geotiff=write_geotiff,
        granules={"before": selection.before.to_dict(), "after": selection.after.to_dict()},
        selection_text=text, cmr=cmr_info,
        retrieval_info={"before": info_b, "after": info_a}, mode="api", decimation=decimation)
    run.selection = selection
    return run
