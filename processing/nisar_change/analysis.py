"""Numerical change analysis on two co-registered dB arrays.

Pure NumPy/pandas: no I/O and no network, so it is fully testable with
synthetic data.

Every table row carries a `kind`:
  measured        computed directly from the radar values
  derived         plain arithmetic on measured values
  classification  depends on the chosen threshold (an interpretation, not a measurement)
  estimate        an area/percentage derived from the classification
  parameter       an input setting
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import Thresholds
from .errors import IncompatibleDataError


@dataclass
class ChangeResult:
    before_db: np.ndarray
    after_db: np.ndarray
    diff_db: np.ndarray         # after - before; NaN where either date is invalid
    valid: np.ndarray           # bool: valid in both dates
    changed: np.ndarray         # bool: valid and classified as changed
    stats: dict
    backscatter_table: pd.DataFrame     # before / after / change per statistic
    classification_table: pd.DataFrame  # counts, areas, percentages
    thresholds: Thresholds


def classify(diff_db: np.ndarray, thresholds: Thresholds) -> np.ndarray:
    """Boolean mask of pixels whose change meets the threshold (inclusive)."""
    t = thresholds.change_db
    with np.errstate(invalid="ignore"):
        if thresholds.direction == "decrease":
            return diff_db <= -t
        if thresholds.direction == "increase":
            return diff_db >= t
        return np.abs(diff_db) >= t


def compute_change(before_db: np.ndarray, after_db: np.ndarray, pixel_area_km2,
                   thresholds: Thresholds) -> ChangeResult:
    if before_db.shape != after_db.shape:
        raise IncompatibleDataError(
            f"before {before_db.shape} and after {after_db.shape} grids differ; align them first")
    before_db = before_db.astype(np.float32, copy=False)
    after_db = after_db.astype(np.float32, copy=False)
    valid = np.isfinite(before_db) & np.isfinite(after_db)
    n_valid = int(valid.sum())
    if n_valid == 0:
        raise IncompatibleDataError("no pixel is valid in both observations; nothing to compare")

    diff = np.subtract(after_db, before_db)  # NaN where either date is invalid
    diff[~valid] = np.nan
    changed = classify(diff, thresholds) & valid

    # Compacted valid-pixel vectors (float32 storage); reductions accumulate
    # in float64 so the reported statistics keep full precision.
    b = before_db[valid]
    a = after_db[valid]
    d = diff[valid]
    area = np.broadcast_to(np.asarray(pixel_area_km2, dtype=np.float64), before_db.shape)

    n_total = int(before_db.size)
    n_changed = int(changed.sum())
    analysed_km2 = float(np.sum(area, where=valid, dtype=np.float64))
    changed_km2 = float(np.sum(area, where=changed, dtype=np.float64))

    def mean64(x):
        return np.mean(x, dtype=np.float64)

    def std64(x):
        return np.std(x, dtype=np.float64)

    def row(name, fn, unit="dB"):
        return {"statistic": name, "before": float(fn(b)), "after": float(fn(a)),
                "change": float(fn(a) - fn(b)), "unit": unit, "kind": "measured"}

    backscatter = pd.DataFrame([
        row("mean_backscatter", mean64),
        row("median_backscatter", np.median),
        row("min_backscatter", np.min),
        row("max_backscatter", np.max),
        row("std_backscatter", std64),
    ])

    stats = {
        "valid_pixels": n_valid,
        "total_pixels": n_total,
        "valid_fraction": n_valid / n_total,
        "mean_difference_db": float(mean64(d)),
        "median_difference_db": float(np.median(d)),
        "std_difference_db": float(std64(d)),
        "min_difference_db": float(d.min()),
        "max_difference_db": float(d.max()),
        "changed_pixels": n_changed,
        "analysed_area_km2": analysed_km2,
        "changed_area_km2": changed_km2,
        "changed_percent": 100.0 * n_changed / n_valid,
        "threshold_db": thresholds.change_db,
        "direction": thresholds.direction,
    }

    c = [
        ("total_pixels", stats["total_pixels"], "pixels", "measured",
         "all pixels in the aligned grid"),
        ("valid_pixels", n_valid, "pixels", "measured", "valid in both observations"),
        ("valid_fraction", stats["valid_fraction"], "fraction", "derived", ""),
        ("mean_difference", stats["mean_difference_db"], "dB", "measured",
         "mean of (after - before) over valid pixels"),
        ("median_difference", stats["median_difference_db"], "dB", "measured", ""),
        ("std_difference", stats["std_difference_db"], "dB", "measured", ""),
        ("min_difference", stats["min_difference_db"], "dB", "measured", ""),
        ("max_difference", stats["max_difference_db"], "dB", "measured", ""),
        ("threshold", thresholds.change_db, "dB", "parameter", "|change| must be at least this"),
        ("direction", thresholds.direction, "", "parameter", "which sign of change is counted"),
        ("changed_pixels", n_changed, "pixels", "classification",
         "pixels meeting the threshold; NOT confirmed land-cover change"),
        ("analysed_area", analysed_km2, "km2", "derived", "area of valid pixels"),
        ("changed_area", changed_km2, "km2", "estimate",
         "area of changed pixels; depends on the threshold"),
        ("changed_percent", stats["changed_percent"], "%", "estimate",
         "changed pixels / valid pixels"),
    ]
    classification = pd.DataFrame(c, columns=["metric", "value", "unit", "kind", "note"])

    return ChangeResult(before_db, after_db, diff, valid, changed, stats,
                        backscatter, classification, thresholds)
