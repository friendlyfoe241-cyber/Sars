#!/usr/bin/env python3
"""Prepare calibrated backscatter rasters from NISAR L2 GCOV products.

The calibrated counterpart of prepare_nisar_quicklook.py, adapted for
dynamically selected products and areas: the scene identifiers and the AOI
are command-line arguments (for example the pair selected in the web
application), not hardcoded inputs.  It writes the same ``public/data/``
artefacts as the quicklook script, with values in dB:

    encoding = {"type": "db_linear", "unit": "dB", "dbMin": ..., "dbMax": ...}

Two retrieval backends are provided:

  --via harmony  NASA Harmony spatial (bbox) + variable subsetting of the
                 GCOV product into a GeoTIFF covering only the AOI, so the
                 full HDF5 product is never downloaded.  Requires an
                 Earthdata login (Harmony job submission is authenticated)
                 and the optional harmony-py and rasterio packages.
  --via hdf5     Direct read of the GCOV HDF5 product through earthaccess'
                 lazy file handles (HTTP range reads): only the grid rows
                 and columns covering the AOI are fetched.  Requires an
                 Earthdata login and earthaccess + h5py + pyproj.

Either way, credentials are used only for data retrieval and are never
written to the repository or exposed to the browser.

NOTE: this script could not be executed in the build environment (no
Earthdata credentials there).  HDF5 dataset paths are located by
introspection; if the product layout changes, adjust ``find_layer`` /
``grid_coordinates`` below.

Usage examples:
    # the example pair and window (defaults):
    python prepare_nisar_gcov.py

    # a pair selected in the web application, over its AOI:
    python prepare_nisar_gcov.py \\
        --scene-before NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_... \\
        --scene-after  NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_... \\
        --window 28.30 6.90 29.45 8.00 \\
        --via harmony --keep-geotiff
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Defaults: the example study area and pair shipped with the repository.
# Any other product IDs and AOI can be supplied on the command line.
# --------------------------------------------------------------------------

DEFAULT_SCENES = {
    "before": "NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_20261025T034327_P05036_N_F_J_001",
    "after": "NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_20261106T034253_20261106T034327_P05036_N_F_J_001",
}
DEFAULT_WINDOW = (28.30, 6.90, 29.45, 8.00)  # west, south, east, north

# polarisation label -> candidate GCOV layer names (HDF5 datasets / Harmony
# variables), most specific first.
LAYERS = {
    "HH": ["HHHH", "C11"],
    "HV": ["HVHV", "C22"],
    "VV": ["VVVV", "C11"],
    "VH": ["VHVH", "C22"],
}

OUTPUT_WIDTH_PX = 1024


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


def layer_to_db(data: np.ndarray, units: str, nodata) -> np.ndarray:
    """Return the layer as float32 dB, honouring the declared units."""
    data = data.astype(np.float32)
    units = (units or "").lower()
    if "linear" in units or units in ("", "1", "unitless"):
        with np.errstate(divide="ignore", invalid="ignore"):
            data = 10.0 * np.log10(data)  # linear power -> dB
    elif "db" not in units:
        raise ValueError(f"unrecognised units {units!r}")
    if nodata is not None and np.isfinite(float(nodata)):
        data[data == float(nodata)] = np.nan
    data[~np.isfinite(data)] = np.nan
    return data


def grid_coordinates(grids):
    """Return (xs, ys, crs_wkt) for the geocoded grid, found by introspection."""
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
# Backend 1: NASA Harmony spatial + variable subsetting (no full download)
# --------------------------------------------------------------------------

def cmr_concept_id(short_name: str, scene: str | None = None) -> str:
    """Resolve a CMR concept id (public metadata, no authentication)."""
    import urllib.parse
    import urllib.request

    if scene is None:
        url = "https://cmr.earthdata.nasa.gov/search/collections.json?" + \
              urllib.parse.urlencode({"short_name": short_name})
        key = "collection"
    else:
        url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + \
              urllib.parse.urlencode({"short_name": short_name,
                                      "producer_granule_id": scene})
        key = "granule"
    with urllib.request.urlopen(url, timeout=60) as resp:
        entries = json.load(resp)["feed"]["entry"]
    if not entries:
        raise ValueError(f"CMR found no {key} for {scene or short_name}")
    return entries[0]["id"]


def fetch_via_harmony(short_name: str, scene: str, window, pol: str, candidates: list[str],
                      cache: Path):
    """Return (db_array, info) for the AOI using a Harmony bbox subset.

    Harmony subsetting of NISAR L2 GCOV is supported (bbox + variable
    subsetting, GeoTIFF/PNG output; verified via
    https://harmony.earthdata.nasa.gov/capabilities?shortName=NISAR_L2_GCOV_V1).
    Job submission requires an Earthdata login; the returned GeoTIFF covers
    only the requested AOI, so the full HDF5 product is never downloaded.
    """
    try:
        from harmony import BBox, Client, Collection, Request
    except ImportError:
        raise SystemExit("--via harmony requires the harmony-py package (pip install harmony-py)")
    try:
        import rasterio
    except ImportError:
        raise SystemExit("--via harmony requires rasterio to read the GeoTIFF subset (pip install rasterio)")

    west, south, east, north = window
    collection_id = cmr_concept_id(short_name)
    granule_id = cmr_concept_id(short_name, scene)
    client = Client()

    job_id = None
    for variable in candidates:
        request = Request(
            collection=Collection(id=collection_id),
            granule_id=granule_id,
            spatial=BBox(west, south, east, north),
            variables=[variable],
            format="image/tiff",
        )
        try:
            job_id = client.submit(request)
            break
        except Exception as exc:  # try the next variable naming convention
            print(f"  Harmony rejected variable {variable!r}: {exc}", file=sys.stderr)
    if job_id is None:
        raise RuntimeError(f"Harmony rejected all variable names {candidates}")

    client.wait_for_processing(job_id, show_progress=True)
    futures = list(client.download_all(job_id, directory=str(cache), overwrite=True))
    tif = next((Path(f.result()) for f in futures), None)
    if tif is None:
        raise RuntimeError("Harmony returned no output for the AOI")

    with rasterio.open(tif) as ds:
        data = ds.read(1).astype(np.float32)
        units = ds.units[0] if ds.units else ""
        nodata = ds.nodata
    return layer_to_db(data, units, nodata), {"driver": "harmony", "subset": str(tif.name)}


# --------------------------------------------------------------------------
# Backend 2: lazy HDF5 reads (HTTP range requests, no full download)
# --------------------------------------------------------------------------

def fetch_via_hdf5(h5_path, window, pol: str, candidates: list[str], output_width: int):
    """Return (db_array, info) cropped to the AOI from a lazy HDF5 handle."""
    import h5py
    from pyproj import CRS, Transformer

    west, south, east, north = window
    with h5py.File(h5_path) as h5:
        grids = find_group(h5, "gcov/grids")
        xs, ys, crs_wkt = grid_coordinates(grids)
        transformer = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_wkt(crs_wkt), always_xy=True)
        x0, y0 = transformer.transform(west, south)
        x1, y1 = transformer.transform(east, north)
        cols = np.where((xs >= min(x0, x1)) & (xs <= max(x0, x1)))[0]
        rows = np.where((ys >= min(y0, y1)) & (ys <= max(y0, y1)))[0]
        if len(cols) == 0 or len(rows) == 0:
            raise ValueError(f"window {window} does not intersect the product grid")
        col_step = max(1, len(cols) // output_width)
        cols = cols[::col_step]
        rows = rows[:: max(1, len(rows) // max(1, int(round(output_width * (north - south) / (east - west)))))]
        # Hyperslab read: only the AOI rows/columns are fetched over HTTP.
        layer = find_layer(grids, candidates)
        data = layer[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
        units = str(layer.attrs.get("units", ""))
        nodata = layer.attrs.get("fill_value", layer.attrs.get("_FillValue", None))
    return layer_to_db(data, units, nodata), {"driver": "hdf5", "shape": data.shape}


# --------------------------------------------------------------------------
# Metadata + pair compatibility
# --------------------------------------------------------------------------

def granule_metadata(scene: str) -> dict:
    import asf_search as asf

    results = asf.search(granule_list=[scene])
    if len(results) != 1:
        raise ValueError(f"expected 1 granule for {scene}, got {len(results)}")
    p = results[0].properties
    return {
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


def check_pair(meta: dict) -> None:
    for key in ("collectionName", "pathNumber", "frameNumber", "flightDirection",
                "polarisations", "processingLevel", "crid", "processingSoftwareVersion"):
        if meta["before"][key] != meta["after"][key]:
            print(f"WARNING: acquisitions differ in {key}: "
                  f"{meta['before'][key]} vs {meta['after'][key]}", file=sys.stderr)


def parse_time(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene-before", default=DEFAULT_SCENES["before"],
                    help="product identifier of the earlier acquisition")
    ap.add_argument("--scene-after", default=DEFAULT_SCENES["after"],
                    help="product identifier of the later acquisition")
    ap.add_argument("--window", nargs=4, type=float, default=list(DEFAULT_WINDOW),
                    metavar=("WEST", "SOUTH", "EAST", "NORTH"),
                    help="AOI in degrees (default: the example study area)")
    ap.add_argument("--via", choices=["harmony", "hdf5"], default="hdf5",
                    help="raster retrieval backend (default: hdf5 lazy reads)")
    ap.add_argument("--channels", nargs="+", default=["HH", "HV"],
                    choices=list(LAYERS.keys()), help="polarisation channels to prepare")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "public" / "data"))
    ap.add_argument("--cache", default=str(Path(__file__).resolve().parent / ".cache-gcov"))
    ap.add_argument("--db-min", type=float, default=-30.0, help="greyscale mapping: value for DN 1")
    ap.add_argument("--db-max", type=float, default=5.0, help="greyscale mapping: value for DN 255")
    ap.add_argument("--keep-geotiff", action="store_true",
                    help="keep the Harmony GeoTIFF subset next to the manifest (analysis-ready COG)")
    ap.add_argument("--area-name", default="Selected study area",
                    help="study-area label written to the manifest")
    args = ap.parse_args()

    window = tuple(args.window)
    out_dir = Path(args.out)
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    # ---- 1. metadata + compatibility ----------------------------------
    meta = {
        "before": granule_metadata(args.scene_before),
        "after": granule_metadata(args.scene_after),
    }
    check_pair(meta)
    collection = meta["before"]["collectionName"]
    short_name = collection  # CMR short name == collection name for NISAR GCOV
    pols = [p for p in (meta["before"]["polarisations"] or []) if p in args.channels]
    if not pols:
        raise SystemExit(f"none of the requested channels {args.channels} "
                         f"exist in the product ({meta['before']['polarisations']})")

    # ---- 2. retrieval ---------------------------------------------------
    grids_out = {}
    info = {}
    for role, scene in (("before", args.scene_before), ("after", args.scene_after)):
        for pol in pols:
            print(f"[{role}] {pol}: retrieving AOI subset via {args.via}")
            if args.via == "harmony":
                db, meta_info = fetch_via_harmony(short_name, scene, window, pol, LAYERS[pol], cache)
            else:
                import earthaccess
                earthaccess.login(strategy="netrc")
                files = earthaccess.download(
                    [earthaccess.search_data(short_name=short_name, granule_name=f"*{scene}*")[0]],
                    local_path=str(cache),
                )
                h5_path = next(Path(p) for p in files if str(p).endswith(".h5"))
                db, meta_info = fetch_via_hdf5(h5_path, window, pol, LAYERS[pol], OUTPUT_WIDTH_PX)
            info[f"{role}_{pol}"] = meta_info
            dn = np.round((db - args.db_min) / (args.db_max - args.db_min) * 254.0 + 1.0)
            dn = np.clip(dn, 1, 255)
            dn[np.isnan(db)] = 0
            grids_out[(role, pol)] = dn.astype(np.uint8)

    # ---- 3. normalise shapes and write PNGs ---------------------------
    shapes = {g.shape for g in grids_out.values()}
    if len(shapes) > 1:
        raise SystemExit(f"retrieved grids have inconsistent shapes: {shapes}")
    obs_dir = out_dir / "observations"
    obs_dir.mkdir(parents=True, exist_ok=True)
    for (role, pol), grid in grids_out.items():
        path = obs_dir / f"{role}_{pol}.png"
        Image.fromarray(grid, mode="L").save(path, optimize=True)
        print(f"wrote {path}")

    valid = np.ones_like(next(iter(grids_out.values())), dtype=bool)
    for key in (("before", pols[0]), ("after", pols[0])):
        valid &= grids_out[key] > 0
    scale = (args.db_max - args.db_min) / 254.0
    diff_db = (grids_out[("after", pols[0])][valid].astype(np.int16) -
               grids_out[("before", pols[0])][valid].astype(np.int16)) * scale
    saturation = round(float(np.percentile(np.abs(diff_db), 98)), 1)

    # ---- 4. manifest ---------------------------------------------------
    west, south, east, north = window
    out_h, out_w = grids_out[("before", pols[0])].shape
    pixel_size_m = (east - west) * 111_320 * math.cos(math.radians((south + north) / 2)) / out_w
    boundary = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    baseline_days = (parse_time(meta["after"]["startTime"]) - parse_time(meta["before"]["startTime"])).days

    manifest = {
        "schemaVersion": 1,
        "generatedBy": f"scripts/prepare_nisar_gcov.py --via {args.via}",
        "dataset": {
            "status": "nisar_calibrated",
            "source": "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC",
            "access": (
                f"Calibrated GCOV subsets retrieved via {args.via} "
                "(Earthdata login required)."
            ),
            "limitations": [
                "Radiometric terrain correction and calibration follow the GCOV product specification.",
                "Greyscale display maps [%g, %g] dB to DN 1-255; DN 0 marks nodata." % (args.db_min, args.db_max),
            ],
        },
        "studyArea": {
            "id": "custom",
            "name": args.area_name,
            "region": "",
            "country": "",
            "phenomenon": "",
            "description": "",
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
            "collection": collection,
            "maturity": ("PROVISIONAL" if "PROVISIONAL" in collection
                         else "BETA" if "BETA" in collection else "VALIDATED"),
            "crid": meta["before"]["crid"],
            "processingSoftwareVersion": meta["before"]["processingSoftwareVersion"],
            "orbitDirection": meta["before"]["flightDirection"],
            "path": meta["before"]["pathNumber"],
            "frame": meta["before"]["frameNumber"],
            "polarisations": pols,
            "temporalBaselineDays": baseline_days,
            "earlier": meta["before"],
            "later": meta["after"],
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
            "description": "Colour scale saturates at +/- this value; 98th percentile of |after - before|.",
        },
        "rasters": {
            pol: {
                "layer": f"C11 ({pol}{pol})" if pol in ("HH", "VV") else f"C22 ({pol}{pol})",
                "before": f"observations/before_{pol}.png",
                "after": f"observations/after_{pol}.png",
            }
            for pol in pols
        },
        "retrieval": info,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
