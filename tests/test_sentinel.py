"""Sentinel-5P aerosol index: averaging 0.1 deg pixels onto model cells (trend_detective/sentinel.py), offline."""

import numpy as np

from trend_detective import sentinel as S


def test_cell_edges_of_the_hazard_grid():
    lat, lon = np.arange(41.0, 52.51, 0.5), np.arange(87.5, 120.01, 0.625)
    assert (lat.size, lon.size) == (24, 53)
    assert S.cell_edges(lat, lon) == (87.1875, 40.75, 120.3125, 52.75)


def test_to_cells_averages_pixels_and_needs_half_of_them():
    cell_lat, cell_lon = np.array([41.0, 41.5]), np.array([87.5, 88.125])
    lat = 41.65 - 0.1 * np.arange(10)    # pixel centres north to south, like the files; 41.25 and 40.75 sit on edges
    lon = 87.25 + 0.1 * np.arange(12)
    field = np.ones((10, 12))
    field[5:] = 3.0                      # rows 41.15..40.75: the southern cells (41.25 goes north)
    field[:5, 6:] = np.nan               # north-east cell empty
    out = S.to_cells(field, lat, lon, cell_lat, cell_lon)
    assert out[0, 0] == 3.0 and out[0, 1] == 3.0 and out[1, 0] == 1.0
    assert np.isnan(out[1, 1])
    field[:5, 6:] = 2.0
    field[:2, 6:] = np.nan               # 3 of 5 rows valid: kept
    assert S.to_cells(field, lat, lon, cell_lat, cell_lon)[1, 1] == 2.0
    field[:3, 6:] = np.nan               # 2 of 5 rows valid: under half, unknown
    assert np.isnan(S.to_cells(field, lat, lon, cell_lat, cell_lon)[1, 1])
