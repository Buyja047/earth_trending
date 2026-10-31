"""Command line: ``python -m trend_detective <command>``.

  build      precompute every scene + the Mongolia variable screen into web/data
  series     trend report for one variable averaged over a lon/lat box
  vars       list the monthly variables of a product, optionally filtered
  furniture  rebuild coastlines (world-atlas) and searchable places (GeoNames)
  catalog    rebuild the variable catalog the viewer uses for live analysis
  dust-check read one month of MERRA-2 dust both ways (needs EARTHDATA_TOKEN)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import analysis, catalog, power
from .geo import build_geo, build_places
from .gesdisc import verify as verify_dust
from .livecat import build_catalog
from .scenes import _breaks, _stats_json, build_all

ROOT = Path(__file__).resolve().parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(prog="trend_detective")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="precompute scenes for the web viewer")
    b.add_argument("--out", type=Path, default=ROOT / "web" / "data")
    b.add_argument("--geo", type=Path, default=ROOT / "web" / "data" / "geo.js")
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

    f = sub.add_parser("furniture", help="rebuild web/data/geo.js and web/data/places.js")
    f.add_argument("--world-atlas", type=Path, help="extracted `npm pack world-atlas@2.0.2` package/ dir")
    f.add_argument("--geonames", type=Path, help="dir with GeoNames MN.txt and cities15000.txt")

    sub.add_parser("catalog", help="rebuild web/data/power-catalog.js (live analysis)")
    sub.add_parser("dust-check", help="check GES DISC access and the server-side subset")

    fire = sub.add_parser("fire-context", help="Landsat 8/9 and Earth Engine fire-weather observations")
    fire.add_argument("--project", required=True, help="registered Earth Engine Google Cloud project ID")
    fire.add_argument("--bbox", required=True, type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    fire.add_argument("--start", required=True, help="inclusive UTC date, YYYY-MM-DD")
    fire.add_argument("--end", required=True, help="exclusive UTC date, YYYY-MM-DD")
    fire.add_argument("--limit", type=int, default=3, help="latest qualifying scenes to process (1–20)")
    fire.add_argument("--out", type=Path, default=ROOT / "cache" / "fire" / "report.json")
    fire.add_argument("--no-previews", action="store_true", help="omit embedded RGB/LST/NDMI images")

    a = ap.parse_args(argv)
    if a.cmd == "fire-context":
        from .fire import run
        try:
            report = run(a.project, a.bbox, a.start, a.end, a.limit, not a.no_previews)
        except (ValueError, RuntimeError) as exc:
            ap.exit(2, f"fire-context: {exc}\n")
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        print(f"wrote {len(report['scenes'])} of {report['matched_scene_count']} matching scenes to {a.out}")
    elif a.cmd == "build":
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
    elif a.cmd == "dust-check":
        print(json.dumps(verify_dust(), indent=2))
    elif a.cmd == "catalog":
        cat = build_catalog(ROOT / "web" / "data" / "power-catalog.js")
        for p, e in cat["products"].items():
            print(p, len(e["vars"]), "variables,", len(e["skipped_vars"]), "skipped,", e["chunk_mb"], "MB/chunk")
    elif a.cmd == "furniture":
        data = ROOT / "web" / "data"
        if a.world_atlas:
            build_geo(a.world_atlas, data / "geo.js")
            print("wrote", data / "geo.js")
        if a.geonames:
            print("wrote", len(build_places(a.geonames, data / "places.js")), "places")


if __name__ == "__main__":
    main()
