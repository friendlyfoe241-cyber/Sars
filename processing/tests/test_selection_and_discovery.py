import pytest

from nisar_change import discovery, http
from nisar_change.errors import DiscoveryError, NoSuitableObservationsError
from nisar_change.selection import select_pair

from helpers import granule, request


def test_selects_nearest_dates_within_one_group_and_explains():
    gs = [granule("B_far", "2026-10-20"), granule("B_near", "2026-10-25"),
          granule("A_near", "2026-11-06"), granule("A_far", "2026-11-12")]
    sel = select_pair(gs, request())
    assert (sel.before.id, sel.after.id) == ("B_near", "A_near")
    assert sel.baseline_days == 12
    text = "\n".join(sel.explanation)
    assert "B_near" in text and "A_near" in text and "compatib" in text


def test_never_mixes_incompatible_scenes():
    gs = [granule("B", "2026-10-25", track=14), granule("A", "2026-11-06", track=99)]
    with pytest.raises(NoSuitableObservationsError) as exc:
        select_pair(gs, request())
    assert exc.value.reasons


def test_different_release_or_orbit_direction_is_not_paired():
    gs = [granule("B", "2026-10-25", crid="P05036"), granule("A", "2026-11-06", crid="P05099")]
    with pytest.raises(NoSuitableObservationsError):
        select_pair(gs, request())
    gs = [granule("B", "2026-10-25"), granule("A", "2026-11-06", direction="DESCENDING")]
    with pytest.raises(NoSuitableObservationsError):
        select_pair(gs, request())


def test_useful_errors():
    with pytest.raises(NoSuitableObservationsError, match="No NISAR"):
        select_pair([], request())
    gs = [granule("B", "2026-10-25", pols=("HH",)), granule("A", "2026-11-06", pols=("HH",))]
    with pytest.raises(NoSuitableObservationsError, match="polarisation HV") as exc:
        select_pair(gs, request(polarisation="HV"))
    assert "HH" in str(exc.value)
    small = [(10.2, 10.2), (10.3, 10.2), (10.3, 10.3), (10.2, 10.3), (10.2, 10.2)]
    gs = [granule("B", "2026-10-25", ring=small), granule("A", "2026-11-06", ring=small)]
    with pytest.raises(NoSuitableObservationsError, match="cover at least"):
        select_pair(gs, request())
    gs = [granule("B", "2026-09-01"), granule("A", "2026-11-06")]
    with pytest.raises(NoSuitableObservationsError, match="requested dates"):
        select_pair(gs, request())


ROW = {
    "granuleName": "NISAR_L2_PR_GCOV_034_014_A_005_2005_DHDH_A_20261025T034252_20261025T034327_P05036_N_F_J_001",
    "startTime": "2026-10-25T03:42:52Z", "stopTime": "2026-10-25T03:43:27Z",
    "platform": "NISAR", "processingLevel": "GCOV", "flightDirection": "ASCENDING",
    "track": 14, "frameNumber": 5, "absoluteOrbit": 34,
    "downloadUrl": "https://x/NISAR_L2_GCOV_V1/scene.h5",
    "stringFootprint": "POLYGON((9 9,11 9,11 11,9 11,9 9))",
    "nisar": {"mainBandPolarization": ["HV", "HH"], "pgeVersion": "1.2"},
}  # structural mock of an ASF response row (metadata only)


def test_parse_asf_row():
    g = discovery.parse_asf_row(ROW)
    assert g.polarisations == ["HH", "HV"] and g.collection == "NISAR_L2_GCOV_V1"
    assert g.crid == "P05036" and g.track == 14 and len(g.footprint) == 5
    assert g.maturity == "VALIDATED" and g.production_code == "2005"
    assert discovery.parse_asf_row({**ROW, "platform": "SENTINEL-1"}) is None
    assert discovery.parse_asf_row({**ROW, "nisar": {}}) is None


class FakeResp:
    def __init__(self, status, payload=None, headers=None):
        self.status_code, self._p, self.headers, self.text = status, payload, headers or {}, "body"

    def json(self):
        return self._p


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(params)
        return self.responses.pop(0)


def test_retries_rate_limit_honouring_retry_after(monkeypatch):
    waits = []
    monkeypatch.setattr(http, "_sleep", waits.append)
    s = FakeSession([FakeResp(429, headers={"Retry-After": "7"}), FakeResp(503),
                     FakeResp(200, {"ok": 1})])
    data, _ = http.request_json("https://x", session=s)
    assert data == {"ok": 1} and waits[0] == 7.0 and len(s.calls) == 3


def test_non_transient_error_fails_fast_and_exhaustion_raises(monkeypatch):
    monkeypatch.setattr(http, "_sleep", lambda s: None)
    with pytest.raises(DiscoveryError, match="HTTP 400"):
        http.request_json("https://x", session=FakeSession([FakeResp(400)]))
    with pytest.raises(DiscoveryError, match="failed after"):
        http.request_json("https://x", retries=2, session=FakeSession([FakeResp(503)] * 3))


def test_asf_search_splits_window_when_result_cap_is_hit(monkeypatch):
    monkeypatch.setattr(http, "_sleep", lambda s: None)
    r1 = {**ROW, "granuleName": ROW["granuleName"].replace("_001", "_011")}
    r2 = {**ROW, "granuleName": ROW["granuleName"].replace("_001", "_012"),
          "startTime": "2026-11-06T03:42:52Z"}
    s = FakeSession([FakeResp(200, [[r1, r2]]), FakeResp(200, [[r1]]), FakeResp(200, [[r2]])])
    from datetime import datetime, timezone
    out = discovery.search_asf((10, 10, 10.5, 10.5),
                               datetime(2026, 10, 1, tzinfo=timezone.utc),
                               datetime(2026, 11, 30, tzinfo=timezone.utc),
                               max_results=2, session=s)
    assert len(s.calls) == 3 and [g.id[-3:] for g in out] == ["011", "012"]
    assert s.calls[0]["platform"] == "NISAR" and "POLYGON" in s.calls[0]["intersectsWith"]


def test_cmr_lookup_reports_missing_granule(monkeypatch):
    g = granule("X", "2026-10-25")
    s = FakeSession([FakeResp(200, {"feed": {"entry": []}})])
    with pytest.raises(DiscoveryError, match="does not list"):
        discovery.cmr_lookup(g, session=s)
    s = FakeSession([FakeResp(200, {"feed": {"entry": [
        {"id": "G1-ASF", "collection_concept_id": "C1-ASF", "time_start": "2026-10-25T00:00:00Z"}]}})])
    info = discovery.cmr_lookup(g, session=s)
    assert info["granule_concept_id"] == "G1-ASF" and info["start_time_matches_asf"] is True
