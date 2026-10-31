"""Scientific conversions and request boundaries; no remote credentials required."""
import math
from unittest.mock import patch

import pytest

from trend_detective import fire


def test_weather_units_humidity_and_wind_convention():
    values = fire.weather_values(303.15, 283.15, 3, 4, 85000)
    assert values["air_temperature_c"] == pytest.approx(30)
    assert values["relative_humidity_pct"] == pytest.approx(28.94, abs=.1)
    assert values["vapor_pressure_deficit_kpa"] == pytest.approx(3.015, abs=.01)
    assert values["wind_speed_ms"] == 5
    assert values["wind_from_degrees"] == pytest.approx(216.87, abs=.01)
    assert values["surface_pressure_hpa"] == 850


def test_saturated_air_and_calm_wind():
    values = fire.weather_values(280, 280, 0, 0, 100000)
    assert values["relative_humidity_pct"] == 100
    assert values["vapor_pressure_deficit_kpa"] == 0
    assert values["wind_from_degrees"] is None
    assert fire.weather_values(280, 282, 0, -2, 100000)["wind_from_degrees"] == 0


@pytest.mark.parametrize("bbox,start,end,limit", [
    ([107, 47, 106, 48], "2025-01-01", "2025-02-01", 3),
    ([106, 47, math.nan, 48], "2025-01-01", "2025-02-01", 3),
    ([80, 40, 120, 50], "2025-01-01", "2025-02-01", 3),
    ([106.7, 47.7, 107, 47.9], "2025-01-01", "2024-02-01", 3),
    ([106.7, 47.7, 107, 47.9], "2012-01-01", "2012-02-01", 3),
    ([106.7, 47.7, 107, 47.9], "2023-01-01", "2025-02-01", 3),
    ([106.7, 47.7, 107, 47.9], "2025-01-01", "2025-02-01", 0),
])
def test_bad_requests_fail_before_authentication(bbox, start, end, limit):
    with pytest.raises(ValueError):
        fire.run("unused", bbox, start, end, limit)


def test_valid_small_request():
    fire.validate([106.7, 47.7, 107, 47.9], "2025-04-01", "2025-10-01", 3)


def test_earth_engine_expression_builds_with_real_sdk():
    ee = pytest.importorskip("ee")
    from ee.apitestcase import GetAlgorithms
    ee.Reset()
    try:
        with patch.object(ee.data, "_install_cloud_api_resource"), patch.object(ee.data, "getAlgorithms", GetAlgorithms):
            ee.Initialize(None, "", project="offline-test")
            region = ee.Geometry.Rectangle([106.7, 47.7, 107, 47.9])
            collection = fire.collection(ee, region, "2025-04-01", "2025-10-01")
            graph = collection.serialize()
            assert all(v in graph for v in ["CLOUD_COVER", "L2SP", *fire.LANDSAT])
            image = fire.prepare_landsat(ee.Image(collection.first()))
            image.reduceRegion(ee.Reducer.mean(), region, 30, maxPixels=5e7, tileScale=4).serialize()
            bands = image.serialize()
            assert all(v in bands for v in ["ST_B10", "QA_PIXEL", "QA_RADSAT", "ndmi", "nbr", "lst_uncertainty_k"])
    finally:
        ee.Reset()
