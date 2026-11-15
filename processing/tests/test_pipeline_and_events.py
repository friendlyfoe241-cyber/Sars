import json
from pathlib import Path

import numpy as np
import pytest

from nisar_change import pipeline, run_analysis
from nisar_change.errors import NoSuitableObservationsError, UnsupportedEventError
from nisar_change.events import METHODS, get_method
from nisar_change.raster import decimate, decimation_factor, read_geotiff

from helpers import granule, make_raster, request, synthetic_pair


def test_unsupported_events_refuse_instead_of_reusing_deforestation():
    b, a = synthetic_pair()
    for name in ("wildfire", "flood", "earthquake_deformation"):
        m = get_method(name)
        assert not m.supported and m.requirements
        with pytest.raises(UnsupportedEventError, match="not implemented"):
            m.analyse(b, a, request(event_type=name))
    with pytest.raises(UnsupportedEventError, match="Unknown"):
        get_method("tornado")
    assert METHODS["deforestation"].supported


def _fakes():
    b, a = synthetic_pair()
    gs = [granule("BEFORE_G", "2026-10-25"), granule("AFTER_G", "2026-11-06")]
    return dict(
        search=lambda bbox, start, end: gs,
        cmr=lambda g: {"granule_concept_id": f"G-{g.id}", "collection_concept_id": "C1",
                       "start_time_matches_asf": True},
        retrieve=lambda g, bbox, pol, cache, info: (Path(g.id + ".tif"), {"job_id": "J1"}),
        reader=lambda path, units: b if str(path).startswith("BEFORE") else a,
    )


def test_end_to_end_with_synthetic_rasters(tmp_path):
    run = run_analysis(request(), tmp_path, write_geotiff=False, pixel_csv_max=500, **_fakes())
    for name in ("backscatter_csv", "classification_csv", "results_json", "metadata_json",
                 "pixels_csv"):
        assert run.paths[name].exists(), name
    results = json.loads(run.paths["results_json"].read_text())
    assert results["statistics"]["changed_pixels"] == 900
    meta = json.loads(run.paths["metadata_json"].read_text())
    assert meta["source_granules"]["before"]["id"] == "BEFORE_G"
    assert meta["polarisation"] == "HV" and meta["processing"]["thresholds"]["change_db"] == 3.0
    assert set(meta["apis_used"]) == {"ASF Search API", "NASA CMR", "NASA Harmony"}
    assert meta["limitations"] and meta["selection_explanation"]
    assert "password" not in json.dumps(meta).lower()
    assert len(run.paths["pixels_csv"].read_text().splitlines()) == 501


def test_no_observations_gives_error_and_no_files(tmp_path):
    fakes = _fakes()
    fakes["search"] = lambda bbox, start, end: []
    with pytest.raises(NoSuitableObservationsError):
        run_analysis(request(), tmp_path, write_geotiff=False, **fakes)
    assert not list(tmp_path.glob("*.csv"))


def test_unsupported_event_fails_before_any_network_call(tmp_path):
    def boom(*a, **k):
        raise AssertionError("network used")
    fakes = _fakes()
    fakes["search"] = boom
    with pytest.raises(UnsupportedEventError):
        run_analysis(request(event_type="flood"), tmp_path, write_geotiff=False, **fakes)


def test_analysis_grid_is_decimated_when_the_area_exceeds_the_cap(tmp_path, monkeypatch):
    """A 100x100 grid with a cap of 2500 pixels is analysed on every 2nd pixel."""
    monkeypatch.setattr(pipeline, "MAX_ANALYSIS_PIXELS", 2500)
    run = run_analysis(request(), tmp_path, write_geotiff=False, **_fakes())
    proc = run.metadata["processing"]
    dec = proc["analysis_grid_decimation"]
    assert dec["factor"] == 2
    assert dec["analysis_pixel_size_m_approx"] == [60.0, 60.0]
    assert dec["native_pixel_size_m_approx"] == [30.0, 30.0]
    assert proc["analysis_grid"]["rows"] == 50 and proc["analysis_grid"]["cols"] == 50
    s = run.stats
    # [::2, ::2] of the synthetic pair: 9 invalid pixels of each scene land on
    # the subsampled grid -> 2500 - 18 valid; the 30x30 -6 dB patch becomes 15x15
    assert s["valid_pixels"] == 2482
    assert s["changed_pixels"] == 225


def test_decimation_is_an_exact_subsample(tmp_path):
    pytest.importorskip("rasterio")
    import rasterio
    from rasterio.transform import from_origin

    assert decimation_factor(10000, 10000) == 1
    assert decimation_factor(25000000, 6000000) == 3

    b, _ = synthetic_pair()
    d = decimate(b, 2)
    assert d.shape == (50, 50)
    assert np.array_equal(d.data, b.data[::2, ::2])   # exact values, no smoothing
    assert d.transform == (60.0, 0.0, 500000.0, 0.0, -60.0, 9000000.0)

    path = tmp_path / "grid.tif"
    data = np.arange(12 * 12, dtype="float32").reshape(12, 12)
    with rasterio.open(path, "w", driver="GTiff", height=12, width=12, count=1,
                       dtype="float32", crs="EPSG:32635",
                       transform=from_origin(500000, 9000000, 20, 20), nodata=np.nan) as ds:
        ds.write(data, 1)
    full = read_geotiff(path, "linear")
    sub = read_geotiff(path, "linear", decimate=3)
    assert np.array_equal(sub.data, full.data[::3, ::3])
    assert sub.transform == (60.0, 0.0, 500000.0, 0.0, -60.0, 9000000.0)
