"""Independent formula, missing-data and exact-date checks; fixtures are test only."""
import json

import numpy as np
import pytest
import xarray as xr

from trend_detective.dust import BANDS, Settings, classify, otsu
from trend_detective.dust_map import build, build_day, publish
from trend_detective.payload import read_payload


def bands():
    shape = (2, 4)
    out = {k: np.full(shape, .1) for k in BANDS}
    out.update(b1=np.full(shape, .15), b2=np.full(shape, .3),
               b4=np.full(shape, .2), bt20=np.full(shape, 330.),
               bt31=np.full(shape, 300.), bt32=np.array([[295, 296, 304, 305]] * 2))
    return out


def observation(path):
    data = {k: (("lat", "lon"), a, {"units": "K" if k.startswith("bt") else "1"})
            for k, a in bands().items()}
    data.update({k: (("lat", "lon"), np.zeros((2, 4)), {"units": "1"})
                 for k in ("cloud_mask", "snow_mask")})
    ds = xr.Dataset(data, coords={"lat": [46., 47.], "lon": [104., 105., 106., 107.]},
                    attrs={"acquired_utc": "2025-06-01T03:00:00Z", "source": "TEST ONLY MODIS",
                           "native_resolution_m": 1000})
    ds.to_netcdf(path)
    return ds


def test_thesis_power_formula_and_otsu_direction():
    b = bands()
    c, factors, threshold = classify(b, np.zeros((2, 4)), np.zeros((2, 4)))
    np.testing.assert_allclose(factors["idi"][0], [1.1**-5, 1.1**-4, 1.1**4, 1.1**5])
    np.testing.assert_allclose(factors["ndvi"], 1/3)
    np.testing.assert_array_equal(c, [[0, 0, 1, 1]] * 2)
    assert 1.1**-4 <= threshold < 1.1**4
    assert otsu([np.nan, np.inf]) is None
    assert otsu([1., 1., 1.]) is None


def test_cloud_snow_fill_and_constant_scene_never_mean_clear_land():
    b = bands()
    b["b1"][0, 0] = .6  # thesis red/blue cloud screen
    b["bt31"][0, 1] = -9999
    cloud, snow = np.zeros((2, 4)), np.zeros((2, 4))
    cloud[0, 2], snow[0, 3], cloud[1, 0] = 1, 1, 255
    c, f, _ = classify(b, cloud, snow)
    assert (c[0] == -1).all() and c[1, 0] == -1
    assert np.isnan(f["idi"][0]).all()
    b = bands(); b["bt32"][:] = 300
    c, _, threshold = classify(b, np.zeros((2, 4)), np.zeros((2, 4)))
    assert threshold is None and (c == 4).all()


def test_water_diagram_and_explicit_gates():
    b = bands()
    b["b1"][:] = .1; b["b2"][:] = .11; b["b4"][:] = .2; b["b8"][:] = .01
    c, f, _ = classify(b, np.zeros((2, 4)), np.zeros((2, 4)))
    assert (c == 2).all()  # no invented NDAI threshold
    np.testing.assert_allclose(f["ndai"], 10)
    c, _, _ = classify(b, np.zeros((2, 4)), np.zeros((2, 4)), Settings(
        water_btd_min=20, water_r47_min=.2, water_ndai_min=5))
    assert (c == 3).all()
    with pytest.raises(ValueError, match="together"):
        classify(b, np.zeros((2, 4)), np.zeros((2, 4)), Settings(water_ndai_min=5))


def test_daily_map_units_area_archive_and_missing_day(tmp_path):
    source = tmp_path / '2025-06-01.nc'
    ds = observation(source)
    result = build(source, '2025-06-01')
    # A 4° x 2° spherical rectangle, bounded halfway between pixel centres.
    expected = 6371.0088**2 * np.radians(4) * (np.sin(np.radians(47.5))-np.sin(np.radians(45.5)))
    assert result['areas']['total_km2'] == pytest.approx(expected)
    assert result['areas']['land_dust_km2'] == pytest.approx(expected/2)
    assert result['areas']['missing_km2'] == 0
    json.dumps(result, allow_nan=False)
    publish(result, tmp_path / 'archive/dust-risk.js')
    archive = read_payload(tmp_path / 'archive/dust-map-index.js')
    assert archive['maps'] == [{'date': '2025-06-01', 'key': 'dust-risk-2025-06-01'}]
    assert read_payload(tmp_path / 'archive/dust-risk-2025-06-01.js')['classes'] == result['classes']
    with pytest.raises(RuntimeError, match='No calibrated MODIS'):
        build_day(tmp_path, '2025-06-02')
    with pytest.raises(ValueError, match='requested UTC day'):
        build(source, '2025-06-02')
    ds['bt20'].attrs['units'] = 'C'
    ds.to_netcdf(tmp_path / 'bad.nc')
    with pytest.raises(ValueError, match='units=K'):
        build(tmp_path / 'bad.nc', '2025-06-01')


def test_nonregular_or_missing_input_rejected(tmp_path):
    ds = observation(tmp_path/'source.nc')
    ds = ds.assign_coords(lon=[104., 105., 106., 108.])
    ds.to_netcdf(tmp_path/'bad.nc')
    with pytest.raises(ValueError, match='regular'):
        build(tmp_path/'bad.nc', '2025-06-01')
    ds = ds.drop_vars('bt32'); ds.to_netcdf(tmp_path/'missing.nc')
    with pytest.raises(ValueError, match='Missing calibrated'):
        build(tmp_path/'missing.nc', '2025-06-01')
