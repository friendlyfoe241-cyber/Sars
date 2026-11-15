"""Exception types. Every expected failure is a NisarChangeError so the CLI can
print a useful message instead of a traceback."""

from __future__ import annotations


class NisarChangeError(Exception):
    """Base class for all expected pipeline errors."""


class InvalidRequestError(NisarChangeError):
    """The analysis request itself is invalid (bad bbox, dates, polarisation...)."""


class DiscoveryError(NisarChangeError):
    """A catalogue service (ASF / CMR) failed or returned unusable data."""


class NoSuitableObservationsError(NisarChangeError):
    """No compatible before/after observation pair exists for the request."""

    def __init__(self, message: str, reasons: list[str] | None = None):
        self.reasons = reasons or []
        detail = "".join(f"\n  - {r}" for r in self.reasons)
        super().__init__(message + detail)


class RetrievalError(NisarChangeError):
    """Harmony / data download failed."""


class IncompatibleDataError(NisarChangeError):
    """The retrieved rasters cannot be compared (units, grid, overlap, no valid pixels)."""


class UnsupportedEventError(NisarChangeError):
    """The requested event type has no implemented analysis method."""


class MissingDependencyError(NisarChangeError):
    """An optional third-party package needed for this step is not installed."""
