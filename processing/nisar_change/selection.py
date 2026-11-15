"""Choose the before/after observations and explain why.

Scenes are only ever paired inside one compatibility group (same product type,
polarisations, orbit direction, track, frame, collection, release, processing
version and production variant), mirroring the rules in the web app's
pairing.ts.  Nothing outside a group is mixed in, and if no group qualifies the
function raises NoSuitableObservationsError with the reasons.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .config import AnalysisRequest
from .discovery import Granule
from .errors import NoSuitableObservationsError


@dataclass
class SelectedPair:
    before: Granule
    after: Granule
    before_offset_days: int
    after_offset_days: int
    baseline_days: float
    coverage_before: float
    coverage_after: float
    explanation: list[str]


def _point_in_ring(lon: float, lat: float, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def aoi_coverage(footprint, bbox, n: int = 24) -> float:
    """Fraction of the bbox covered by a footprint, sampled on an n x n grid."""
    if len(footprint) < 3:
        return 0.0
    west, south, east, north = bbox
    hit = 0
    for r in range(n):
        lat = south + (north - south) * (r + 0.5) / n
        for c in range(n):
            lon = west + (east - west) * (c + 0.5) / n
            if _point_in_ring(lon, lat, footprint):
                hit += 1
    return hit / (n * n)


def _offset(g: Granule, target: date) -> int:
    return abs((g.start_time.date() - target).days)


def _best(candidates: list[tuple[Granule, int, float]]):
    # closest date, then best coverage, then newest release, then id (deterministic)
    return min(candidates, key=lambda t: (t[1], -t[2], _neg(t[0].crid), t[0].id))


def _neg(text: str | None) -> tuple:
    return tuple(-ord(c) for c in (text or ""))


def select_pair(granules: list[Granule], request: AnalysisRequest) -> SelectedPair:
    reasons: list[str] = []
    pol = request.polarisation
    tol = request.date_tolerance_days

    if not granules:
        raise NoSuitableObservationsError(
            "No NISAR L2 GCOV granules intersect the area in the searched time window.",
            ["Check the bounding box, the dates, and that NISAR has acquired data there."])

    with_pol = [g for g in granules if pol in g.polarisations]
    if not with_pol:
        have = sorted({p for g in granules for p in g.polarisations})
        raise NoSuitableObservationsError(
            f"{len(granules)} granule(s) found but none contain polarisation {pol}.",
            [f"Polarisations available in the results: {', '.join(have) or 'none'}."])

    covered = []
    for g in with_pol:
        cov = aoi_coverage(g.footprint, request.bbox)
        if cov >= request.min_aoi_coverage:
            covered.append((g, cov))
    if not covered:
        raise NoSuitableObservationsError(
            f"{len(with_pol)} granule(s) have {pol} but none cover at least "
            f"{request.min_aoi_coverage:.0%} of the requested area.",
            ["Use a smaller bounding box or lower min_aoi_coverage "
             "(partial coverage would make the two dates cover different ground)."])

    groups: dict[tuple, list[tuple[Granule, float]]] = {}
    for g, cov in covered:
        groups.setdefault(g.compat_key(), []).append((g, cov))

    options = []
    for key, members in groups.items():
        before_c = [(g, _offset(g, request.before_date), c) for g, c in members
                    if _offset(g, request.before_date) <= tol]
        after_c = [(g, _offset(g, request.after_date), c) for g, c in members
                   if _offset(g, request.after_date) <= tol]
        if not before_c or not after_c:
            reasons.append(
                f"Group {_describe(members[0][0])}: acquisitions on "
                f"{sorted({g.start_time.date().isoformat() for g, _ in members})} - "
                f"{'none' if not before_c else 'some'} within {tol} d of {request.before_date}, "
                f"{'none' if not after_c else 'some'} within {tol} d of {request.after_date}.")
            continue
        b, bo, bc = _best(before_c)
        a, ao, ac = _best(after_c)
        baseline = (a.start_time - b.start_time).total_seconds() / 86400
        if baseline < 1:
            reasons.append(f"Group {_describe(b)}: chosen before/after scenes are "
                           f"{baseline:.2f} d apart (no temporal change to observe).")
            continue
        options.append((bo + ao, -min(bc, ac), key, b, a, bo, ao, bc, ac, baseline))

    if not options:
        raise NoSuitableObservationsError(
            "Observations exist, but no compatible before/after pair matches the requested dates.",
            reasons)

    options.sort(key=lambda o: (o[0], o[1], o[3].id, o[4].id))
    _, _, key, b, a, bo, ao, bc, ac, baseline = options[0]

    explanation = [
        f"{len(granules)} NISAR GCOV granule(s) found; {len(with_pol)} contain {pol}; "
        f"{len(covered)} cover >= {request.min_aoi_coverage:.0%} of the area.",
        f"They fall into {len(groups)} compatibility group(s) (same product type, polarisations, "
        "orbit direction, track, frame, collection, release, processing version).",
        f"Selected group: {_describe(b)}.",
        f"Before: {b.id} acquired {b.start_time.date()} ({bo} d from requested {request.before_date}, "
        f"{bc:.0%} AOI coverage).",
        f"After:  {a.id} acquired {a.start_time.date()} ({ao} d from requested {request.after_date}, "
        f"{ac:.0%} AOI coverage).",
        f"Temporal baseline: {baseline:.1f} days.",
        "Rule: within a group, the acquisition nearest each requested date is used; ties go to "
        "higher AOI coverage, then the newest release. Scenes from different groups are never mixed.",
    ]
    if len(options) > 1:
        explanation.append(
            f"{len(options) - 1} other compatible pair(s) were available but had larger date "
            "offsets or lower coverage.")
    explanation += [f"Rejected: {r}" for r in reasons]
    return SelectedPair(b, a, bo, ao, baseline, bc, ac, explanation)


def _describe(g: Granule) -> str:
    return (f"{g.collection} / {g.orbit_direction.lower()} / track {g.track} / frame {g.frame} / "
            f"release {g.crid} / pge {g.pge_version}")
