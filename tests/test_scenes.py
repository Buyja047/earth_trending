import base64

import numpy as np

from trend_detective.scenes import _write_series, box_regrid


def test_series_roundtrip(tmp_path):
    arr = np.array([[0.5, -1.25, np.nan], [2.0, 0.0, 1.0]])
    path = tmp_path / "s.series.txt"
    scale = _write_series(path, arr)
    q = np.frombuffer(base64.b64decode(path.read_text()), dtype="<i2").reshape(arr.shape)
    back = np.where(q == -32768, np.nan, q * scale)
    np.testing.assert_allclose(back, arr, atol=scale)


def test_box_regrid_averages_fine_cells():
    lat_src = np.array([0.25, 0.75])
    lon_src = np.array([0.25, 0.75, 1.25, 1.75])
    v = np.arange(8, dtype=float).reshape(1, 2, 4)
    out = box_regrid(v, lat_src, lon_src, np.array([0.5]), np.array([0.5, 1.5]))
    np.testing.assert_allclose(out[0, 0], [np.mean([0, 1, 4, 5]), np.mean([2, 3, 6, 7])])
