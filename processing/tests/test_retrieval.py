"""retrieve_subset end-to-end against a stubbed harmony module (no network).

This exercises the real submission/poll/download code path — it exists because
a refactor once moved the `from harmony import ...` out of the function that
uses Request/Collection/BBox and the NameError only surfaced in production.
"""

from __future__ import annotations

import sys
import types
from concurrent.futures import Future
from pathlib import Path

from nisar_change import retrieval
from nisar_change.errors import RetrievalError

from helpers import granule

CMR_INFO = {"granule_concept_id": "G-1", "collection_concept_id": "C1"}


class FakeRequest:
    def __init__(self, **kw):
        self.kw = kw


class FakeBBox:
    def __init__(self, w, s, e, n):
        self.wsen = (w, s, e, n)


def _harmony_stub(monkeypatch):
    mod = types.ModuleType("harmony")
    mod.Request = FakeRequest
    mod.Collection = FakeRequest
    mod.BBox = FakeBBox
    monkeypatch.setitem(sys.modules, "harmony", mod)
    monkeypatch.setattr(retrieval, "variable_candidates",
                        lambda collection, pol: [f"/science/LSAR/GCOV/grids/frequencyA/{pol}{pol}"])


class FakeClient:
    def __init__(self, fail=False):
        self.submitted = []
        self.status_calls = 0
        self.fail = fail

    def submit(self, request):
        self.submitted.append(request)
        return "job-1"

    def status(self, job_id):
        self.status_calls += 1
        if self.fail:
            return {"status": "failed", "message": "bad variable"}
        return {"status": "running", "progress": 50} if self.status_calls == 1 else \
            {"status": "successful", "progress": 100}

    def download_all(self, job_id, directory=None, overwrite=False):
        path = Path(directory) / "out_frequencyA_HHHH_subsetted.tif"
        path.write_bytes(b"II*")
        fut: Future = Future()
        fut.set_result(str(path))
        return [fut]


def test_retrieve_subset_full_path(tmp_path, monkeypatch):
    _harmony_stub(monkeypatch)
    client = FakeClient()
    seen = []
    path, info = retrieval.retrieve_subset(
        granule("G1", "2026-10-25"), (28.4, 7.5, 28.7, 7.8), "HH", tmp_path, CMR_INFO,
        client=client, poll_s=0.01, on_progress=seen.append)
    assert path.name == "out_frequencyA_HHHH_subsetted.tif"
    assert info == {"job_id": "job-1",
                    "variable": "/science/LSAR/GCOV/grids/frequencyA/HHHH", "cached": False}
    # the Harmony request carried the bbox, granule and variable
    req = client.submitted[0]
    assert req.kw["granule_id"] == ["G-1"] and req.kw["variables"] == \
        ["/science/LSAR/GCOV/grids/frequencyA/HHHH"]
    assert req.kw["spatial"].wsen == (28.4, 7.5, 28.7, 7.8)
    assert seen == [50, 100]          # Harmony's percent reported onward

    # a second call for the same data is served from the cache: no new job
    path2, info2 = retrieval.retrieve_subset(
        granule("G1", "2026-10-25"), (28.4, 7.5, 28.7, 7.8), "HH", tmp_path, CMR_INFO,
        client=FakeClient(), poll_s=0.01)
    assert info2["cached"] is True and path2 == path


def test_retrieve_subset_surfaces_job_failure(tmp_path, monkeypatch):
    _harmony_stub(monkeypatch)
    try:
        retrieval.retrieve_subset(
            granule("G2", "2026-10-25"), (28.4, 7.5, 28.7, 7.8), "HH", tmp_path, CMR_INFO,
            client=FakeClient(fail=True), poll_s=0.01)
        raise AssertionError("expected RetrievalError")
    except RetrievalError as exc:
        assert "failed" in str(exc) and "bad variable" in str(exc)
