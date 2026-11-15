"""Catalogue discovery.

ASF Search API  -> DISCOVERY of NISAR L2 GCOV granules (metadata only).
NASA CMR        -> VERIFICATION of a granule + the concept IDs and variable
                   names that Harmony needs.  Metadata only.

Neither service returns radar measurements; see retrieval.py for that.

The ASF response parsing mirrors the existing front-end implementation in the
Sars repo (src/lib/discovery.ts) so both sides read the same fields.
"""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .errors import DiscoveryError
from .http import request_json

ASF_SEARCH_URL = "https://api.daac.asf.alaska.edu/services/search/param"
CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
CMR_COLLECTIONS_URL = "https://cmr.earthdata.nasa.gov/search/collections.json"
CMR_VARIABLES_URL = "https://cmr.earthdata.nasa.gov/search/variables.umm_json"

ASF_MAX_RESULTS = 1000


@dataclass
class Granule:
    id: str
    start_time: datetime
    stop_time: datetime
    polarisations: list[str]
    product_type: str = "L2 GCOV"
    processing_level: str = "GCOV"
    collection: str = "UNKNOWN"
    orbit_direction: str = "UNKNOWN"
    absolute_orbit: int | None = None
    track: int | None = None
    frame: int | None = None
    crid: str | None = None
    pge_version: str | None = None
    production_code: str | None = None
    footprint: list[tuple[float, float]] = field(default_factory=list)  # [lon, lat] ring
    download_url: str | None = None
    file_name: str | None = None

    @property
    def maturity(self) -> str:
        c = self.collection
        if "PROVISIONAL" in c:
            return "PROVISIONAL"
        if "BETA" in c:
            return "BETA"
        if c.startswith("NISAR_L2_GCOV_V"):
            return "VALIDATED"
        return "UNKNOWN"

    def compat_key(self) -> tuple:
        """Fields that must be identical for two scenes to be a valid pair
        (same rule set as pairing.ts in the web app)."""
        return (
            self.product_type, tuple(sorted(self.polarisations)), self.orbit_direction,
            self.track, self.frame, self.collection, self.crid, self.pge_version,
            self.production_code,
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "start_time": self.start_time.isoformat(),
            "stop_time": self.stop_time.isoformat(),
            "polarisations": self.polarisations,
            "product_type": self.product_type,
            "collection": self.collection,
            "maturity": self.maturity,
            "orbit_direction": self.orbit_direction,
            "absolute_orbit": self.absolute_orbit,
            "track": self.track,
            "frame": self.frame,
            "crid": self.crid,
            "pge_version": self.pge_version,
            "production_code": self.production_code,
            "footprint": [list(p) for p in self.footprint],
            "download_url": self.download_url,
        }


# --------------------------------------------------------------------------
# ASF parsing
# --------------------------------------------------------------------------

def _parse_time(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00").replace(" ", "T"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _parse_footprint(wkt: str | None) -> list[tuple[float, float]]:
    if not wkt:
        return []
    m = re.search(r"POLYGON\s*\(\(([^)]+)\)\)", wkt, re.I)
    if not m:
        return []
    ring = []
    for pair in m.group(1).split(","):
        parts = pair.split()
        if len(parts) >= 2:
            ring.append((float(parts[0]), float(parts[1])))
    return ring


def _collection_from_urls(row: dict) -> str:
    urls = [row.get("downloadUrl"), *((row.get("nisar") or {}).get("additionalUrls") or [])]
    for url in urls:
        if not url:
            continue
        m = re.search(r"/(NISAR_[A-Z0-9_]+_V\d+)/", url)
        if m:
            return m.group(1)
    return "UNKNOWN"


def parse_asf_row(row: dict) -> Granule | None:
    """Convert one ASF result into a Granule; None for non-SAR / unusable rows."""
    gid = row.get("granuleName") or row.get("productName")
    start = row.get("startTime")
    nisar = row.get("nisar") or {}
    pols = [p for p in (nisar.get("mainBandPolarization") or []) if p]
    if not gid or not start or row.get("platform") != "NISAR" or not pols:
        return None
    ptype = row.get("processingType")
    level = row.get("processingLevel") or "GCOV"
    crid = re.search(r"_([A-Z]\d{4,6})_[NF]_[A-Z]_J_\d+$", gid)
    fields = gid.split("_")
    return Granule(
        id=gid,
        start_time=_parse_time(start),
        stop_time=_parse_time(row.get("stopTime") or start),
        polarisations=sorted(pols),
        product_type=f"{ptype} {level}" if ptype else "L2 GCOV",
        processing_level=level,
        collection=_collection_from_urls(row),
        orbit_direction=row.get("flightDirection") or "UNKNOWN",
        absolute_orbit=row.get("absoluteOrbit"),
        track=row.get("track"),
        frame=row.get("frameNumber"),
        crid=crid.group(1) if crid else None,
        pge_version=nisar.get("pgeVersion") or row.get("pgeVersion"),
        production_code=fields[8] if len(fields) > 10 else None,
        footprint=_parse_footprint(row.get("stringFootprint")),
        download_url=row.get("downloadUrl"),
        file_name=row.get("fileName"),
    )


def _aoi_wkt(bbox) -> str:
    w, s, e, n = bbox
    return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _search_window(bbox, start, end, max_results, session, depth) -> list[Granule]:
    params = {
        "platform": "NISAR",
        "processingLevel": "GCOV",
        "intersectsWith": _aoi_wkt(bbox),
        "start": _iso(start),
        "end": _iso(end),
        "maxResults": max_results,
        "output": "json",
    }
    data, _ = request_json(ASF_SEARCH_URL, params, session=session)
    if isinstance(data, dict):
        raise DiscoveryError(f"ASF search error: {str(data.get('error', data))[:200]}")
    rows = [r for group in data for r in (group if isinstance(group, list) else [group])]

    # The ASF endpoint has no page cursor: when the cap is hit we split the
    # time window and search each half, so no result is silently dropped.
    if len(rows) >= max_results:
        if (end - start) > timedelta(days=1) and depth < 12:
            mid = start + (end - start) / 2
            left = _search_window(bbox, start, mid, max_results, session, depth + 1)
            right = _search_window(bbox, mid, end, max_results, session, depth + 1)
            return left + right
        warnings.warn("ASF returned the maximum number of results for a 1-day window; "
                      "the list may be truncated.")
    return [g for g in map(parse_asf_row, rows) if g is not None]


def search_asf(bbox, start: datetime, end: datetime, *, max_results: int = ASF_MAX_RESULTS,
               session=None) -> list[Granule]:
    """NISAR L2 GCOV granules intersecting `bbox` between `start` and `end` (UTC)."""
    seen: dict[str, Granule] = {}
    for g in _search_window(bbox, start, end, max_results, session, 0):
        seen.setdefault(g.id, g)
    return sorted(seen.values(), key=lambda g: g.start_time)


# --------------------------------------------------------------------------
# CMR
# --------------------------------------------------------------------------

def cmr_collection_concept_id(short_name: str, *, session=None) -> str:
    data, _ = request_json(CMR_COLLECTIONS_URL, {"short_name": short_name}, session=session)
    entries = data.get("feed", {}).get("entry", [])
    if not entries:
        raise DiscoveryError(f"CMR has no collection with short_name {short_name!r}")
    return entries[0]["id"]


def cmr_lookup(granule: Granule, *, session=None) -> dict:
    """Verify `granule` in CMR and return its concept IDs.

    Raises DiscoveryError if CMR does not know the granule (Harmony cannot
    process it then).  Also reports whether CMR's start time agrees with ASF.
    """
    if granule.collection == "UNKNOWN":
        raise DiscoveryError(
            f"Cannot determine the collection of {granule.id} from ASF metadata, so it "
            "cannot be looked up in CMR.")
    data, _ = request_json(
        CMR_GRANULES_URL,
        {"short_name": granule.collection, "producer_granule_id": granule.id, "page_size": 5},
        session=session,
    )
    entries = data.get("feed", {}).get("entry", [])
    if not entries:
        raise DiscoveryError(
            f"CMR does not list granule {granule.id} in collection {granule.collection}.")
    entry = entries[0]
    collection_id = entry.get("collection_concept_id") or cmr_collection_concept_id(
        granule.collection, session=session)
    cmr_start = entry.get("time_start")
    times_agree = None
    if cmr_start:
        times_agree = abs((_parse_time(cmr_start) - granule.start_time).total_seconds()) <= 5
    return {
        "granule_concept_id": entry["id"],
        "collection_concept_id": collection_id,
        "cmr_title": entry.get("title"),
        "cmr_time_start": cmr_start,
        "start_time_matches_asf": times_agree,
    }


def cmr_variable_names(collection_concept_id: str, *, session=None) -> list[str]:
    """Names of the UMM-Var variables of a collection (what Harmony calls variables).

    Paginates until all variables are listed.
    """
    names: list[str] = []
    page = 1
    while True:
        data, _ = request_json(
            CMR_VARIABLES_URL,
            {"collection_concept_id": collection_concept_id, "page_size": 200, "page_num": page},
            session=session,
        )
        items = data.get("items", [])
        names += [i["umm"]["Name"] for i in items if i.get("umm", {}).get("Name")]
        if len(items) < 200:
            return names
        page += 1
