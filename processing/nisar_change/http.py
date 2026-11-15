"""Small HTTP helper: retries transient failures and honours Retry-After.

Used for the public ASF and CMR endpoints (no credentials are sent)."""

from __future__ import annotations

import time

import requests

from .errors import DiscoveryError

_sleep = time.sleep  # replaced in tests
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def request_json(url: str, params: dict | None = None, *, session=None, retries: int = 5,
                 timeout: float = 60, headers: dict | None = None):
    """GET `url` and return (parsed_json, response_headers).

    Retries connection errors, timeouts and HTTP 429/5xx with exponential
    backoff (2s, 4s, ... capped at 60s), waiting for Retry-After when the
    server sends it.  Other HTTP errors fail immediately.
    """
    client = session or requests
    delay = 2.0
    last = "unknown error"
    for attempt in range(retries + 1):
        wait = delay
        try:
            resp = client.get(url, params=params, headers=headers, timeout=timeout)
        except (requests.ConnectionError, requests.Timeout) as exc:
            last = f"{type(exc).__name__}"
        else:
            if resp.status_code == 200:
                try:
                    return resp.json(), resp.headers
                except ValueError as exc:
                    raise DiscoveryError(f"{url} returned invalid JSON") from exc
            if resp.status_code not in TRANSIENT_STATUS:
                raise DiscoveryError(f"HTTP {resp.status_code} from {url}: {resp.text[:200]}")
            last = f"HTTP {resp.status_code}"
            retry_after = resp.headers.get("Retry-After", "")
            if retry_after.isdigit():
                wait = float(retry_after)
        if attempt == retries:
            break
        _sleep(wait)
        delay = min(delay * 2, 60)
    raise DiscoveryError(f"{url} failed after {retries + 1} attempts ({last})")
