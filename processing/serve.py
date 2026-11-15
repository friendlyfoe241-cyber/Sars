"""Local analysis API for the web app.

Run with:  python processing/serve.py [--port 8788]

Endpoints (JSON):
  GET  /api/health                 service + credential status (never values)
  GET  /api/events                 event analysis methods and what they need
  POST /api/analyze                start an analysis; returns {analysisId}
  GET  /api/analyze/<id>           status / progress / result / error
  GET  /api/artifacts/<id>/<file>  download a result file (CSV/JSON/GeoTIFF)

Analysis runs in a background thread per request; downloads and products are
cached under processing/cache so repeated runs are fast.  The Earthdata token
is only read inside the pipeline (nisar_change.auth) and is never returned.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from nisar_change import auth, events
from nisar_change.auth import auth_summary
from nisar_change.config import AnalysisRequest, DIRECTIONS, POLARISATIONS, Thresholds
from nisar_change.errors import (DiscoveryError, IncompatibleDataError, InvalidRequestError,
                                 MissingDependencyError, NoSuitableObservationsError,
                                 RetrievalError, UnsupportedEventError)
from nisar_change.pipeline import run_analysis
from nisar_change.schema import build_result

import explain as explain_service

BASE = Path(__file__).resolve().parent
DIST_DIR = BASE.parent / "dist"
OUT_DIR = BASE / "out"
CACHE_DIR = BASE / "cache"
MAX_BODY = 64 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")

# status -> HTTP code for expected pipeline errors
ERROR_STATUS = {
    InvalidRequestError: 400,
    UnsupportedEventError: 400,
    NoSuitableObservationsError: 422,
    IncompatibleDataError: 422,
    DiscoveryError: 502,
    RetrievalError: 502,
    MissingDependencyError: 501,
}


class Job:
    def __init__(self, request: AnalysisRequest):
        self.id = uuid.uuid4().hex[:12]
        self.request = request
        self.status = "queued"
        self.progress = "queued"
        self.result = None
        self.error = None  # {"code", "message", "reasons"?}
        self.out_dir = OUT_DIR / self.id

    def view(self) -> dict:
        out = {"analysisId": self.id, "status": self.status, "progress": self.progress}
        if self.result is not None:
            out["result"] = self.result
            out["artifactsBase"] = f"/api/artifacts/{self.id}"
        if self.error is not None:
            out["error"] = self.error
        return out


JOBS: dict[str, Job] = {}
JOBS_LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1)


def _safe(message: str, job: Job) -> str:
    """Strip local filesystem paths from error text."""
    for secret in (str(job.out_dir), str(CACHE_DIR), str(BASE), str(Path.home())):
        message = message.replace(secret, "")
    return message[:600]


def _run(job: Job) -> None:
    job.status = "running"
    req = job.request

    def stage(text):
        job.progress = text

    def search(bbox, start, end):
        stage("searching the ASF catalogue")
        from nisar_change import discovery
        return discovery.search_asf(bbox, start, end)

    def cmr(granule):
        stage("verifying granules in CMR")
        from nisar_change import discovery
        return discovery.cmr_lookup(granule)

    def retrieve(granule, bbox, pol, cache, cmr_info):
        from nisar_change import retrieval

        def prog(pct):
            suffix = f" — Harmony reports {pct}% complete" if pct is not None else "…"
            stage(f"retrieving calibrated {pol} data from NASA Harmony{suffix}")

        stage(f"retrieving calibrated {pol} data from NASA Harmony…")
        return retrieval.retrieve_subset(granule, bbox, pol, cache, cmr_info, on_progress=prog)

    def reader(path, units, decimate=1):
        stage("processing measurements")
        from nisar_change import raster
        return raster.read_geotiff(path, units, decimate=decimate)

    try:
        run = run_analysis(req, job.out_dir, cache_dir=CACHE_DIR, pixel_csv_max=20000,
                           search=search, cmr=cmr, retrieve=retrieve, reader=reader)
        stage("finalising results")
        job.result = build_result(job.id, req, run)
        job.status = "succeeded"
    except (InvalidRequestError, UnsupportedEventError, NoSuitableObservationsError,
            IncompatibleDataError, DiscoveryError, RetrievalError,
            MissingDependencyError) as exc:
        job.error = {"code": type(exc).__name__, "message": _safe(str(exc), job)}
        if isinstance(exc, NoSuitableObservationsError):
            job.error["reasons"] = [_safe(r, job) for r in exc.reasons]
        job.status = "failed"
    except RuntimeError as exc:
        job.error = {"code": "auth_not_configured", "message": _safe(str(exc), job)}
        job.status = "failed"
    except Exception:
        traceback.print_exc()
        job.error = {"code": "internal_error",
                     "message": "The analysis failed unexpectedly; see the server log."}
        job.status = "failed"


def parse_request(body: dict) -> AnalysisRequest:
    try:
        bbox = tuple(float(v) for v in body["bbox"])
        before = date.fromisoformat(str(body["beforeDate"]))
        after = date.fromisoformat(str(body["afterDate"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidRequestError(f"missing or invalid field: {exc}") from exc
    if len(bbox) != 4:
        raise InvalidRequestError("bbox must be [west, south, east, north]")
    pol = str(body.get("polarisation", "HV")).upper()
    if pol not in POLARISATIONS:
        raise InvalidRequestError(f"polarisation must be one of {POLARISATIONS}")
    direction = str(body.get("direction", "decrease")).lower()
    if direction not in DIRECTIONS:
        raise InvalidRequestError(f"direction must be one of {DIRECTIONS}")
    thresholds = Thresholds(change_db=float(body.get("thresholdDb", 3.0)), direction=direction)
    request = AnalysisRequest(
        bbox=bbox, event_type=str(body.get("eventType", "deforestation")),
        before_date=before, after_date=after, polarisation=pol, thresholds=thresholds,
        date_tolerance_days=int(body.get("dateToleranceDays", 6)),
        min_aoi_coverage=float(body.get("minAoiCoverage", 0.95)),
        input_units=str(body.get("inputUnits", "linear")),
        resampling=str(body.get("resampling", "bilinear")),
    )
    request.validate()
    return request


class Handler(BaseHTTPRequestHandler):
    server_version = "nisar-analysis/1"

    def log_message(self, fmt, *args):  # quiet, and never log headers
        pass

    def _send(self, code: int, payload: dict | None = None, *,
              content_type: str = "application/json", body: bytes | None = None) -> None:
        data = body if body is not None else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, code: int, message: str, reasons=None) -> None:
        err = {"code": code, "message": message}
        if reasons:
            err["reasons"] = reasons
        self._send(code, {"error": err})

    def do_OPTIONS(self):
        self._send(204, body=b"")

    def do_GET(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        if parts[:2] == ["api", "health"]:
            self._send(200, {"ok": True, "auth": auth_summary(),
                             "events": [m.name for m in events.METHODS.values() if m.supported]})
            return
        if parts[:2] == ["api", "events"]:
            self._send(200, {"events": [
                {"id": m.name, "supported": m.supported, "summary": m.summary,
                 "requirements": m.requirements, "limitations": m.limitations}
                for m in events.METHODS.values()]})
            return
        if parts[:2] == ["api", "analyze"] and len(parts) == 3:
            with JOBS_LOCK:
                job = JOBS.get(parts[2])
            self._send(200 if job else 404, job.view() if job else {"error": {
                "code": "worker_restarted",
                "message": ("This analysis is no longer known to the analysis service — the "
                            "worker restarted (e.g. after running out of memory) while it was "
                            "running. Run the analysis again.")}})
            return
        if parts[:2] == ["api", "artifacts"] and len(parts) == 3:
            self._serve_artifact(parts[2], "")
            return
        if parts[:2] == ["api", "artifacts"] and len(parts) == 4:
            self._serve_artifact(parts[2], parts[3])
            return
        if parts and parts[0] == "api":
            self._error(404, "not found")
            return
        self._serve_static(parts)

    STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
                    ".css": "text/css", ".json": "application/json", ".png": "image/png",
                    ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
                    ".woff2": "font/woff2"}

    def _serve_static(self, parts: list[str]) -> None:
        """Serve the built web app (dist/) with an SPA fallback to index.html."""
        if not DIST_DIR.is_dir():
            self._error(404, "frontend not built (run `npm run build`)")
            return
        name = "/".join(parts) or "index.html"
        if not all(SAFE_NAME.match(p) for p in parts):
            self._error(400, "invalid path")
            return
        path = (DIST_DIR / name).resolve()
        if DIST_DIR.resolve() not in path.parents:
            self._error(400, "invalid path")
            return
        if not path.is_file():
            path = DIST_DIR / "index.html"  # SPA fallback
        self._send(200, content_type=self.STATIC_TYPES.get(path.suffix, "application/octet-stream"),
                   body=path.read_bytes())

    def _serve_artifact(self, job_id: str, name: str) -> None:
        if not SAFE_NAME.match(job_id) or (name and not SAFE_NAME.match(name)):
            self._error(400, "invalid artifact name")
            return
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job:
            self._error(404, "unknown analysisId")
            return
        if not name:
            self._send(200, {"artifacts": sorted(p.name for p in job.out_dir.glob("*"))
                             if job.out_dir.is_dir() else []})
            return
        path = (job.out_dir / name).resolve()
        if job.out_dir.resolve() not in path.parents or not path.is_file():
            self._error(404, "unknown artifact")
            return
        types = {".csv": "text/csv", ".json": "application/json",
                 ".tif": "image/tiff", ".tiff": "image/tiff"}
        self._send(200, content_type=types.get(path.suffix, "application/octet-stream"),
                   body=path.read_bytes())

    def do_POST(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        if parts[:2] == ["api", "explain-change"] and len(parts) == 2:
            self._handle_explain()
            return
        if parts[:2] != ["api", "analyze"] or len(parts) != 2:
            self._error(404, "not found")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._error(400, "request body missing or too large")
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            self._error(400, "request body is not valid JSON")
            return
        try:
            request = parse_request(body)
        except InvalidRequestError as exc:
            self._error(400, str(exc))
            return
        job = Job(request)
        with JOBS_LOCK:
            JOBS[job.id] = job
        EXECUTOR.submit(_run, job)
        self._send(202, {"analysisId": job.id, "status": job.status,
                         "statusUrl": f"/api/analyze/{job.id}"})

    def _handle_explain(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._error(400, "request body missing or too large")
            return
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            self._error(400, "request body is not valid JSON")
            return
        try:
            self._send(200, explain_service.explain(body))
        except explain_service.ExplainError as exc:
            self._error(exc.status, str(exc))
        except Exception:
            traceback.print_exc()
            self._error(500, "Unexpected server error.")


def main() -> None:
    parser = argparse.ArgumentParser(description="NISAR analysis API")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    auth.load_credentials()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"analysis API on http://{args.host}:{args.port}  "
          f"(credentials: {'bearer token' if auth_summary()['bearer_token_configured'] else 'none'})")
    server.serve_forever()


if __name__ == "__main__":
    main()
