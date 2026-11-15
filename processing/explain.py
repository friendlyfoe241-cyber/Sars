"""Gemini "Explain this change" endpoint (Python twin of api/explain-change.ts).

Served by processing/serve.py at POST /api/explain-change so deployments that
host the frontend statically (e.g. Render Static Site) can use the feature
without Vercel serverless functions.  The Gemini key (GEMINI_API_KEY) is read
server-side only.  The request carries metadata and computed statistics —
never imagery, never credentials.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

MAX_TEXT = 4000

SYSTEM_INSTRUCTION = """You explain radar change-detection results for a scientific monitoring tool built on NASA-ISRO NISAR SAR data.

You receive: study-area metadata, an observation pair (two acquisitions), dataset notes, calculated summary statistics of a pixel-level difference, and optionally calibrated analysis results (dB statistics and candidate-area estimates computed by the processing pipeline). You do not receive the imagery itself.

Write a short explanation as JSON with exactly these fields:
- "observed_signal": what changed in the observed radar signal, based only on the provided statistics (2 sentences maximum).
- "possible_interpretation": what the observed change could potentially indicate on the ground (1-2 sentences, tentative language such as "could", "may", "is consistent with").
- "supporting_evidence": which specific provided measurements or metrics support the interpretation (1-2 sentences, cite the numbers you were given).
- "limitations": other possible explanations and what cannot be concluded from the available observations (1-2 sentences).
- "recommended_next_investigation": one concrete follow-up that would improve confidence (1 sentence, e.g. checking another polarisation, a longer time series, or independent reference data).

Hard rules:
- Total length: 5-8 sentences across the five fields.
- Never invent measurements, numbers, dates or product identifiers not present in the input.
- Never claim or imply that you inspected satellite imagery; you only saw statistics.
- Clearly separate measured facts ("observed_signal", "supporting_evidence") from interpretation ("possible_interpretation", "limitations").
- A decrease in backscatter is NOT proof of flooding; a change is NOT proof of deforestation or vegetation loss. Do not name a specific cause as established fact.
- Use the unit exactly as provided. If the values are quicklook display units rather than calibrated backscatter, say so and do not convert or restate them as dB, sigma0 or gamma0. Candidate-area figures are threshold-dependent estimates, not confirmed land-cover change.
- If the data are insufficient to interpret, say so in "observed_signal" and keep the other fields brief.
- Do not add greetings, headings, caveats beyond the requested fields, or markdown."""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "observed_signal": {"type": "string"},
        "possible_interpretation": {"type": "string"},
        "supporting_evidence": {"type": "string"},
        "limitations": {"type": "string"},
        "recommended_next_investigation": {"type": "string"},
    },
    "required": ["observed_signal", "possible_interpretation", "supporting_evidence",
                 "limitations", "recommended_next_investigation"],
}


class ExplainError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


def _str(value, cap=200):
    return value[:cap] if isinstance(value, str) else None


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _facts(body: dict) -> dict:
    study, pair = body.get("studyArea") or {}, body.get("acquisitionPair") or {}
    dataset, stats = body.get("dataset") or {}, body.get("statistics") or {}
    analysis = body.get("analysis") or {}
    if not isinstance(analysis, dict):
        analysis = {}
    processing = analysis.get("processing") or {}
    method = processing.get("methodParameters") or {}
    areas = analysis.get("areaEstimates") or {}
    astats = analysis.get("statistics") or {}
    dates = analysis.get("acquisitionDates") or {}
    return {
        "studyArea": {
            "name": _str(study.get("name")),
            "country": _str(study.get("country")),
            "phenomenon": _str(study.get("phenomenon"), 300),
        },
        "observationPair": {
            "sensorBand": _str(pair.get("band")),
            "productType": _str(pair.get("productType")),
            "polarisation": _str(pair.get("polarisation"), 20),
            "temporalBaselineDays": _num(pair.get("temporalBaselineDays")),
            "earlierAcquisition": _str(pair.get("earlier"), 40),
            "laterAcquisition": _str(pair.get("later"), 40),
        },
        "dataset": {
            "status": _str(dataset.get("status"), 40),
            "valueUnit": _str(dataset.get("unit"), 60),
            "limitations": [_str(l, 300) for l in (dataset.get("limitations") or [])[:6]
                            if isinstance(l, str)],
        },
        "calculatedStatistics": {
            "unit": _str(stats.get("unit"), 60),
            "mean": _num(stats.get("mean")),
            "median": _num(stats.get("median")),
            "p10": _num(stats.get("p10")),
            "p25": _num(stats.get("p25")),
            "p75": _num(stats.get("p75")),
            "p90": _num(stats.get("p90")),
            "validPixelFraction": _num(stats.get("validFraction")),
        },
        "calibratedAnalysis": {
            "eventType": _str(analysis.get("eventType"), 40),
            "unitsOfResults": _str(processing.get("unitsOfResults"), 60),
            "method": _str(processing.get("eventMethod"), 60),
            "thresholdDb": _num(method.get("change_db")),
            "direction": _str(method.get("direction"), 20),
            "beforeDate": _str(dates.get("before"), 20),
            "afterDate": _str(dates.get("after"), 20),
            "meanChangeDb": _num(astats.get("mean_difference_db")),
            "medianChangeDb": _num(astats.get("median_difference_db")),
            "validAnalysedAreaKm2": _num(areas.get("valid_analysed_area_km2")),
            "candidateChangedAreaKm2": _num(areas.get("candidate_changed_area_km2")),
            "candidateChangedPercent": _num(areas.get("candidate_changed_percent_of_valid")),
        } if analysis else None,
    }


DEFAULT_MODEL = "gemini-3-flash-preview"
FALLBACK_MODELS = ("gemini-3-flash-preview", "gemini-3.1-flash-lite")


def _model_candidates() -> list:
    """Configured model first, then known-current fallbacks (retired ids 404)."""
    seen, out = set(), []
    for m in (os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL, *FALLBACK_MODELS):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _error_detail(exc) -> str:
    try:
        body = json.loads(exc.read() or b"{}")
        return str(body.get("error", {}).get("message", ""))[:300]
    except Exception:
        return ""


def _service_error(status: int, detail: str) -> ExplainError:
    suffix = f" {detail}" if detail else ""
    if status in (401, 403):
        return ExplainError(502, f"The Gemini API key was rejected (HTTP {status}). "
                                 f"Check the server's GEMINI_API_KEY.{suffix}")
    if status == 429:
        return ExplainError(502, f"The Gemini API quota is exhausted (HTTP 429). "
                                 f"Try again later.{suffix}")
    return ExplainError(502, f"The explanation service returned an error (HTTP {status}).{suffix}")


def _strip_fences(text: str) -> str:
    """Tolerate models that wrap JSON in markdown fences despite responseMimeType."""
    trimmed = text.strip()
    match = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", trimmed, re.IGNORECASE)
    return match.group(1) if match else trimmed


def explain(body: dict) -> dict:
    """Run one Gemini call; returns {"explanation": {...}, "model": ...}."""
    if not isinstance(body, dict):
        raise ExplainError(400, "Invalid request body.")
    study, pair = body.get("studyArea"), body.get("acquisitionPair")
    dataset, stats = body.get("dataset"), body.get("statistics")
    if not all(isinstance(x, dict) for x in (study, pair, dataset, stats)):
        raise ExplainError(400, "Invalid request body.")

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ExplainError(503, "GEMINI_API_KEY is not configured on the server.")
    base = os.environ.get("GEMINI_API_BASE",
                          "https://generativelanguage.googleapis.com/v1beta").rstrip("/")

    prompt_text = json.dumps(_facts(body), indent=2)

    def _request_payload(max_tokens: int) -> bytes:
        return json.dumps({
            "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            "generationConfig": {
                # Thinking is disabled: reasoning tokens count toward
                # maxOutputTokens, and on richer prompts they can consume the
                # whole budget before any JSON is written (truncated reply).
                # This task is a short structured summary and needs no
                # reasoning budget (verified against the live API).
                "temperature": 0.3,
                "maxOutputTokens": max_tokens,
                "thinkingConfig": {"thinkingBudget": 0},
                "responseMimeType": "application/json",
                "responseSchema": RESPONSE_SCHEMA,
            },
        }).encode()

    last_status, last_detail = 0, ""
    truncated = False
    obj = None
    model = None
    for candidate in _model_candidates():
        # A truncated reply gets one automatic retry with a doubled budget
        # before the next model is tried.
        for attempt in range(2):
            max_tokens = 2048 if attempt == 0 else 4096
            request = urllib.request.Request(
                f"{base}/models/{candidate}:generateContent?key={api_key}",
                data=_request_payload(max_tokens),
                headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=25) as res:
                    reply = json.loads(res.read())
            except urllib.error.HTTPError as exc:
                detail = _error_detail(exc)
                if exc.code == 404:
                    # Retired or unknown model id: try the next candidate.
                    last_status, last_detail = exc.code, detail
                    truncated = False
                    break
                raise _service_error(exc.code, detail)
            except (urllib.error.URLError, TimeoutError, ValueError):
                raise ExplainError(502, "The explanation service could not be reached.")

            text, finish_reason = "", ""
            candidates = reply.get("candidates") or []
            if candidates:
                finish_reason = candidates[0].get("finishReason", "")
                parts = (candidates[0].get("content") or {}).get("parts") or []
                if parts:
                    text = parts[0].get("text", "") or ""
            if not text:
                raise ExplainError(502, "The explanation service returned an empty response.")
            try:
                obj = json.loads(_strip_fences(text))
            except ValueError:
                if finish_reason == "MAX_TOKENS":
                    truncated = True
                    continue  # retry with the doubled budget, then the next model
                raise ExplainError(502, "The explanation service returned an unreadable "
                                       "response.")
            model = candidate
            break
        if obj is not None:
            break
    if obj is None:
        if truncated:
            raise ExplainError(502, "The explanation was cut off by the model's response "
                                   "budget; try again.")
        raise _service_error(last_status or 404, last_detail)

    def pick(key):
        value = obj.get(key)
        return value[:MAX_TEXT] if isinstance(value, str) else ""

    return {
        "explanation": {
            "observedSignal": pick("observed_signal"),
            "possibleIndication": pick("possible_interpretation"),
            "supportingEvidence": pick("supporting_evidence"),
            "limitations": pick("limitations"),
            "recommendedNextInvestigation": pick("recommended_next_investigation"),
        },
        "model": model,
    }
