"""Earthdata credentials.

The canonical credential is the bearer token in NASA_EARTHDATA_BEARER_TOKEN
(read from the environment, optionally bootstrapped from a local .env file
that never leaves the machine).  Username/password and ~/.netrc remain
supported as fallbacks because some tools still use them.  Nothing here ever
returns, logs or writes the credential.
"""

from __future__ import annotations

import os
from pathlib import Path

TOKEN_VAR = "NASA_EARTHDATA_BEARER_TOKEN"


def _load_env_files() -> None:
    """Merge .env.local / .env (cwd first, then the repository root) into the
    environment without overwriting variables that are already set.  Earlier
    files win; python-dotenv is not required."""
    roots = [Path.cwd()]
    repo_root = Path(__file__).resolve().parents[2]
    if repo_root != Path.cwd():
        roots.append(repo_root)
    for root in roots:
        for name in (".env.local", ".env"):
            path = root / name
            if not path.is_file():
                continue
            for line in path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value


_loaded = False


def load_credentials() -> None:
    global _loaded
    if not _loaded:
        _load_env_files()
        _loaded = True


def bearer_token() -> str | None:
    load_credentials()
    token = os.environ.get(TOKEN_VAR, "").strip()
    return token or None


def require_bearer_token() -> str:
    token = bearer_token()
    if not token:
        raise RuntimeError(
            f"{TOKEN_VAR} is not configured. Set it in the environment or in "
            ".env.local (git-ignored) to retrieve calibrated NISAR data.")
    return token


def credentials_available() -> bool:
    load_credentials()
    if bearer_token():
        return True
    return bool(os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))


def auth_summary() -> dict:
    """Health-check view: which credentials are configured, never their values."""
    load_credentials()
    return {
        "bearer_token_configured": bool(bearer_token()),
        "username_password_configured": bool(
            os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD")),
        "netrc_present": (Path.home() / ".netrc").is_file(),
    }
