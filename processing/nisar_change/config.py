"""Request and threshold configuration."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

from .errors import InvalidRequestError

POLARISATIONS = ("HH", "HV", "VV", "VH")
DIRECTIONS = ("decrease", "increase", "both")
INPUT_UNITS = ("linear", "db")
RESAMPLING = ("nearest", "bilinear", "average")


@dataclass(frozen=True)
class Thresholds:
    """Change-classification parameters.

    change_db   minimum |after - before| in dB for a pixel to be classed as changed
                (inclusive).  3 dB is a common starting point, NOT a validated
                deforestation threshold: tune it per sensor mode, biome and season.
    direction   which sign of change counts: "decrease", "increase" or "both".
                For forest loss, a backscatter decrease (especially in HV) is the
                usual signal, but this depends on what replaces the forest.
    db_valid_min / db_valid_max
                dB values outside this range are treated as invalid pixels.
    """

    change_db: float = 3.0
    direction: str = "decrease"
    db_valid_min: float = -50.0
    db_valid_max: float = 20.0

    def validate(self) -> None:
        if not self.change_db > 0:
            raise InvalidRequestError("change threshold must be a positive number of dB")
        if self.direction not in DIRECTIONS:
            raise InvalidRequestError(f"direction must be one of {DIRECTIONS}")
        if not self.db_valid_min < self.db_valid_max:
            raise InvalidRequestError("db_valid_min must be below db_valid_max")


@dataclass(frozen=True)
class AnalysisRequest:
    """What the user asks for. bbox is (west, south, east, north) in degrees."""

    bbox: tuple[float, float, float, float]
    event_type: str
    before_date: date
    after_date: date
    polarisation: str
    thresholds: Thresholds = field(default_factory=Thresholds)
    # Search/selection
    date_tolerance_days: int = 6      # accept acquisitions this close to each requested date
    min_aoi_coverage: float = 0.95    # fraction of the bbox a scene footprint must cover
    # Processing
    input_units: str = "linear"       # units of the retrieved rasters
    resampling: str = "bilinear"      # used only if the two grids differ
    min_overlap_fraction: float = 0.9 # required valid overlap after alignment

    def validate(self) -> None:
        west, south, east, north = self.bbox
        if not (-180 <= west < east <= 180):
            raise InvalidRequestError(
                "bbox must satisfy -180 <= west < east <= 180 (antimeridian crossing is not supported)"
            )
        if not (-90 <= south < north <= 90):
            raise InvalidRequestError("bbox must satisfy -90 <= south < north <= 90")
        if self.before_date >= self.after_date:
            raise InvalidRequestError("before date must be earlier than after date")
        if self.polarisation not in POLARISATIONS:
            raise InvalidRequestError(f"polarisation must be one of {POLARISATIONS}")
        if self.input_units not in INPUT_UNITS:
            raise InvalidRequestError(f"input_units must be one of {INPUT_UNITS}")
        if self.resampling not in RESAMPLING:
            raise InvalidRequestError(f"resampling must be one of {RESAMPLING}")
        if self.date_tolerance_days < 0:
            raise InvalidRequestError("date_tolerance_days must be >= 0")
        if not 0 < self.min_aoi_coverage <= 1:
            raise InvalidRequestError("min_aoi_coverage must be in (0, 1]")
        if not 0 < self.min_overlap_fraction <= 1:
            raise InvalidRequestError("min_overlap_fraction must be in (0, 1]")
        self.thresholds.validate()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["before_date"] = self.before_date.isoformat()
        d["after_date"] = self.after_date.isoformat()
        d["bbox"] = list(self.bbox)
        return d
