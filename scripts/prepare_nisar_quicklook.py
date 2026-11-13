#!/usr/bin/env python3
"""Prepare the study-area rasters shipped with this application from public
NISAR browse quicklooks.

This script is the pipeline used to build ``public/data/`` in this repository.
It uses only publicly accessible artefacts (no Earthdata login required):

  * CMR / asf_search granule metadata (product identifiers, dates, geometry)
  * ASF browse quicklook PNGs and their KML ground-overlay quads
    https://nisar.asf.earthdatacloud.nasa.gov/BROWSE/<collection>/<scene>/...

The quicklook PNGs are 8-bit renderings of the GCOV C11 (HHHH) / C22 (HVHV)
layers produced by the NISAR ground system.  They are genuine NISAR
observations, but they are *display renderings*, not calibrated backscatter:
the unit of every value is "quicklook display DN" (0 = nodata).  The
calibrated path (sigma0 in dB from the GCOV HDF5 files) is implemented
separately in prepare_nisar_gcov.py and requires an Earthdata login.

Usage:
    python prepare_nisar_quicklook.py [--out ../../public/data]

Outputs:
    <out>/manifest.json
    <out>/observations/before_HH.png  before_HV.png  after_HH.png  after_HV.png
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Dataset configuration.  This is the only section that changes when the
# study area or the acquisition pair changes.
# --------------------------------------------------------------------------

BROWSE_BASE = "https://nisar.asf.earthdatacloud.nasa.gov/BROWSE"
COLLECTION = "NISAR_L2_GCOV_V1"  # VALIDATED L2 geocoded observables

GRANULES = {
    "before": "NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_20261025T034327_P05036_N_F_J_001",
    "after": "NISAR_L2_PR_GCOV_035_014_A_005_2005_DHDH_A_20261106T034253_20261106T034327_P05036_N_F_J_001",
}

# Quicklook channel suffix -> polarisation label
CHANNELS = {
    "HH": "NATIVE_A_HHHH",
    "HV": "NATIVE_A_HVHV",
}

# Study window (west, south, east, north) in degrees.
STUDY_WINDOW = (28.30, 6.90, 29.45, 8.00)

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

OUTPUT_WIDTH_PX = 700


# --------------------------------------------------------------------------
# Download helpers
# --------------------------------------------------------------------------

def fetch(url: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size > 0:
        return
    print(f"  fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "nisar-surface-change/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dst, "wb") as fh:
        fh.write(resp.read())


def quicklook_url(scene: str, filename: str) -> str:
    return f"{BROWSE_BASE}/{COLLECTION}/{scene}/{filename}"


def parse_quad(kml_path: Path) -> list[tuple[float, float]]:
    """Return the LatLonQuad corners as (lon, lat) in SW, SE, NE, NW order."""
    root = ET.parse(kml_path).getroot()
    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    text = None
    for el in root.iter():
        if el.tag.endswith("coordinates") and el.text:
            text = el.text.strip()
    if text is None:
        raise ValueError(f"no coordinates found in {kml_path}")
    corners = []
    for pair in text.split():
        lon, lat = pair.split(",")[:2]
        corners.append((float(lon), float(lat)))
    if len(corners) != 4:
        raise ValueError(f"expected 4 corners in {kml_path}, got {len(corners)}")
    return corners


# --------------------------------------------------------------------------
# Geocoding: resample the quicklook (image rect <-> KML quad) onto a regular
# lat/lon grid over the study window, using an inverse bilinear mapping.
# --------------------------------------------------------------------------

def resample_to_window(img: np.ndarray, quad, window, out_w: int):
    (west, south, east, north) = window
    sw, se, ne, nw = (np.array(c) for c in quad)
    h_img, w_img = img.shape

    aspect = (east - west) * math.cos(math.radians((south + north) / 2)) / (north - south)
    out_h = int(round(out_w / aspect))
    lons = np.linspace(west, east, out_w)
    lats = np.linspace(north, south, out_h)  # row 0 = north (KML images are north-up)
    LON, LAT = np.meshgrid(lons, lats)

    # Newton iterations for the inverse bilinear map lon/lat -> (u, v) in [0,1]^2
    u = (LON - sw[0]) / (ne[0] - sw[0])
    v = (LAT - sw[1]) / (ne[1] - sw[1])
    for _ in range(40):
        p = (
            ((1 - u) * (1 - v))[:, :, None] * sw
            + (u * (1 - v))[:, :, None] * se
            + (u * v)[:, :, None] * ne
            + ((1 - u) * v)[:, :, None] * nw
        )
        dpdu = (1 - v)[:, :, None] * (se - sw) + v[:, :, None] * (ne - nw)
        dpdv = (1 - u)[:, :, None] * (nw - sw) + u[:, :, None] * (ne - se)
        det = dpdu[:, :, 0] * dpdv[:, :, 1] - dpdu[:, :, 1] * dpdv[:, :, 0]
        dx = LON - p[:, :, 0]
        dy = LAT - p[:, :, 1]
        du = (dx * dpdv[:, :, 1] - dy * dpdv[:, :, 0]) / det
        dv = (dpdu[:, :, 0] * dy - dpdu[:, :, 1] * dx) / det
        u = u + du
        v = v + dv
        # Newton converges quadratically (2-4 steps for these near-affine
        # quads); stop once the correction is far below one source pixel.
        if max(np.abs(du).max(), np.abs(dv).max()) < 1e-12:
            break

    px = u * (w_img - 1)
    py = (1 - v) * (h_img - 1)
    x0 = np.clip(np.round(px).astype(int), 0, w_img - 1)
    y0 = np.clip(np.round(py).astype(int), 0, h_img - 1)
    out = img[y0, x0]
    outside = (px < 0) | (px > w_img - 1) | (py < 0) | (py > h_img - 1)
    out[outside] = 0
    out[out < 0] = 0
    return out.astype(np.uint8), out_h


# --------------------------------------------------------------------------
# Metadata from asf_search (public CMR search)
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "public" / "data"))
    ap.add_argument("--cache", default=str(Path(__file__).resolve().parent / ".cache"))
    args = ap.parse_args()
    out_dir = Path(args.out)
    cache = Path(args.cache)

    # ---- 1. metadata (public search, no credentials) --------------------
    print("querying granule metadata")
    meta = {role: granule_metadata(scene) for role, scene in GRANULES.items()}

    for key in ("collectionName", "pathNumber", "frameNumber", "flightDirection",
                "polarisations", "processingLevel", "crid", "processingSoftwareVersion"):
        if meta["before"][key] != meta["after"][key]:
            print(f"WARNING: acquisitions differ in {key}: "
                  f"{meta['before'][key]} vs {meta['after'][key]}", file=sys.stderr)

    def parse_time(iso: str) -> datetime:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))

    baseline_days = (parse_time(meta["after"]["startTime"]) -
                     parse_time(meta["before"]["startTime"])).days
    print(f"temporal baseline: {baseline_days} days")

    # ---- 2. download quicklooks + georeferencing quads ------------------
    frames = {}
    for role, scene in GRANULES.items():
        print(f"downloading quicklooks for {role} acquisition")
        for pol, suffix in CHANNELS.items():
            png = cache / f"{scene}_{suffix}.png"
            kml = cache / f"{scene}_{suffix}.kml"
            fetch(quicklook_url(scene, f"{scene}_{suffix}.png"), png)
            fetch(quicklook_url(scene, f"{scene}_{suffix}.kml"), kml)
            frames[(role, pol)] = (np.asarray(Image.open(png).convert("L")), parse_quad(kml))

    # the two acquisitions must share the same imaging geometry
    quad_before = frames[("before", "HH")][1]
    for key, (img, quad) in frames.items():
        if max(abs(a - b) for pa, pb in zip(quad, quad_before) for a, b in zip(pa, pb)) > 1e-6:
            raise SystemExit(f"geometry mismatch for {key}: quicklooks are not comparable")
        if img.shape != frames[("before", "HH")][0].shape:
            raise SystemExit(f"raster size mismatch for {key}")

    # ---- 3. resample to the study window --------------------------------
    out_w = OUTPUT_WIDTH_PX
    grids = {}
    out_h = None
    for (role, pol), (img, quad) in frames.items():
        grid, out_h = resample_to_window(img, quad, STUDY_WINDOW, out_w)
        grids[(role, pol)] = grid

    obs_dir = out_dir / "observations"
    obs_dir.mkdir(parents=True, exist_ok=True)
    for (role, pol), grid in grids.items():
        path = obs_dir / f"{role}_{pol}.png"
        Image.fromarray(grid, mode="L").save(path, optimize=True)
        print(f"wrote {path}")

    # ---- 4. change scale (display parameter, derived from the data) -----
    valid = np.ones_like(grids[("before", "HH")], dtype=bool)
    for key in (("before", "HH"), ("after", "HH")):
        valid &= grids[key] > 0
    diff = grids[("after", "HH")][valid].astype(np.int16) - grids[("before", "HH")][valid].astype(np.int16)
    saturation = int(round(float(np.percentile(np.abs(diff), 98)) / 5.0) * 5)
    saturation = max(saturation, 10)
    print(f"change colour scale saturation: +/-{saturation} DN (98th pct of |diff|, HH)")

    # ---- 5. manifest ----------------------------------------------------
    west, south, east, north = STUDY_WINDOW
    pixel_size_m = (east - west) * 111_320 * math.cos(math.radians((south + north) / 2)) / out_w
    boundary = [[west, south], [east, south], [east, north], [west, north], [west, south]]

    manifest = {
        "schemaVersion": 1,
        "generatedBy": "scripts/prepare_nisar_quicklook.py",
        "dataset": {
            "status": "nisar_quicklook",
            "source": "NASA/ISRO NISAR L2 GCOV (geocoded observables), archived by NASA ASF DAAC",
            "access": (
                "Granule metadata from CMR; displayed rasters are the public ASF "
                "browse quicklooks of the GCOV C11 (HHHH) and C22 (HVHV) layers."
            ),
            "limitations": [
                "Displayed values are 8-bit quicklook renderings (display DN), not calibrated backscatter in dB.",
                "The change layer is a difference of those display values; it preserves the sign of change under the shared quicklook rendering but its magnitude is not sigma0.",
                "Quicklook resolution is about %d m per pixel, coarser than the native GCOV posting." % round(pixel_size_m),
                "Calibrated sigma0/dB rasters require the GCOV HDF5 products (Earthdata login); see scripts/prepare_nisar_gcov.py.",
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
            "maturity": "VALIDATED" if COLLECTION == "NISAR_L2_GCOV_V1" else "PROVISIONAL",
            "crid": meta["before"]["crid"],
            "processingSoftwareVersion": meta["before"]["processingSoftwareVersion"],
            "orbitDirection": meta["before"]["flightDirection"],
            "path": meta["before"]["pathNumber"],
            "frame": meta["before"]["frameNumber"],
            "polarisations": list(CHANNELS.keys()),
            "temporalBaselineDays": baseline_days,
            "earlier": meta["before"],
            "later": meta["after"],
        },
        "encoding": {
            "type": "quicklook_dn",
            "unit": "display DN",
            "nodata": 0,
            "description": (
                "8-bit ASF browse quicklook rendering of the GCOV C11 (HH) / C22 (HV) "
                "layers; monotonic with calibrated backscatter under the shared "
                "quicklook rendering. 0 marks nodata / outside the observation footprint."
            ),
        },
        "changeScale": {
            "saturation": saturation,
            "unit": "display DN",
            "description": "Colour scale saturates at +/- this value; derived from the 98th percentile of |after - before| for HH.",
        },
        "rasters": {
            pol: {
                "layer": "C11 (HHHH)" if pol == "HH" else "C22 (HVHV)",
                "before": f"observations/before_{pol}.png",
                "after": f"observations/after_{pol}.png",
            }
            for pol in CHANNELS
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
