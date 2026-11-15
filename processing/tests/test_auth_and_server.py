"""Auth handling and the analysis HTTP API (no network, stubbed pipeline)."""

from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer

import pytest
import requests

from nisar_change import auth
from nisar_change.config import AnalysisRequest
from nisar_change.errors import InvalidRequestError
import serve


def test_require_token_clear_error(monkeypatch):
    monkeypatch.delenv(auth.TOKEN_VAR, raising=False)
    monkeypatch.setattr(auth, "_loaded", True)  # skip .env files
    with pytest.raises(RuntimeError, match="NASA_EARTHDATA_BEARER_TOKEN"):
        auth.require_bearer_token()


def test_token_read_from_environment(monkeypatch):
    monkeypatch.setenv(auth.TOKEN_VAR, "tkn-123")
    monkeypatch.setattr(auth, "_loaded", True)
    assert auth.bearer_token() == "tkn-123"
    assert auth.credentials_available()


def test_env_local_found_from_repo_root(tmp_path, monkeypatch):
    """Running from processing/ must still find the repository's .env.local."""
    repo_root = tmp_path
    pkg = repo_root / "processing" / "nisar_change"
    pkg.mkdir(parents=True)
    (repo_root / ".env.local").write_text(f"{auth.TOKEN_VAR}=root-token\n")
    monkeypatch.delenv(auth.TOKEN_VAR, raising=False)
    monkeypatch.setattr(auth, "_loaded", False)
    monkeypatch.setattr(auth, "__file__", str(pkg / "auth.py"))
    monkeypatch.chdir(repo_root / "processing")  # cwd has no .env files
    auth.load_credentials()
    assert auth.bearer_token() == "root-token"


def test_auth_summary_never_leaks_token(monkeypatch):
    secret = "super-secret-token-value"
    monkeypatch.setenv(auth.TOKEN_VAR, secret)
    monkeypatch.setattr(auth, "_loaded", True)
    summary = json.dumps(auth.auth_summary())
    assert secret not in summary
    assert summary.count("bearer_token_configured") == 1


def test_parse_request_valid():
    req = serve.parse_request({
        "bbox": [28.4, 7.5, 28.7, 7.8], "beforeDate": "2026-10-25",
        "afterDate": "2026-11-06", "polarisation": "hv", "thresholdDb": 2.5,
    })
    assert isinstance(req, AnalysisRequest)
    assert req.polarisation == "HV"
    assert req.thresholds.change_db == 2.5


@pytest.mark.parametrize("body", [
    {},  # nothing
    {"bbox": [1, 2, 3], "beforeDate": "2026-10-25", "afterDate": "2026-11-06"},  # short bbox
    {"bbox": [1, 2, 3, 4], "beforeDate": "nope", "afterDate": "2026-11-06"},  # bad date
    {"bbox": [1, 2, 3, 4], "beforeDate": "2026-10-25", "afterDate": "2026-11-06",
     "polarisation": "XY"},  # bad polarisation
])
def test_parse_request_rejects_invalid(body):
    with pytest.raises(InvalidRequestError):
        serve.parse_request(body)


@pytest.fixture()
def api_server(monkeypatch):
    """Real HTTP server with the pipeline stubbed out."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    thread.join(timeout=5)


def test_health_and_events(api_server):
    health = requests.get(f"{api_server}/api/health", timeout=10).json()
    assert health["ok"] is True
    assert set(health["auth"]) == {"bearer_token_configured", "username_password_configured",
                                  "netrc_present"}
    events = requests.get(f"{api_server}/api/events", timeout=10).json()["events"]
    assert {"deforestation"} <= {e["id"] for e in events}
    flood = next(e for e in events if e["id"] == "flood")
    assert flood["supported"] is False and flood["requirements"]


def test_analyze_lifecycle_with_stub(api_server, monkeypatch):
    def fake_run(job):
        job.status = "running"
        job.result = {"analysisId": job.id, "status": "succeeded"}
        job.status = "succeeded"

    monkeypatch.setattr(serve, "_run", fake_run)
    res = requests.post(f"{api_server}/api/analyze", json={
        "bbox": [28.4, 7.5, 28.7, 7.8], "beforeDate": "2026-10-25",
        "afterDate": "2026-11-06", "polarisation": "HV"}, timeout=10)
    assert res.status_code == 202
    analysis_id = res.json()["analysisId"]
    import time
    for _ in range(50):
        view = requests.get(f"{api_server}/api/analyze/{analysis_id}", timeout=10).json()
        if view["status"] == "succeeded":
            break
        time.sleep(0.1)
    assert view["result"]["status"] == "succeeded"
    assert view["artifactsBase"] == f"/api/artifacts/{analysis_id}"


def test_analyze_invalid_body_400(api_server):
    res = requests.post(f"{api_server}/api/analyze", json={"bbox": [1, 2, 3]}, timeout=10)
    assert res.status_code == 400
    assert "error" in res.json()


def test_unknown_analysis_404(api_server):
    res = requests.get(f"{api_server}/api/analyze/doesnotexist", timeout=10)
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] == "worker_restarted"
    assert "Run the analysis again" in err["message"]


def test_artifact_path_traversal_blocked(api_server):
    res = requests.get(f"{api_server}/api/artifacts/x/..%2F..%2Fserve.py", timeout=10)
    assert res.status_code in (400, 404)


def test_static_app_served(api_server):
    res = requests.get(f"{api_server}/", timeout=10)
    assert res.status_code == 200
    assert "text/html" in res.headers["Content-Type"]
    # SPA fallback: unknown paths return the app shell
    res = requests.get(f"{api_server}/some/page", timeout=10)
    assert res.status_code == 200


def test_static_traversal_blocked(api_server):
    """A raw traversal request must never return source files."""
    import socket

    host, port = api_server.rsplit(":", 1)
    with socket.create_connection((host.removeprefix("http://"), int(port)), timeout=10) as s:
        s.sendall(b"GET /../processing/serve.py HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        data = b""
        while chunk := s.recv(65536):
            data += chunk
    assert b"ThreadingHTTPServer" not in data  # serve.py source must not leak
