"""Command line: ``python -m trend_detective <command>``.

  build    precompute every scene + the Mongolia variable screen into web/data
  series   trend report for one variable averaged over a lon/lat box
  vars     list the monthly variables of a product, optionally filtered
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from . import analysis, catalog, power
from .scenes import _breaks, _stats_json, build_all

ROOT = Path(__file__).resolve().parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(prog="trend_detective")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="precompute scenes for the web viewer")
    b.add_argument("--out", type=Path, default=ROOT / "web" / "data")
    b.add_argument("--geo", type=Path, default=ROOT / "web" / "data" / "geo.json")
    b.add_argument("--only", nargs="*", help="scene ids to build (default: all)")
    b.add_argument("--no-screen", action="store_true", help="skip the variable screen")
    b.add_argument("--screen-limit", type=int, help="screen only the first N variables per product")

    s = sub.add_parser("series", help="trend report for a box-averaged variable")
    s.add_argument("product", choices=sorted(power.STORES))
    s.add_argument("var")
    s.add_argument("--bbox", type=float, nargs=4, metavar=("LON0", "LAT0", "LON1", "LAT1"),
                   required=True)
    s.add_argument("--start", default="1981-01")
    s.add_argument("--end", default="2025-12")

    v = sub.add_parser("vars", help="list variables")
    v.add_argument("product", choices=sorted(power.STORES))
    v.add_argument("--grep", default="")

    a = ap.parse_args(argv)
    if a.cmd == "build":
        idx = build_all(a.out, a.geo, a.only, screen=not a.no_screen, screen_limit=a.screen_limit)
        print(f"wrote {len(idx['scenes'])} scenes to {a.out}")
    elif a.cmd == "series":
        da = power.load(a.product, a.var, tuple(a.bbox), a.start, a.end)
        series = analysis.region_series(da.values, da["time"].values, da["lat"].values)
        rm = analysis.analyze_region(series, da["time"].values, _breaks(a.product, a.var)[0])
        report = {"product": a.product, "var": a.var, "units": da.attrs.get("units"),
                  "bbox": a.bbox, "years": round(rm["years"], 2),
                  "per_decade": _stats_json(rm["stats"])}
        print(json.dumps(report, indent=2))
    elif a.cmd == "vars":
        for r in power.variable_table(a.product):
            text = f"{r['var']:<22} {r['units']:<10} {r['long_name']}"
            if a.grep.lower() in text.lower():
                flag = "" if catalog.screenable(r["var"]) else "  (not screened)"
                print(text + flag)


if __name__ == "__main__":
    main()
