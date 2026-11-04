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

    mt = sub.add_parser("modis-trend", help="MODIS 1 km / 5 km trend scenes through Earth Engine (2000-2025)")
    mt.add_argument("--source", choices=["earthengine", "earthdata"], default="earthengine",
                    help="earthengine (needs --project) or earthdata (NASA Earthdata Cloud + Planetary Computer; needs EARTHDATA_TOKEN)")
    mt.add_argument("--project", help="registered Earth Engine Google Cloud project ID (source earthengine)")
    mt.add_argument("--country-deg", type=float, choices=[0.05, 0.1], default=0.1,
                    help="source earthdata: country cells in degrees (0.1 = 2 x 2 CMG cells, about 11 x 8 km; 0.05 makes 22 MB scenes)")
    mt.add_argument("--regions", nargs="*", default=["country", "ub", "gobi", "khovsgol"],
                    help="country (5 km) and/or the 1 km boxes: ub gobi khovsgol")
    mt.add_argument("--vars", nargs="*", default=["lstd", "lstn", "ndvi", "snowdays"],
                    help="lstd lstn ndvi snowdays")
    mt.add_argument("--start", type=int, default=2000)
    mt.add_argument("--end", type=int, default=2025)
    mt.add_argument("--out", type=Path, default=ROOT / "web" / "data")
    mt.add_argument("--geo", type=Path, default=ROOT / "web" / "data" / "geo.js")
    mt.add_argument("--cache", type=Path, default=None, help="per-year pixel cache; a rerun resumes (default cache/modis or cache/modis-earthdata)")

    fire = sub.add_parser("fire-context", help="Landsat 8/9 and Earth Engine fire-weather observations")
    fire.add_argument("--project", required=True, help="registered Earth Engine Google Cloud project ID")
    fire.add_argument("--bbox", required=True, type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    fire.add_argument("--start", required=True, help="inclusive UTC date, YYYY-MM-DD")
    fire.add_argument("--end", required=True, help="exclusive UTC date, YYYY-MM-DD")
    fire.add_argument("--limit", type=int, default=3, help="latest qualifying scenes to process (1–20)")
    fire.add_argument("--out", type=Path, default=ROOT / "cache" / "fire" / "report.json")
    fire.add_argument("--no-previews", action="store_true", help="omit embedded RGB/LST/NDMI images")

    fm = sub.add_parser("fire-map", help="Earth Engine pixels for the existing Risk zones map")
    fm.add_argument("--project", required=True)
    fm.add_argument("--bbox", required=True, type=float, nargs=4)
    fm.add_argument("--start", required=True)
    fm.add_argument("--end", required=True)
    fm.add_argument("--resolution", type=int, default=100)
    fm.add_argument("--out", type=Path, default=ROOT / "web/data/fire-risk.js")

    fs = sub.add_parser("fire-serve", help="serve the existing viewer with a date-driven Earth Engine endpoint")
    fs.add_argument("--project", required=True)
    fs.add_argument("--port", type=int, default=8000)
    fs.add_argument("--dust-dir", type=Path, help="directory of YYYY-MM-DD.nc MODIS observations")
    fs.add_argument("--modis-live", action="store_true", help="download/calibrate MODIS channels using server EARTHDATA_TOKEN")

    dm = sub.add_parser("dust-map", help="classify calibrated daily MODIS observations with IDI/Otsu")
    dm.add_argument("--input", type=Path, required=True, help="co-registered daytime MODIS NetCDF")
    dm.add_argument("--date", required=True, help="exact UTC day, YYYY-MM-DD")
    dm.add_argument("--bbox", type=float, nargs=4)
    dm.add_argument("--water-btd-min", type=float)
    dm.add_argument("--water-r47-min", type=float)
    dm.add_argument("--water-ndai-min", type=float)
    dm.add_argument("--out", type=Path, default=ROOT / "web/data/dust-risk.js")

    ds = sub.add_parser("dust-serve", help="serve daily MODIS observations in the existing viewer")
    source_group = ds.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--input-dir", type=Path, help="directory of YYYY-MM-DD.nc files")
    source_group.add_argument("--modis-live", action="store_true", help="download/calibrate NASA MODIS channels on demand")
    ds.add_argument("--cache", type=Path, default=ROOT/"cache/modis")
    ds.add_argument("--sensor", choices=["terra", "aqua", "both"], default="terra")
    ds.add_argument("--resolution", type=int, default=5000, help="display resolution m; classification remains native 1km")
    ds.add_argument("--port", type=int, default=8000)
    ds.add_argument("--allow-origin", help="exact hosted viewer origin, for an externally hosted API")

    md = sub.add_parser("modis-dust", help="direct NASA MODIS channel download, calibration and daily dust map")
    md.add_argument("--date", help="UTC day YYYY-MM-DD (default: previous UTC day)")
    md.add_argument("--bbox", type=float, nargs=4, default=[87.5, 41.5, 120., 52.5])
    md.add_argument("--sensor", choices=["terra", "aqua", "both"], default="terra")
    md.add_argument("--resolution", type=int, default=5000)
    md.add_argument("--cache", type=Path, default=ROOT/"cache/modis")
    md.add_argument("--plan", action="store_true", help="only list exact-date granules; no credentials/download needed")
    md.add_argument("--out", type=Path, default=ROOT/"web/data/dust-risk.js")

    a = ap.parse_args(argv)
    if a.cmd == "modis-trend":
        from . import modis
        bad = [r for r in a.regions if r not in modis.REGIONS] + [v for v in a.vars if v not in modis.VARS]
        if bad:
            ap.exit(2, f"modis-trend: unknown {', '.join(bad)}; regions {list(modis.REGIONS)}, vars {list(modis.VARS)}\n")
        if a.source == "earthengine" and not a.project:
            ap.exit(2, "modis-trend: --project is required with --source earthengine\n")
        cache = a.cache or ROOT / "cache" / ("modis" if a.source == "earthengine" else "modis-earthdata")
        try:
            built = modis.run(a.project, a.regions, a.vars, a.out, a.geo, cache, a.start, a.end, source=a.source, country_deg=a.country_deg)
        except (ValueError, RuntimeError) as exc:
            ap.exit(2, f"modis-trend: {exc}\n")
        print(f"Wrote {len(built)} scene(s) and updated {a.out / 'index.js'}; open Trend Detective → Datasets")
        return
    if a.cmd == "modis-dust":
        from datetime import datetime, timedelta, timezone
        from .modis_source import discover
        from .modis_daily import build_direct
        from .dust_map import publish
        day = a.date or (datetime.now(timezone.utc).date()-timedelta(days=1)).isoformat()
        try:
            if a.plan:
                groups = discover(day, a.bbox, a.sensor)
                print(json.dumps({"date": day, "granules": [[g.name for g in group] for group in groups]}, indent=2))
            else:
                result = build_direct(day, a.bbox, a.cache, a.sensor, a.resolution)
                if a.out.suffix == ".json":
                    a.out.parent.mkdir(parents=True, exist_ok=True)
                    a.out.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False))
                else:
                    publish(result, a.out)
                print(f"Wrote {a.out}; {result['discovered_granules']} exact-date native MODIS granules")
        except (OSError, ValueError, RuntimeError) as exc:
            ap.exit(2, f"modis-dust: {exc}\n")
    elif a.cmd == "dust-map":
        from .dust import Settings
        from .dust_map import build, publish
        try:
            result = build(a.input, a.date, a.bbox, Settings(
                water_btd_min=a.water_btd_min, water_r47_min=a.water_r47_min,
                water_ndai_min=a.water_ndai_min))
            if a.out.suffix == ".json":
                a.out.parent.mkdir(parents=True, exist_ok=True)
                a.out.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False))
            else:
                publish(result, a.out)
        except (OSError, ValueError, RuntimeError) as exc:
            ap.exit(2, f"dust-map: {exc}\n")
        print(f"Wrote {a.out}; open Risk zones → Yellow dust storm")
    elif a.cmd == "dust-serve":
        from .fire_server import serve
        serve(None, a.port, a.input_dir, modis_live=a.modis_live, modis_cache=a.cache,
              modis_sensor=a.sensor, modis_resolution=a.resolution, allow_origin=a.allow_origin)
    elif a.cmd == "fire-serve":
        from .fire_server import serve
        serve(a.project, a.port, a.dust_dir, modis_live=a.modis_live)
    elif a.cmd == "fire-map":
        from .fire_map import build
        from .payload import write_payload
        try:
            result = build(a.project, a.bbox, a.start, a.end, a.resolution)
        except (ValueError, RuntimeError) as exc:
            ap.exit(2, f"fire-map: {exc}\n")
        a.out.parent.mkdir(parents=True, exist_ok=True)
        if a.out.suffix == ".json":
            a.out.write_text(json.dumps(result, allow_nan=False))
        else:
            from .fire_map import publish
            publish(result, a.out)
        print(f"Wrote {a.out}; open Trend Detective → Risk zones")
    elif a.cmd == "fire-context":
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
