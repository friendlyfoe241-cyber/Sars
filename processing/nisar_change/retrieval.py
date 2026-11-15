"""Retrieve the actual radar numbers with NASA Harmony.

Harmony is the service that does the spatial (bbox) and variable (polarisation
layer) subsetting and returns a GeoTIFF of floating-point GCOV values for just
the requested area - the full HDF5 product is not downloaded.

Harmony job submission needs an Earthdata login.  Credentials come only from
the environment (see auth.py), in order of preference:
  * NASA_EARTHDATA_BEARER_TOKEN  (bearer token; the canonical credential),
  * EARTHDATA_USERNAME / EARTHDATA_PASSWORD,
  * ~/.netrc (machine urs.earthdata.nasa.gov)
and are never written to output files or logs.

Verified against the live service (2026-11): bbox + variable subsetting of
NISAR_L2_GCOV_V1 returns per-layer float GeoTIFFs in EPSG:32635 at 20 m,
values in linear power.  Harmony coverage names are the full HDF5 dataset
paths with a leading slash (e.g. /science/LSAR/GCOV/grids/frequencyA/HHHH);
when a variable name is rejected the job falls back to requesting every
coverage and selecting the wanted layer from the downloaded files.
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

from . import auth, discovery
from .discovery import Granule
from .errors import MissingDependencyError, RetrievalError

TERMINAL_FAIL = {"failed", "canceled", "complete_with_errors"}
TRANSIENT_HINTS = ("429", "502", "503", "504", "too many requests", "timed out", "timeout",
                   "connection")


def _is_transient(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(h in text for h in TRANSIENT_HINTS)


def _retry(fn, attempts: int = 4, base_delay: float = 5.0):
    delay = base_delay
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if i == attempts - 1 or not _is_transient(exc):
                raise
            time.sleep(delay)
            delay = min(delay * 2, 120)


def get_client():
    try:
        from harmony import Client
    except ImportError as exc:  # pragma: no cover
        raise MissingDependencyError("harmony-py is required (pip install harmony-py)") from exc
    token = auth.bearer_token()
    if token:
        return Client(token=token, should_validate_auth=False)
    user, pwd = os.environ.get("EARTHDATA_USERNAME"), os.environ.get("EARTHDATA_PASSWORD")
    if user and pwd:
        return Client(auth=(user, pwd))
    netrc = Path.home() / ".netrc"
    if netrc.is_file() and "urs.earthdata.nasa.gov" in netrc.read_text():
        return Client()
    raise RetrievalError(
        "No Earthdata credentials. Set NASA_EARTHDATA_BEARER_TOKEN (or "
        "EARTHDATA_USERNAME/EARTHDATA_PASSWORD, or an Earthdata entry in "
        "~/.netrc).")


def variable_candidates(collection_concept_id: str, pol: str, *, session=None) -> list[str]:
    """Harmony coverage names for a polarisation layer, e.g. HV -> HVHV.

    Verified live: Harmony wants the full HDF5 dataset path with a leading
    slash.  CMR UMM-Var names are used first when the collection publishes
    them; frequencyA (L-band) before frequencyB.
    """
    layer = pol + pol
    names: list[str] = []
    try:
        names = [n for n in discovery.cmr_variable_names(collection_concept_id, session=session)
                 if n.rstrip("/").split("/")[-1] == layer]
    except Exception:
        pass
    builtins = [f"/science/LSAR/GCOV/grids/frequencyA/{layer}",
                f"/science/LSAR/GCOV/grids/frequencyB/{layer}"]
    return names + [n for n in builtins if n not in names]


def _select_layer_file(paths: list[Path], pol: str) -> Path:
    """Pick the GeoTIFF of one polarisation layer from a download batch
    (an all-coverages job returns one file per layer)."""
    layer = pol + pol
    for freq in ("frequencyA", "frequencyB"):
        for p in paths:
            if f"{freq}_{layer}" in p.name:
                return p
    for p in paths:
        if f"_{layer}_" in p.name or p.stem.endswith(layer):
            return p
    raise RetrievalError(
        f"Harmony returned no {pol} ({layer}) layer (got {[p.name for p in paths]})")


def retrieve_subset(granule: Granule, bbox, pol: str, cache_dir: Path, cmr_info: dict, *,
                    timeout_s: int = 1800, poll_s: float = 10.0, client=None,
                    on_progress=None) -> tuple[Path, dict]:
    """Submit a Harmony bbox+variable subset job and download the GeoTIFF.

    Returns (path_to_geotiff, info).  Handles asynchronous jobs (polling with
    back-off and an overall timeout), transient errors/rate limits (retries) and
    rejected variable names (tries the next candidate).  `on_progress`, if
    given, is called with Harmony's reported percent complete (or None).
    """
    try:
        from harmony import BBox, Collection, Request
    except ImportError as exc:  # pragma: no cover
        raise MissingDependencyError("harmony-py is required (pip install harmony-py)") from exc

    key = hashlib.sha1(f"{bbox}".encode()).hexdigest()[:10]
    out_dir = Path(cache_dir) / granule.id / f"{pol}_{key}"
    out_dir.mkdir(parents=True, exist_ok=True)
    cached = sorted(out_dir.glob("*.tif*"))
    if cached:
        return _select_layer_file(cached, pol), {"job_id": None, "variable": None, "cached": True}

    client = client or get_client()
    west, south, east, north = bbox
    rejections = []
    job_id = variable = None
    for variable in variable_candidates(cmr_info["collection_concept_id"], pol):
        request = Request(
            collection=Collection(id=cmr_info["collection_concept_id"]),
            granule_id=[cmr_info["granule_concept_id"]],
            spatial=BBox(west, south, east, north),
            variables=[variable],
            format="image/tiff",
        )
        try:
            job_id = _retry(lambda: client.submit(request))
            break
        except Exception as exc:
            if _is_transient(exc):
                raise RetrievalError(f"Harmony is unavailable or rate-limiting: {exc}") from exc
            rejections.append(f"{variable}: {exc}")
    if job_id is None:
        # Every variable name was rejected: request all coverages and select
        # the wanted layer from the download batch (verified fallback).
        request = Request(
            collection=Collection(id=cmr_info["collection_concept_id"]),
            granule_id=[cmr_info["granule_concept_id"]],
            spatial=BBox(west, south, east, north),
            format="image/tiff",
        )
        try:
            job_id = _retry(lambda: client.submit(request))
            variable = None
        except Exception as exc:
            raise RetrievalError(
                f"Harmony rejected every variable name tried for {pol} "
                f"({'; '.join(rejections)}) and the all-coverages fallback also failed: {exc}") from exc

    deadline = time.monotonic() + timeout_s
    wait = poll_s
    while True:
        status = _retry(lambda: client.status(job_id))
        state = str(status.get("status", "")).lower()
        if on_progress is not None:
            try:
                pct = status.get("progress")
                on_progress(int(pct) if pct is not None else None)
            except Exception:
                pass
        if state == "successful":
            break
        if state in TERMINAL_FAIL:
            raise RetrievalError(
                f"Harmony job {job_id} ended as '{state}': {status.get('message', '')}")
        if time.monotonic() > deadline:
            raise RetrievalError(
                f"Harmony job {job_id} did not finish within {timeout_s} s (state '{state}'). "
                "It may still complete; re-run later to reuse it.")
        time.sleep(wait)
        wait = min(wait * 1.5, 60)

    futures = list(_retry(lambda: client.download_all(job_id, directory=str(out_dir),
                                                      overwrite=True)))
    paths = [Path(f.result()) for f in futures]
    tifs = [p for p in paths if p.suffix.lower() in (".tif", ".tiff")]
    if not tifs:
        raise RetrievalError(f"Harmony job {job_id} returned no GeoTIFF (got {[p.name for p in paths]})")
    return _select_layer_file(tifs, pol), {"job_id": job_id, "variable": variable, "cached": False}
