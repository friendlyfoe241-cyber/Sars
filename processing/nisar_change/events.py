"""Event-specific analysis methods.

Each event type is an EventMethod.  Only deforestation is implemented.  The
others are registered so the architecture is in place, but they refuse to run
(instead of reusing the deforestation method) and state what they would need.
Add a new method by subclassing EventMethod and registering it in METHODS.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .analysis import ChangeResult, compute_change
from .config import AnalysisRequest
from .errors import UnsupportedEventError
from .raster import Raster, to_db

GENERAL_LIMITATIONS = [
    "Radar backscatter measures how strongly the surface scatters the radar signal; it is "
    "affected by vegetation structure, soil and canopy moisture, surface roughness, "
    "inundation, terrain and incidence angle, not only by land-cover change.",
    "Changed-pixel counts, areas and percentages are classifications/estimates that depend on "
    "the chosen threshold. They are not ground truth.",
    "Radar data cannot give a tree count.",
    "Validation against independent reference data (optical imagery, field data, or a "
    "forest-loss product) is needed before drawing conclusions.",
]


class EventMethod(ABC):
    name: str
    supported: bool = False
    summary: str = ""
    requirements: str = ""
    limitations: list[str] = []

    @abstractmethod
    def analyse(self, before: Raster, after: Raster, request: AnalysisRequest) -> ChangeResult:
        """`before` and `after` are already on the same grid."""


class DeforestationMethod(EventMethod):
    name = "deforestation"
    supported = True
    summary = ("Single before/after comparison of GCOV backscatter (dB); pixels whose change "
               "meets a threshold are flagged as possible vegetation-structure loss.")
    requirements = "Two compatible NISAR L2 GCOV acquisitions of the same area and polarisation."
    limitations = [
        "A single pair cannot separate forest loss from soil-moisture, seasonal, flooding or "
        "wind-damage effects; short baselines reduce but do not remove this.",
        "HV (cross-pol) is generally the more sensitive channel to woody vegetation structure, "
        "but sensitivity saturates in dense forest at L-band.",
        "The default threshold (3 dB) is a starting point, not a validated value.",
        "Speckle is not filtered; isolated changed pixels may be noise.",
    ]

    def analyse(self, before: Raster, after: Raster, request: AnalysisRequest) -> ChangeResult:
        th = request.thresholds
        b = to_db(before, request.input_units, th.db_valid_min, th.db_valid_max)
        a = to_db(after, request.input_units, th.db_valid_min, th.db_valid_max)
        return compute_change(b, a, before.pixel_area_km2(), th)


class UnsupportedMethod(EventMethod):
    supported = False

    def __init__(self, name: str, summary: str, requirements: str):
        self.name = name
        self.summary = summary
        self.requirements = requirements
        self.limitations = ["Not implemented."]

    def analyse(self, before, after, request):
        raise UnsupportedEventError(
            f"'{self.name}' analysis is not implemented, and the deforestation method must not "
            f"be reused for it. What it needs: {self.requirements}")


METHODS: dict[str, EventMethod] = {
    "deforestation": DeforestationMethod(),
    "wildfire": UnsupportedMethod(
        "wildfire",
        "Burn-scar / fire-disturbance mapping.",
        "A time series around the fire date (not one pair), cross-pol/co-pol ratio or "
        "vegetation indices, terrain and layover masks, and an independent burned-area "
        "reference (e.g. optical dNBR or thermal products) to calibrate and validate "
        "thresholds."),
    "flood": UnsupportedMethod(
        "flood",
        "Open-water and flooded-vegetation mapping.",
        "Open-water classification against a non-flood seasonal baseline, permanent-water "
        "and terrain masks (DEM/HAND), and co-polarised double-bounce analysis for flooded "
        "vegetation, ideally from a time series."),
    "earthquake_deformation": UnsupportedMethod(
        "earthquake_deformation",
        "Ground-displacement mapping.",
        "Interferometric (phase/coherence) or pixel-offset products rather than GCOV "
        "backscatter (check which NISAR interferogram products are available for the area), "
        "plus a DEM and atmospheric/orbit corrections. Backscatter differences do not "
        "measure displacement."),
}


def get_method(event_type: str) -> EventMethod:
    try:
        return METHODS[event_type]
    except KeyError:
        raise UnsupportedEventError(
            f"Unknown event type {event_type!r}. Known: {', '.join(METHODS)}") from None
