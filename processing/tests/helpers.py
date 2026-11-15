"""Synthetic fixtures for tests. All arrays here are constructed with KNOWN values
so the expected statistics can be computed by hand. They are test inputs only and
are never used by the pipeline itself."""

from __future__ import annotations

from datetime import date, datetime, timezone

import numpy as np

from nisar_change.config import AnalysisRequest, Thresholds
from nisar_change.discovery import Granule
from nisar_change.raster import Raster

PIXEL_M = 30.0
PROJECTED_TRANSFORM = (PIXEL_M, 0.0, 500000.0, 0.0, -PIXEL_M, 9000000.0)


def make_raster(db: np.ndarray, *, linear=True, transform=PROJECTED_TRANSFORM) -> Raster:
    data = (10.0 ** (db / 10.0)).astype(np.float32) if linear else db.astype(np.float32)
    return Raster(data, transform, "EPSG:32636", False, 1.0, "linear" if linear else "db", "synthetic")


def synthetic_pair():
    """100x100 grid, baseline -15 dB.  Known patches (rows/cols are slices):
       A 30x30 = 900 px   decrease of 6 dB     -> changed
       B 10x10 = 100 px   decrease of 2.9 dB   -> below the 3 dB threshold
       C 10x10 = 100 px   increase of 6 dB     -> changed only if direction != decrease
       invalid: before[0:5,0:5] = 0 (linear zero), after[90:95,90:95] = NaN -> 50 px
    """
    before = np.full((100, 100), -15.0)
    after = before.copy()
    after[10:40, 10:40] -= 6.0
    after[50:60, 50:60] -= 2.9
    after[70:80, 70:80] += 6.0
    b = make_raster(before)
    a = make_raster(after)
    b.data[0:5, 0:5] = 0.0
    a.data[90:95, 90:95] = np.nan
    return b, a


def request(**kw) -> AnalysisRequest:
    base = dict(bbox=(10.0, 10.0, 10.5, 10.5), event_type="deforestation",
                before_date=date(2026, 10, 25), after_date=date(2026, 11, 6),
                polarisation="HV", thresholds=Thresholds(change_db=3.0, direction="decrease"))
    base.update(kw)
    return AnalysisRequest(**base)


def granule(gid: str, day: str, *, pols=("HH", "HV"), track=14, frame=5, crid="P05036",
            direction="ASCENDING", ring=None, collection="NISAR_L2_GCOV_V1") -> Granule:
    ring = ring or [(9.0, 9.0), (11.0, 9.0), (11.0, 11.0), (9.0, 11.0), (9.0, 9.0)]
    t = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    return Granule(id=gid, start_time=t, stop_time=t, polarisations=sorted(pols),
                   orbit_direction=direction, track=track, frame=frame, crid=crid,
                   pge_version="1.0", production_code="2005", footprint=ring,
                   collection=collection)
