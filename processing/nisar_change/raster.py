"""Raster handling: load float radar data, align two grids, convert to dB.

Everything scientific here works on floating-point arrays. PNG/quicklook
values are never used.  rasterio is imported lazily so the numerical code can
be used and tested without it.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# GDAL defaults its block cache to a share of *physical* RAM, which on a
# container (Render, Docker) can be far larger than the container's own limit.
# 32 MB is plenty for the windowed reads/writes this package performs.
os.environ.setdefault("GDAL_CACHEMAX", "32")
os.environ.setdefault("GDAL_NUM_THREADS", "1")

from .errors import IncompatibleDataError, MissingDependencyError

EARTH_RADIUS_M = 6_371_008.8


def _rasterio():
    try:
        import rasterio
        return rasterio
    except ImportError as exc:  # pragma: no cover
        raise MissingDependencyError(
            "rasterio is required for GeoTIFF input/output (pip install rasterio)") from exc


@dataclass
class Raster:
    """One band of float data on a regular, north-up grid.

    data              2-D float32; invalid pixels are NaN
    transform         affine (a, b, c, d, e, f) as in rasterio/GDAL: x = a*col + b*row + c,
                      y = d*col + e*row + f (b = d = 0 is required)
    crs_wkt           coordinate reference system
    is_geographic     True if x/y are degrees
    meters_per_unit   metres per CRS unit (projected CRS only)
    units             "linear" (power) or "db"
    """

    data: np.ndarray
    transform: tuple[float, float, float, float, float, float]
    crs_wkt: str | None
    is_geographic: bool
    meters_per_unit: float | None = 1.0
    units: str = "linear"
    source: str = ""

    @property
    def shape(self) -> tuple[int, int]:
        return self.data.shape

    def same_grid(self, other: "Raster") -> bool:
        if self.shape != other.shape or self.crs_wkt != other.crs_wkt:
            return False
        px = abs(self.transform[0])
        py = abs(self.transform[4])
        a, b = self.transform, other.transform
        return (
            math.isclose(a[0], b[0], rel_tol=1e-9) and math.isclose(a[4], b[4], rel_tol=1e-9)
            and abs(a[2] - b[2]) <= 1e-3 * px and abs(a[5] - b[5]) <= 1e-3 * py
        )

    def pixel_size_m(self) -> tuple[float, float]:
        """Approximate (x, y) pixel size in metres (at the grid's central latitude if geographic)."""
        a, _, _, _, e, f = self.transform
        if self.is_geographic:
            lat = f + e * self.shape[0] / 2
            return (abs(a) * math.pi / 180 * EARTH_RADIUS_M * math.cos(math.radians(lat)),
                    abs(e) * math.pi / 180 * EARTH_RADIUS_M)
        k = self.meters_per_unit or 1.0
        return abs(a) * k, abs(e) * k

    def pixel_area_km2(self):
        """Area of one pixel in km^2: a float for projected grids, a (rows, 1) array for
        geographic grids (area shrinks with cos(latitude); spherical-Earth approximation)."""
        a, _, _, _, e, f = self.transform
        if self.is_geographic:
            lat = f + (np.arange(self.shape[0]) + 0.5) * e
            dx = abs(a) * math.pi / 180 * EARTH_RADIUS_M * np.cos(np.radians(lat))
            dy = abs(e) * math.pi / 180 * EARTH_RADIUS_M
            return (dx * dy / 1e6)[:, None]
        k = self.meters_per_unit or 1.0
        return abs(a * e) * k * k / 1e6

    def grid_info(self) -> dict:
        px, py = self.pixel_size_m()
        return {
            "rows": self.shape[0], "cols": self.shape[1],
            "transform": list(self.transform),
            "crs_wkt": self.crs_wkt,
            "is_geographic": self.is_geographic,
            "pixel_size_m_approx": [round(px, 3), round(py, 3)],
        }


def decimation_factor(n_pixels: int, max_pixels: int) -> int:
    """Integer subsampling factor that brings `n_pixels` within `max_pixels`.

    The grid is subsampled (every k-th pixel), never smoothed, so the
    statistics of the remaining pixels are unbiased; only the resolution
    changes and the analysis grid reports its actual pixel size.
    """
    if n_pixels <= max_pixels:
        return 1
    return math.ceil(math.sqrt(n_pixels / max_pixels))


def decimate(raster: "Raster", factor: int) -> "Raster":
    """Subsample to every `factor`-th pixel (nearest, no smoothing).

    The transform is scaled so the sampled pixels keep their true map
    positions; values are untouched (exact subset of the original pixels).
    """
    if factor <= 1:
        return raster
    # .copy() matters: the strided slice would keep the full base array alive
    data = raster.data[::factor, ::factor].copy()
    a, b, c, d, e, f = raster.transform
    transform = (a * factor, b * factor, c, d * factor, e * factor, f)
    return Raster(data, transform, raster.crs_wkt, raster.is_geographic,
                  raster.meters_per_unit, raster.units, raster.source)


def peek_pixels(path: str | Path) -> int:
    """Pixel count of a raster, from the header only (bounded memory)."""
    with _rasterio().open(path) as ds:
        return int(ds.height) * int(ds.width)


def read_geotiff(path: str | Path, units: str = "linear", band: int = 1,
                 decimate: int = 1) -> Raster:
    """Load band `band` of a GeoTIFF as float32 (nodata -> NaN).

    `decimate=k` keeps only every k-th row/column (exact product pixels, no
    smoothing) and is read strip-by-strip so that memory stays bounded even
    for very large files; the returned transform maps the subsampled grid.
    """
    rio = _rasterio()
    k = max(1, int(decimate))
    with rio.open(path) as ds:
        if ds.crs is None:
            raise IncompatibleDataError(f"{path} has no coordinate reference system")
        t = ds.transform
        if abs(t.b) > 1e-12 or abs(t.d) > 1e-12:
            raise IncompatibleDataError(f"{path} has a rotated geotransform, which is not supported")
        if k == 1:
            data = ds.read(band).astype("float32", copy=False)
        else:
            rows_out = len(range(0, ds.height, k))
            cols_out = len(range(0, ds.width, k))
            data = np.empty((rows_out, cols_out), dtype="float32")
            strip = max(1, (1_000_000 // max(ds.width, 1)) // k) * k  # ~1M source px per strip
            for r0 in range(0, ds.height, strip):
                r1 = min(ds.height, r0 + strip)
                block = ds.read(band, window=((r0, r1), (0, ds.width))).astype("float32", copy=False)
                sub = block[::k, ::k]
                data[r0 // k: r0 // k + sub.shape[0], :] = sub
                del block, sub
        if ds.nodata is not None and np.isfinite(ds.nodata):
            data[data == np.float32(ds.nodata)] = np.nan
        data[~np.isfinite(data)] = np.nan
        geographic = bool(ds.crs.is_geographic)
        factor = None
        if not geographic:
            try:
                factor = float(ds.crs.linear_units_factor[1])
            except Exception:
                factor = 1.0
        transform = (t.a, t.b, t.c, t.d, t.e, t.f)
        if k > 1:
            transform = (t.a * k, t.b * k, t.c, t.d * k, t.e * k, t.f)
        return Raster(data, transform, ds.crs.to_wkt(), geographic,
                      factor, units, str(path))


def align_pair(before: Raster, after: Raster, resampling: str = "bilinear",
               min_overlap: float = 0.9) -> tuple[Raster, dict]:
    """Return `after` on the grid of `before` (same CRS, pixel size, extent).

    If the grids already match nothing is resampled.  Otherwise `after` is
    reprojected (in linear power, before any dB conversion) onto `before`'s
    grid.  Raises IncompatibleDataError if units differ or the two scenes
    overlap on less than `min_overlap` of `before`'s valid pixels.
    """
    if before.units != after.units:
        raise IncompatibleDataError(
            f"before is in {before.units!r} but after is in {after.units!r}; cannot compare")
    if before.same_grid(after):
        return after, {"resampled": False, "overlap_fraction": _overlap(before.data, after.data)}

    rio = _rasterio()
    from rasterio.crs import CRS
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject

    if not before.crs_wkt or not after.crs_wkt:
        raise IncompatibleDataError("a raster has no CRS; cannot align the grids")
    dst = np.full(before.shape, np.nan, dtype=np.float32)
    reproject(
        source=after.data, destination=dst,
        src_transform=Affine(*after.transform), src_crs=CRS.from_user_input(after.crs_wkt),
        dst_transform=Affine(*before.transform), dst_crs=CRS.from_user_input(before.crs_wkt),
        resampling=getattr(Resampling, resampling), src_nodata=np.nan, dst_nodata=np.nan,
    )
    overlap = _overlap(before.data, dst)
    if overlap < min_overlap:
        raise IncompatibleDataError(
            f"after-image overlaps only {overlap:.0%} of the before-image's valid pixels "
            f"(required {min_overlap:.0%}); the two observations do not cover the same area")
    aligned = Raster(dst, before.transform, before.crs_wkt, before.is_geographic,
                     before.meters_per_unit, after.units, after.source)
    return aligned, {"resampled": True, "resampling": resampling, "overlap_fraction": overlap,
                     "original_after_grid": after.grid_info()}


def _overlap(a: np.ndarray, b: np.ndarray) -> float:
    base = np.isfinite(a)
    n = int(base.sum())
    return float((base & np.isfinite(b)).sum() / n) if n else 0.0


def to_db(raster: Raster, units: str, db_min: float, db_max: float) -> np.ndarray:
    """Backscatter in dB (float32) with invalid pixels as NaN.

    linear input: non-positive values are invalid (log undefined); a negative
    value means the data are probably not linear power, which is an error.
    Any dB value outside [db_min, db_max] is treated as invalid.

    The conversion runs in-place on one float32 buffer (dB is ~7 significant
    digits in float32, far beyond the reported precision) so that the peak
    memory of the pipeline stays low on small hosts.
    """
    data = np.array(raster.data, dtype=np.float32, copy=True)
    if units == "linear":
        finite = data[np.isfinite(data)]
        if finite.size and (finite < 0).any():
            raise IncompatibleDataError(
                f"{raster.source or 'raster'} contains negative values but input_units is "
                "'linear' (power cannot be negative). The data may already be in dB - "
                "re-run with input_units='db'.")
        del finite
        # non-positive (and NaN) cannot be logged; mark them before the log
        # so the mask is about the linear values, not the dB result
        data[~(data > 0)] = np.nan
        with np.errstate(divide="ignore", invalid="ignore"):
            np.log10(data, out=data, where=~np.isnan(data))
            data *= 10.0
    elif units != "db":
        raise IncompatibleDataError(f"unknown units {units!r}")
    data[~np.isfinite(data)] = np.nan
    data[(data < db_min) | (data > db_max)] = np.nan
    return data
