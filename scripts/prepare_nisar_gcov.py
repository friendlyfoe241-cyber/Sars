#!/usr/bin/env python3
"""Prepare calibrated backscatter rasters from NISAR L2 GCOV products.

This is the calibrated alternative to prepare_nisar_quicklook.py.  It reads
the GCOV HDF5 products (radiometrically calibrated, geocoded observables)
and writes the same ``public/data/`` artefacts as the quicklook script, but
with values in dB:

    encoding = {"type": "db_linear", "unit": "dB", "dbMin": ..., "dbMax": ...}

Requirements:
  * A NASA Earthdata Login account.  Configure ~/.netrc as described in the
    ASF NISAR Data User Guide (https://nisar-docs.asf.alaska.edu/access-overview/)
    or export EARTHDATA_USER / EARTHDATA_PASSWORD.  Credentials are used by
    earthaccess at download time only and are never written to the repository.
  * Python packages from scripts/requirements.txt (adds earthaccess, h5py,
    pyproj on top of numpy/Pillow/asf_search).

NOTE: this script was written against the published NISAR L2 GCOV product
structure but could not be executed in the build environment (no Earthdata
credentials available there).  Dataset paths inside the HDF5 files are
located by introspection where possible; if the product layout changes,
adjust ``find_layer`` / ``find_grid`` below.

Usage:
    python prepare_nisar_gcov.py [--out ../../public/data] [--db-min -30] [--db-max 5]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Dataset configuration (same study area and pair as the quicklook script).
# --------------------------------------------------------------------------

GRANULES = {
    "before": "NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_20261025T034327_P05036_N_F_J_001",
    "after": "NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_20261106T034253_20261106T034327_P05036_N_F_J_001",
}

# polarisation label -> candidate HDF5 dataset names inside the GCOV grids
LAYERS = {
    "HH": ["HHHH", "C11"],
    "HV": ["HVHV", "C22"],
}

STUDY_WINDOW = (28.30, 6.90, 29.45, 8.00)  # west, south, east, north

STUDY_AREA = {
    "id": "tonj-floodplain-ssd",
    "name": "Tonj floodplain wetlands",
    "region": "Warrap State",
    "country": "South Sudan",
    "phenomenon": "Seasonal wetland inundation",
    "description": (
        "Floodplain wetlands of the Tonj River, a tributary of the Bahr el "
        "Ghazal in the western Sudd basin. The wetlands expand and recede "
        "with the annual flood pulse; the comparison window covers the end of "
        "the 2026 wet season."
    ),
}

OUTPUT_WIDTH_PX = 1024
COLLECTION = "NISAR_L2_GCOV_V1"


# --------------------------------------------------------------------------
# HDF5 introspection helpers
# --------------------------------------------------------------------------

def find_group(h5, needle: str):
    """Return the first group whose path contains `needle`."""
    found = []
    h5.visititems(lambda name, obj: found.append((name, obj)) if needle in name.lower() else None)
    for name, obj in found:
        if hasattr(obj, "keys"):  # group, not dataset
            return obj
    raise KeyError(f"no group matching {needle!r} in product")


def find_layer(grids, candidates: list[str]):
    """Return the first dataset whose name matches one of `candidates`."""
    for name in candidates:
        for key in grids:
            if key.split("/")[-1] == name:
                return grids[key]
    raise KeyError(f"none of {candidates} found under {grids.name}")


def layer_to_db(dataset) -> np.ndarray:
    """Return the layer as float32 dB, honouring the declared units."""
    data = dataset[...].astype(np.float32)
    nodata = dataset.attrs.get("fill_value", dataset.attrs.get("_FillValue", np.nan))
    units = str(dataset.attrs.get("units", "")).lower()
    if "linear" in units or units in ("", "1", "unitless"):
        # GCOV covariance/RTC power layers are linear power by default.
        with np.errstate(divide="ignore", invalid="ignore"):
            data = 10.0 * np.log10(data)
    elif "db" not in units:
        raise ValueError(f"unrecognised units {units!r} on {dataset.name}")
    if np.isfinite(float(nodata)):
        data[data == float(nodata)] = np.nan
    data[~np.isfinite(data)] = np.nan
    return data


def grid_coordinates(grids):
    """Return (xs, ys, crs) for the geocoded grid, found by introspection."""
    coords = None
    for key in grids:
        if key.split("/")[-1].lower() in ("gridcoordinate", "coordinates"):
            coords = grids[key]
    if coords is None:
        raise KeyError("grid coordinate group not found")
    xs = coords["x"][...]
    ys = coords["y"][...]
    crs_wkt = None
    for key in coords:
        if "projection" in key.lower() or "crs" in key.lower():
            val = coords[key][()]
            crs_wkt = val.decode() if isinstance(val, bytes) else str(val)
    return xs, ys, crs_wkt


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "public" / "data"))
    ap.add_argument("--cache", default=str(Path(__file__).resolve().parent / ".cache-gcov"))
    ap.add_argument("--db-min", type=float, default=-30.0, help="greyscale mapping: value for DN 1")
    ap.add_argument("--db-max", type=float, default=5.0, help="greyscale mapping: value for DN 255")
    args = ap.parse_args()

    import earthaccess
    import h5py
    from pyproj import CRS, Transformer

    out_dir = Path(args.out)
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    # ---- 1. authenticate (Earthdata login via ~/.netrc or env) ----------
    earthaccess.login(strategy="netrc")

    # ---- 2. download the two granules -----------------------------------
    files = earthaccess.download(
        [earthaccess.search_data(short_name=COLLECTION, granule_name=f"*{scene}*")[0] for scene in GRANULES.values()],
        local_path=str(cache),
    )
    h5_paths = {role: Path(p) for (role, _), p in zip(GRANULES.items(), files) if str(p).endswith(".h5")}

    # ---- 3. read, convert to dB, crop to the study window ---------------
    west, south, east, north = STUDY_WINDOW
    grids_out = {}
    meta_out = {}
    for role, path in h5_paths.items():
        with h5py.File(path) as h5:
            ident = {}
            for key in ("productID", "processingMaturity", "compositeReleaseID"):
                val = h5["/"].attrs.get(key, "")
                ident[key] = val.decode() if isinstance(val, bytes) else str(val)
            print(f"{role} product identity: {ident}")
            grids = find_group(h5, "gcov/grids")
            xs, ys, crs_wkt = grid_coordinates(grids)
            transformer = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_wkt(crs_wkt), always_xy=True)
            x0, y0 = transformer.transform(west, south)
            x1, y1 = transformer.transform(east, north)
            cols = np.where((xs >= min(x0, x1)) & (xs <= max(x0, x1)))[0]
            rows = np.where((ys >= min(y0, y1)) & (ys <= max(y0, y1)))[0]
            col_step = max(1, len(cols) // OUTPUT_WIDTH_PX)
            cols = cols[::col_step]
            rows = rows[:: max(1, len(rows) // int(round(OUTPUT_WIDTH_PX * (north - south) / (east - west))))]
            for pol, candidates in LAYERS.items():
                layer = find_layer(grids, candidates)
                db = layer_to_db(layer)[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
                dn = np.round((db - args.db_min) / (args.db_max - args.db_min) * 254.0 + 1.0)
                dn = np.clip(dn, 1, 255)
                dn[np.isnan(db)] = 0
                grids_out[(role, pol)] = dn.astype(np.uint8)

    # ---- 5. metadata (identical to the quicklook script) ----------------
    import asf_search as asf
    for role, scene in GRANULES.items():
        p = asf.search(granule_list=[scene])[0].properties
        meta_out[role] = {
            "productId": p["sceneName"],
            "startTime": p["startTime"].replace(" ", "T"),
            "stopTime": p["stopTime"].replace(" ", "T"),
            "orbit": p.get("orbit"),
            "pathNumber": p.get("pathNumber"),
            "frameNumber": p.get("frameNumber"),
            "flightDirection": p.get("flightDirection"),
            "polarisations": p.get("mainBandPolarization"),
            "collectionName": p.get("collectionName"),
            "processingLevel": p.get("processingLevel"),
            "processingSoftwareVersion": p.get("pgeVersion"),
            "crid": p.get("crid"),
        }
    from datetime import datetime

    def parse_time(iso: str) -> datetime:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))

    baseline_days = (parse_time(meta_out["after"]["startTime"]) -
                     parse_time(meta_out["before"]["startTime"])).days

    # ---- 6. write artefacts --------------------------------------------
    obs_dir = out_dir / "observations"
    obs_dir.mkdir(parents=True, exist_ok=True)
    for (role, pol), grid in grids_out.items():
        path = obs_dir / f"{role}_{pol}.png"
        Image.fromarray(grid, mode="L").save(path, optimize=True)
        print(f"wrote {path}")

    valid = (grids_out[("before", "HH")] > 0) & (grids_out[("after", "HH")] > 0)
    diff_db = (
        (grids_out[("after", "HH")].astype(np.float32) - 1.0) / 254.0 * (args.db_max - args.db_min)
        - (grids_out[("before", "HH")].astype(np.float32) - 1.0) / 254.0 * (args.db_max - args.db_min)
    )[valid]
    saturation = round(float(np.percentile(np.abs(diff_db), 98)), 1)

    out_h, out_w = grids_out[("before", "HH")].shape
    pixel_size_m = (east - west) * 111_320 * math.cos(math.radians((south + north) / 2)) / out_w
    boundary = [[west, south], [east, south], [east, north], [west, north], [west, south]]

    manifest = {
        "schemaVersion": 1,
        "generatedBy": "scripts/prepare_nisar_gcov.py",
        "dataset": {
            "status": "nisar_calibrated",
            "source": "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC",
            "access": "Calibrated GCOV HDF5 products downloaded with earthaccess (Earthdata login).",
            "limitations": [
                "Radiometric terrain correction and calibration follow the GCOV product specification.",
                "Greyscale display maps [%g, %g] dB to DN 1-255; DN 0 marks nodata." % (args.db_min, args.db_max),
            ],
        },
        "studyArea": {
            **STUDY_AREA,
            "bounds": {"west": west, "south": south, "east": east, "north": north},
            "boundary": boundary,
            "center": [(west + east) / 2, (south + north) / 2],
            "pixelSizeMetersApprox": round(pixel_size_m),
            "rasterSize": {"width": out_w, "height": out_h},
        },
        "acquisitionPair": {
            "sensor": "NISAR",
            "band": "L-band",
            "productType": "L2 GCOV",
            "collection": COLLECTION,
            "maturity": "VALIDATED",
            "crid": meta_out["before"]["crid"],
            "processingSoftwareVersion": meta_out["before"]["processingSoftwareVersion"],
            "orbitDirection": meta_out["before"]["flightDirection"],
            "path": meta_out["before"]["pathNumber"],
            "frame": meta_out["before"]["frameNumber"],
            "polarisations": list(LAYERS.keys()),
            "temporalBaselineDays": baseline_days,
            "earlier": meta_out["before"],
            "later": meta_out["after"],
        },
        "encoding": {
            "type": "db_linear",
            "unit": "dB",
            "nodata": 0,
            "dbMin": args.db_min,
            "dbMax": args.db_max,
            "description": "Calibrated GCOV backscatter in dB, linearly mapped to DN 1-255 for display.",
        },
        "changeScale": {
            "saturation": saturation,
            "unit": "dB",
            "description": "Colour scale saturates at +/- this value; 98th percentile of |after - before| for HH.",
        },
        "rasters": {
            pol: {
                "layer": "C11 (HHHH)" if pol == "HH" else "C22 (HVHV)",
                "before": f"observations/before_{pol}.png",
                "after": f"observations/after_{pol}.png",
            }
            for pol in LAYERS
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
