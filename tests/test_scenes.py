import base64

import numpy as np

from trend_detective.payload import read_payload, write_payload
from trend_detective.scenes import box_regrid, encode_series


def test_series_roundtrip():
    arr = np.array([[0.5, -1.25, np.nan], [2.0, 0.0, 1.0]])
    b64, scale = encode_series(arr)
    q = np.frombuffer(base64.b64decode(b64), dtype="<i2").reshape(arr.shape)
    back = np.where(q == -32768, np.nan, q * scale)
    np.testing.assert_allclose(back, arr, atol=scale)


def test_box_regrid_averages_fine_cells():
    lat_src = np.array([0.25, 0.75])
    lon_src = np.array([0.25, 0.75, 1.25, 1.75])
    v = np.arange(8, dtype=float).reshape(1, 2, 4)
    out = box_regrid(v, lat_src, lon_src, np.array([0.5]), np.array([0.5, 1.5]))
    np.testing.assert_allclose(out[0, 0], [np.mean([0, 1, 4, 5]), np.mean([2, 3, 6, 7])])


def test_nsidc_csv_parsing_maps_missing_to_nan():
    from trend_detective.nsidc import parse_monthly_csv

    text = ("year, mo,source_dataset, region, extent,   area\n"
            "1987, 12,         -9999,      S,  -9999,  -9999\n"
            "2025,  1,    NSIDC-0803,      S,   4.69,   2.84\n")
    rows = parse_monthly_csv(text)
    assert rows[(1987, 12)][0] == ""
    assert np.isnan(rows[(1987, 12)][1]) and np.isnan(rows[(1987, 12)][2])
    assert rows[(2025, 1)] == ("NSIDC-0803", 4.69, 2.84)


def test_payload_roundtrip(tmp_path):
    obj = {"a": [1, 2.5, None], "s": "x,y)"}
    path = tmp_path / "k.js"
    write_payload(path, "k", obj)
    assert path.read_text().startswith('TD_DATA("k",')
    assert read_payload(path) == obj
