"""Daily snow/rain/wind hazard indices and the downwind summary (trend_detective/hazard.py)."""

import numpy as np
import pytest

from trend_detective import hazard as H


def test_daily_flags_follow_the_definitions():
    frsno = np.array([0.0, 0.29, 0.3, 0.0, 0.0, np.nan])
    prec = np.array([0.0, 0.253, 0.0, 0.254, 12.0, 0.0])
    wind = np.array([8.0, 9.0, 12.0, 15.0, 3.0, 9.0])
    f = H.daily_flags(frsno, prec, wind)
    assert f["DUSTDAYS8"].tolist() == [True, True, False, False, False, False]   # snow, wet, calm, NaN all block
    assert f["DUSTDAYS10"].tolist() == [False, False, False, False, False, False]
    assert f["DUSTDAYS6"].tolist() == [True, True, False, False, False, False]
    assert f["SNOWDAYS"].tolist() == [False, False, True, False, False, False]
    assert f["WETDAYS"].tolist() == [False, False, False, True, True, False]  # AP-42: >= 0.254 mm
    assert f["R10MM"].tolist() == [False, False, False, False, True, False]
    assert f["WINDYDAYS8"].tolist() == [True, True, True, True, False, True]


def test_monthly_counts_and_max():
    days = np.arange("2020-01-30", "2020-03-02", dtype="datetime64[D]")  # Jan 30 .. Mar 1
    months, pos = H.month_index(days)
    assert [str(m) for m in months] == ["2020-01", "2020-02", "2020-03"]
    flag = np.ones((days.size, 2), bool)
    flag[:, 1] = False
    c = H.monthly_counts(flag, pos, months.size)
    assert c[:, 0].tolist() == [2, 29, 1] and c[:, 1].tolist() == [0, 0, 0]
    x = np.arange(days.size, dtype=float)
    x[3] = np.nan
    assert H.monthly_max(x, pos, months.size).tolist() == [1.0, 30.0, 31.0]


def test_season_years_put_winter_in_the_year_of_february():
    days = np.arange("1981-01-01", "1983-01-01", dtype="datetime64[D]")
    sy = H.season_years(days, 12, 2)
    assert sy[np.flatnonzero(days == np.datetime64("1981-12-31"))[0]] == 1982
    assert sy[np.flatnonzero(days == np.datetime64("1982-02-28"))[0]] == 1982
    assert sy[np.flatnonzero(days == np.datetime64("1982-03-01"))[0]] == -1
    # Dec 1980 is missing, Dec 1982 is present but Jan-Feb 1983 are not
    assert H.complete_season_years(days, 12, 2).tolist() == [1982]
    assert H.complete_season_years(days, 3, 5).tolist() == [1981, 1982]
    assert H.complete_season_years(days, 1, 12).tolist() == [1981, 1982]


def test_directions():
    assert H.blows_toward(1.0, 0.0) == pytest.approx(90.0)     # westerly wind blows toward the east
    assert H.blows_toward(0.0, -1.0) == pytest.approx(180.0)   # northerly wind blows south
    assert H.bearing(43.0, 105.0, 43.0, 105.5) == pytest.approx(90.0, abs=0.2)
    assert H.distance_km(43.0, 105.0, 44.0, 105.0) == pytest.approx(111.2, abs=0.2)
    assert H.angle_diff(350.0, 10.0) == pytest.approx(20.0)


def test_downwind_summary_counts_days_toward_each_place():
    days = np.arange("1981-01-01", "1983-01-01", dtype="datetime64[D]")
    n = days.size
    dust = np.zeros(n, bool)
    dust[::3] = True                        # every third day is dust-prone
    u, v = np.ones(n), np.zeros(n)          # always blowing toward the east
    u[1::6], v[1::6] = 0.0, -1.0            # some days toward the south (not dust-prone: index 1 mod 3)
    mine = {"id": "m", "name": "Mine", "lat": 43.0, "lon": 105.0}
    places = [{"name": "East", "mn": "", "lat": 43.0, "lon": 105.3, "source": "test"},
              {"name": "North", "mn": "", "lat": 43.3, "lon": 105.0, "source": "test"}]
    s = H.downwind_summary(days, dust, u, v, mine, places)
    yr = s["seasons"]["all"]
    assert yr["years"] == [1981, 1982]
    assert sum(yr["dust_days_per_year"]) == dust.sum()
    assert yr["places"][0]["per_year"] == yr["dust_days_per_year"]   # all dust-prone days blow east
    assert yr["places"][1]["per_year"] == [0, 0]
    assert [row[4] for row in yr["sectors_per_year"]] == yr["dust_days_per_year"]   # sector 4 of 16 = east
    assert all(sum(row) == d for row, d in zip(yr["sectors_per_year"], yr["dust_days_per_year"]))
    assert s["settlements"][0]["bearing"] == pytest.approx(90.0, abs=0.3)
    assert s["seasons"]["djf"]["years"] == [1982]


def test_index_table_is_complete():
    flags = H.daily_flags(np.zeros(1), np.zeros(1), np.zeros(1))
    assert set(flags) | {"RX1DAY"} == set(H.INDICES)
    for mine in H.MINES:
        assert H.settlements_for(mine["id"])
