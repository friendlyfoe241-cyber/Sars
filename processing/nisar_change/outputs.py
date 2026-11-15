"""Write result files: CSV tables, JSON, GeoTIFF change map, metadata."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .analysis import ChangeResult
from .errors import MissingDependencyError
from .raster import Raster


def _clean(obj):
    """Make an object strictly JSON-safe (NaN/inf -> null, numpy -> python)."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def write_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(_clean(payload), indent=2, allow_nan=False) + "\n")
    return path


def write_csv_tables(result: ChangeResult, out_dir: Path) -> dict[str, Path]:
    paths = {
        "backscatter_csv": out_dir / "backscatter_comparison.csv",
        "classification_csv": out_dir / "change_summary.csv",
    }
    result.backscatter_table.to_csv(paths["backscatter_csv"], index=False, float_format="%.6g")
    result.classification_table.to_csv(paths["classification_csv"], index=False,
                                       float_format="%.6g")
    return paths


def write_pixel_csv(result: ChangeResult, grid: Raster, out_dir: Path, max_rows: int) -> Path:
    """Per-pixel table (valid pixels only), evenly subsampled to at most `max_rows`."""
    rows, cols = np.nonzero(result.valid)
    if len(rows) > max_rows:
        idx = np.linspace(0, len(rows) - 1, max_rows).astype(np.int64)
        rows, cols = rows[idx], cols[idx]
    a, _, c, _, e, f = grid.transform
    df = pd.DataFrame({
        "row": rows, "col": cols,
        "x": c + (cols + 0.5) * a, "y": f + (rows + 0.5) * e,
        "before_db": result.before_db[rows, cols],
        "after_db": result.after_db[rows, cols],
        "difference_db": result.diff_db[rows, cols],
        "classified_changed": result.changed[rows, cols].astype(int),
    })
    path = out_dir / "pixels.csv"
    df.to_csv(path, index=False, float_format="%.5g")
    return path


def write_change_map(result: ChangeResult, grid: Raster, out_dir: Path) -> Path:
    """4-band float32 GeoTIFF on the analysis grid: before_db, after_db, difference_db,
    classified_changed (1/0, NaN where invalid)."""
    try:
        import rasterio
        from rasterio.transform import Affine
    except ImportError as exc:  # pragma: no cover
        raise MissingDependencyError(
            "rasterio is required to write the GeoTIFF change map (pip install rasterio)") from exc
    cls = result.changed.astype(np.float32)
    cls[~result.valid] = np.nan
    bands = [("before_db", result.before_db), ("after_db", result.after_db),
             ("difference_db", result.diff_db), ("classified_changed", cls)]
    path = out_dir / "change_map.tif"
    with rasterio.open(path, "w", driver="GTiff", height=grid.shape[0], width=grid.shape[1],
                       count=4, dtype="float32", crs=grid.crs_wkt,
                       transform=Affine(*grid.transform), nodata=np.nan, compress="deflate") as ds:
        for i, (name, arr) in enumerate(bands, start=1):
            ds.write(np.asarray(arr, dtype=np.float32), i)
            ds.set_band_description(i, name)
    return path


def write_all(result: ChangeResult, grid: Raster, metadata: dict, out_dir: Path, *,
              pixel_csv_max: int | None = None, write_geotiff: bool = True) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = write_csv_tables(result, out_dir)

    paths["results_json"] = write_json(out_dir / "results.json", {
        "schema_version": 1,
        "statistics": result.stats,
        "backscatter_comparison": result.backscatter_table.to_dict("records"),
        "change_summary": result.classification_table.to_dict("records"),
        "note": ("'measured' rows come directly from radar values; 'classification' and "
                 "'estimate' rows depend on the threshold and are not ground truth."),
    })
    if write_geotiff:
        paths["change_map_tif"] = write_change_map(result, grid, out_dir)
    if pixel_csv_max:
        paths["pixels_csv"] = write_pixel_csv(result, grid, out_dir, pixel_csv_max)

    paths["metadata_json"] = write_json(out_dir / "metadata.json", metadata)
    return paths
