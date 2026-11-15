"""POST /api/explain-change on the analysis server (mocked Gemini upstream)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

import explain
import serve


VALID_BODY = {
    "studyArea": {"name": "Tonj floodplain wetlands", "country": "South Sudan",
                  "phenomenon": "Seasonal wetland inundation"},
    "acquisitionPair": {"band": "L-band", "productType": "L2 GCOV", "polarisation": "HV",
                        "temporalBaselineDays": 12,
                        "earlier": "2026-10-25T03:42:52Z", "later": "2026-11-06T03:42:53Z"},
    "dataset": {"status": "nisar_quicklook", "unit": "display DN",
                "limitations": ["quicklook values are display units"]},
    "statistics": {"unit": "display DN", "mean": -2.1, "median": -3.0, "validFraction": 0.967},
    "analysis": {
        "eventType": "deforestation",
        "acquisitionDates": {"before": "2026-10-25", "after": "2026-11-06"},
        "processing": {"eventMethod": "deforestation",
                       "methodParameters": {"change_db": 3.0, "direction": "decrease"},
                       "unitsOfResults": "dB (10*log10 of linear power)"},
        "statistics": {"mean_difference_db": -0.39, "median_difference_db": -0.37,
                       "valid_fraction": 0.99},
        "areaEstimates": {"valid_analysed_area_km2": 1098.1,
                          "candidate_changed_area_km2": 113.5,
                          "candidate_changed_percent_of_valid": 10.3},
    },
}


class GeminiStub(BaseHTTPRequestHandler):
    captured = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers["Content-Length"])
        GeminiStub.captured = {"url": self.path, "body": json.loads(self.rfile.read(length))}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps({
            "observed_signal": "Median change was -0.37 dB.",
            "possible_interpretation": "Could indicate seasonal change.",
            "supporting_evidence": "Mean change -0.39 dB below the 3 dB threshold.",
            "limitations": "Cause cannot be established.",
            "recommended_next_investigation": "Compare a longer time series.",
        })}]}}]}).encode())


@pytest.fixture()
def gemini(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), GeminiStub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_API_BASE", f"http://127.0.0.1:{server.server_address[1]}/v1beta")
    yield
    server.shutdown()
    thread.join(timeout=5)


@pytest.fixture()
def api_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    thread.join(timeout=5)


def test_round_trip_with_analysis_facts(gemini, api_server):
    res = requests.post(f"{api_server}/api/explain-change", json=VALID_BODY, timeout=10)
    assert res.status_code == 200
    exp = res.json()["explanation"]
    assert exp["observedSignal"] == "Median change was -0.37 dB."
    assert exp["supportingEvidence"].startswith("Mean change")
    assert exp["recommendedNextInvestigation"]
    prompt = json.dumps(GeminiStub.captured["body"]["contents"])
    assert "candidateChangedAreaKm2" in prompt and "meanChangeDb" in prompt
    assert GeminiStub.captured["url"].endswith("/models/gemini-3-flash-preview:generateContent?key=test-key")
    # thinking must stay disabled: its tokens count toward maxOutputTokens and
    # can truncate the JSON on richer prompts
    gen = GeminiStub.captured["body"]["generationConfig"]
    assert gen["thinkingConfig"]["thinkingBudget"] == 0
    assert gen["maxOutputTokens"] >= 1000


def test_missing_key_503(api_server, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_BASE", raising=False)
    res = requests.post(f"{api_server}/api/explain-change", json=VALID_BODY, timeout=10)
    assert res.status_code == 503
    assert "GEMINI_API_KEY" in res.json()["error"]["message"]


def test_invalid_body_400(api_server):
    res = requests.post(f"{api_server}/api/explain-change", json={"statistics": {}}, timeout=10)
    assert res.status_code == 400


def test_get_rejected(api_server):
    res = requests.get(f"{api_server}/api/explain-change", timeout=10)
    assert res.status_code == 404  # only POST is routed


SUCCESS_REPLY = json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps({
    "observed_signal": "Signal recorded.",
    "possible_interpretation": "Could indicate change.",
    "supporting_evidence": "Numbers as provided.",
    "limitations": "Cause unknown.",
    "recommended_next_investigation": "Collect reference data.",
})}]}}]})


class FallbackStub(BaseHTTPRequestHandler):
    """404 for a retired model id, success otherwise."""

    captured_urls: list = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        FallbackStub.captured_urls.append(self.path)
        if "retired-model" in self.path:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {
                "code": 404,
                "message": "This model models/retired-model is no longer available.",
                "status": "NOT_FOUND",
            }}).encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(SUCCESS_REPLY.encode())


class RejectStub(BaseHTTPRequestHandler):
    """403 with a provider error message."""

    def log_message(self, *args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": {
            "code": 403, "message": "API key not valid. Please pass a valid API key.",
            "status": "PERMISSION_DENIED",
        }}).encode())


def _stub_server(monkeypatch, stub):
    server = ThreadingHTTPServer(("127.0.0.1", 0), stub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_API_BASE", f"http://127.0.0.1:{server.server_address[1]}/v1beta")
    return server


def test_retired_model_falls_back(api_server, monkeypatch):
    FallbackStub.captured_urls = []
    server = _stub_server(monkeypatch, FallbackStub)
    monkeypatch.setenv("GEMINI_MODEL", "retired-model")
    try:
        res = requests.post(f"{api_server}/api/explain-change", json=VALID_BODY, timeout=10)
    finally:
        server.shutdown()
        server.server_close()
    assert res.status_code == 200
    assert res.json()["model"] == "gemini-3-flash-preview"
    assert len(FallbackStub.captured_urls) == 2  # retired id first, then the fallback


def test_key_rejection_surfaces_provider_detail(api_server, monkeypatch):
    server = _stub_server(monkeypatch, RejectStub)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    try:
        res = requests.post(f"{api_server}/api/explain-change", json=VALID_BODY, timeout=10)
    finally:
        server.shutdown()
        server.server_close()
    assert res.status_code == 502
    message = res.json()["error"]["message"]
    assert "rejected" in message
    assert "API key not valid" in message  # the provider's own detail is passed through


def test_prompt_never_contains_secrets(gemini):
    body = dict(VALID_BODY)
    body["statistics"]["unit"] = "display DN"
    out = explain.explain(body)
    assert out["explanation"]["limitations"] == "Cause cannot be established."
    prompt = json.dumps(GeminiStub.captured["body"])
    assert "test-key" not in json.dumps(GeminiStub.captured["body"]["contents"])


class TruncatingStub(BaseHTTPRequestHandler):
    """First call: truncated JSON with MAX_TOKENS; second call: complete."""

    calls = 0

    def log_message(self, *args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        TruncatingStub.calls += 1
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if TruncatingStub.calls == 1:
            self.wfile.write(json.dumps({"candidates": [{
                "finishReason": "MAX_TOKENS",
                "content": {"parts": [{"text": '{"observed_signal": "cut off mid str'}]},
            }]}).encode())
        else:
            self.wfile.write(SUCCESS_REPLY.encode())


def test_truncated_reply_is_retried_with_a_larger_budget(api_server, monkeypatch):
    TruncatingStub.calls = 0
    server = _stub_server(monkeypatch, TruncatingStub)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    try:
        res = requests.post(f"{api_server}/api/explain-change", json=VALID_BODY, timeout=10)
    finally:
        server.shutdown()
        server.server_close()
    assert res.status_code == 200
    assert res.json()["explanation"]["observedSignal"] == "Signal recorded."
    assert TruncatingStub.calls == 2  # one truncation, one automatic retry
