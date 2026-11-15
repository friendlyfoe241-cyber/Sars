import math

import numpy as np
import pytest

from nisar_change.analysis import compute_change
from nisar_change.config import Thresholds
from nisar_change.errors import IncompatibleDataError
from nisar_change.events import get_method
from nisar_change.raster import Raster, align_pair, to_db

from helpers import make_raster, request, synthetic_pair


def run(th=None):
    b, a = synthetic_pair()
    req = request(thresholds=th or Thresholds(change_db=3.0, direction="decrease"))
    return get_method("deforestation").analyse(b, a, req), b


def test_counts_areas_and_percentages_match_hand_calculation():
    res, _ = run()
    s = res.stats
    assert s["total_pixels"] == 10_000
    assert s["valid_pixels"] == 10_000 - 25 - 25          # 5x5 zero + 5x5 NaN
    assert s["changed_pixels"] == 900                      # patch A only (B is -2.9 dB, C increases)
    assert s["changed_area_km2"] == pytest.approx(900 * 900 / 1e6)   # 30 m pixels = 900 m2
    assert s["analysed_area_km2"] == pytest.approx(9950 * 900 / 1e6)
    assert s["changed_percent"] == pytest.approx(100 * 900 / 9950)


def test_mean_min_max_before_after_and_change():
    res, _ = run()
    t = res.backscatter_table.set_index("statistic")
    expected_mean_diff = (900 * -6.0 + 100 * -2.9 + 100 * 6.0) / 9950
    assert t.loc["mean_backscatter", "before"] == pytest.approx(-15.0, abs=1e-4)
    assert t.loc["mean_backscatter", "after"] == pytest.approx(-15.0 + expected_mean_diff, abs=1e-4)
    assert t.loc["mean_backscatter", "change"] == pytest.approx(expected_mean_diff, abs=1e-4)
    assert t.loc["min_backscatter", "before"] == pytest.approx(-15.0, abs=1e-4)
    assert t.loc["min_backscatter", "after"] == pytest.approx(-21.0, abs=1e-4)
    assert t.loc["max_backscatter", "after"] == pytest.approx(-9.0, abs=1e-4)
    assert res.stats["mean_difference_db"] == pytest.approx(expected_mean_diff, abs=1e-4)


def test_pixelwise_difference_and_invalid_pixels_are_nan():
    res, _ = run()
    assert res.diff_db[20, 20] == pytest.approx(-6.0, abs=1e-4)
    assert res.diff_db[55, 55] == pytest.approx(-2.9, abs=1e-4)
    assert res.diff_db[75, 75] == pytest.approx(6.0, abs=1e-4)
    assert np.isnan(res.diff_db[2, 2]) and np.isnan(res.diff_db[92, 92])
    assert not res.changed[2, 2] and not res.changed[92, 92]


def test_threshold_is_configurable():
    res, _ = run(Thresholds(change_db=2.5, direction="decrease"))
    assert res.stats["changed_pixels"] == 1000             # A (900) + B (100)
    res, _ = run(Thresholds(change_db=7.0, direction="decrease"))
    assert res.stats["changed_pixels"] == 0


def test_direction_options():
    assert run(Thresholds(3.0, "increase"))[0].stats["changed_pixels"] == 100   # patch C
    assert run(Thresholds(3.0, "both"))[0].stats["changed_pixels"] == 1000      # A + C


def test_kinds_distinguish_measurement_from_estimate():
    res, _ = run()
    kinds = dict(zip(res.classification_table.metric, res.classification_table.kind))
    assert kinds["mean_difference"] == "measured"
    assert kinds["changed_pixels"] == "classification"
    assert kinds["changed_area"] == "estimate" and kinds["changed_percent"] == "estimate"


def test_geographic_pixel_area_shrinks_with_latitude():
    t0 = (0.001, 0.0, 10.0, 0.0, -0.001, 1.0)
    t60 = (0.001, 0.0, 10.0, 0.0, -0.001, 60.5)
    r0 = Raster(np.ones((2, 2), "float32"), t0, "EPSG:4326", True)
    r60 = Raster(np.ones((2, 2), "float32"), t60, "EPSG:4326", True)
    ratio = float(r60.pixel_area_km2()[0, 0] / r0.pixel_area_km2()[0, 0])
    # first-row pixel centres are at 0.9995 deg and 60.4995 deg
    expected = math.cos(math.radians(60.4995)) / math.cos(math.radians(0.9995))
    assert ratio == pytest.approx(expected, rel=1e-6)
    assert float(r0.pixel_area_km2()[0, 0]) == pytest.approx(0.0123637, rel=0.01)


def test_linear_input_with_negative_values_is_rejected():
    r = make_raster(np.full((4, 4), -15.0), linear=False)       # dB values labelled as linear
    with pytest.raises(IncompatibleDataError, match="negative"):
        to_db(r, "linear", -50, 20)


def test_db_range_marks_outliers_invalid():
    r = make_raster(np.array([[-15.0, -80.0], [30.0, -10.0]]))
    db = to_db(r, "linear", -50, 20)
    assert np.isnan(db[0, 1]) and np.isnan(db[1, 0]) and db[0, 0] == pytest.approx(-15, abs=1e-4)


def test_no_valid_pixels_and_shape_mismatch_raise():
    nan = np.full((3, 3), np.nan)
    with pytest.raises(IncompatibleDataError, match="no pixel"):
        compute_change(nan, nan, 0.0009, Thresholds())
    with pytest.raises(IncompatibleDataError, match="differ"):
        compute_change(np.zeros((3, 3)), np.zeros((4, 4)), 0.0009, Thresholds())


def test_identical_grids_are_not_resampled_and_unit_mismatch_is_refused():
    b, a = synthetic_pair()
    _, info = align_pair(b, a)
    assert info["resampled"] is False
    with pytest.raises(IncompatibleDataError, match="cannot compare"):
        align_pair(b, make_raster(np.full((100, 100), -15.0), linear=False))


def test_shifted_grid_is_reprojected_onto_before_grid():
    pytest.importorskip("rasterio")
    b, _ = synthetic_pair()
    shifted = make_raster(np.full((100, 100), -15.0),
                          transform=(30.0, 0.0, 500000.0 + 30 * 10, 0.0, -30.0, 9000000.0))
    aligned, info = align_pair(b, shifted, "nearest", min_overlap=0.8)
    assert info["resampled"] and aligned.shape == b.shape
    assert np.isnan(aligned.data[:, :10]).all()      # left 10 columns are outside the shifted scene
    with pytest.raises(IncompatibleDataError, match="overlap"):
        align_pair(b, shifted, "nearest", min_overlap=0.95)
