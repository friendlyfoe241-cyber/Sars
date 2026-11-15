"""Common analysis-result format.

One structured document per completed analysis so the web frontend renders
results without knowing how any event module produced them.  Everything is
taken from the pipeline outputs; nothing is invented here.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from .analysis import ChangeResult
from .config import AnalysisRequest
from .pipeline import RunResult

EARTH_RADIUS_M = 6_371_008.8


def bbox_area_km2(bbox: tuple[float, float, float, float]) -> float:
    """Total area of a lon/lat bbox on a spherical Earth (analytic, exact for
    the sphere): R^2 * dLon * (sin latN - sin latS)."""
    west, south, east, north = bbox
    return (EARTH_RADIUS_M ** 2 * math.radians(east - west)
            * (math.sin(math.radians(north)) - math.sin(math.radians(south)))) / 1e6


def _finite(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _stats(result: ChangeResult) -> dict:
    return {k: _finite(v) if isinstance(v, float) else v for k, v in result.stats.items()}


def area_estimates(result: ChangeResult, request: AnalysisRequest) -> dict:
    s = result.stats
    return {
        "aoi_area_km2": round(bbox_area_km2(request.bbox), 3),
        "valid_analysed_area_km2": round(s["analysed_area_km2"], 3),
        "candidate_changed_area_km2": round(s["changed_area_km2"], 4),
        "candidate_changed_area_hectares": round(s["changed_area_km2"] * 100, 2),
        "candidate_changed_percent_of_valid": round(s["changed_percent"], 3),
        "candidate_changed_percent_of_aoi": round(
            100.0 * s["changed_area_km2"] / bbox_area_km2(request.bbox), 3),
        "valid_pixels": s["valid_pixels"],
        "changed_pixels": s["changed_pixels"],
        "note": ("Areas are computed from the number and physical size of valid classified "
                 "pixels in the analysis projection. Changed areas are threshold-dependent "
                 "estimates ('candidate' disturbance), not confirmed land-cover change."),
    }


def build_result(analysis_id: str, request: AnalysisRequest, run: RunResult,
                 *, status: str = "succeeded", errors: list[str] | None = None) -> dict:
    """The document returned to the frontend for one analysis run."""
    meta = run.metadata
    method = meta["processing"]
    return {
        "analysisId": analysis_id,
        "eventType": request.event_type,
        "status": status,
        "generatedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": meta["mode"],
        "areaOfInterest": {
            "bboxWestSouthEastNorth": list(request.bbox),
            "areaKm2": round(bbox_area_km2(request.bbox), 3),
        },
        "observations": meta["source_granules"],
        "selectionExplanation": meta.get("selection_explanation"),
        "acquisitionDates": {
            "before": request.before_date.isoformat(),
            "after": request.after_date.isoformat(),
            **meta["observation_dates"],
        },
        "productMetadata": {
            "productType": "NISAR L2 GCOV",
            "processingLevel": "GCOV",
            "frequencyBand": "L-band",
            "polarisation": request.polarisation,
            "cmrVerification": meta.get("cmr_verification"),
            "retrieval": meta.get("retrieval"),
        },
        "processing": {
            "status": status,
            "eventMethod": method["event_method"],
            "methodSummary": method["method_summary"],
            "methodParameters": method["thresholds"],
            "inputUnits": method["input_units"],
            "unitsOfResults": method["units_of_results"],
            "alignment": method["alignment"],
            "analysisGrid": method["analysis_grid"],
            "analysisGridDecimation": method.get("analysis_grid_decimation"),
            "quality": {
                "validPixels": run.result.stats["valid_pixels"],
                "validFraction": _finite(run.result.stats["valid_fraction"]),
                "overlapFraction": _finite(method["alignment"].get("overlap_fraction", None)
                                           if isinstance(method["alignment"], dict) else None),
                "speckleFiltering": method["speckle_filtering"],
            },
        },
        "statistics": _stats(run.result),
        "backscatterComparison": run.result.backscatter_table.to_dict("records"),
        "changeSummary": run.result.classification_table.to_dict("records"),
        "areaEstimates": area_estimates(run.result, request),
        "rasters": {name: path.name for name, path in run.paths.items()},
        "artifacts": sorted(p.name for p in run.paths.values()),
        "apisUsed": meta.get("apis_used", {}),
        "limitations": meta["limitations"],
        "errors": errors or [],
    }
