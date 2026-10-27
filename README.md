# Trend Detective

A prototype for the NASA Space Apps 2026 challenge **"Be an Earth System Trend
Detective"**. Pick a variable measured by a NASA mission or produced by a NASA
model, and the tool reports **what** is changing, **where**, **how much**, and
whether the change is **significant** once autocorrelation, multiple testing,
record length and data-source changes are taken into account.

![layers](https://img.shields.io/badge/data-NASA%20POWER%20v10%20(MERRA--2%2C%20CERES%2C%20IMERG)-1d4e63)

## What it does

- **Reads real NASA data** from the public NASA POWER v10 analysis-ready Zarr
  stores on AWS Open Data (no login): MERRA-2 reanalysis (model, 1981-),
  CERES SYN1deg (satellites, 2001-) and GPM IMERG precipitation (satellites, 1998-).
- **Tests every grid cell** with an autocorrelation-corrected Mann-Kendall
  test, a Theil-Sen slope with confidence interval, and an independent
  OLS + AR(1) check.
- **Controls false discoveries across the map** with Benjamini-Hochberg FDR
  (alpha_FDR = 2 alpha_global, Wilks 2016) and shows the naive map beside it.
- **Says "not yet detectable"** instead of "no trend" when the record is too
  short (Weatherhead et al. 1998), and shows the smallest trend each cell
  could detect.
- **Guards against artificial trends**: tests for steps at documented
  instrument and data-source changes, excludes cells with missing months and
  explains why.
- **Finds opposite-sign regions** in the same variable (Arctic vs Antarctic
  sea ice; wetting vs drying soils).
- **Screens every variable** in a region (Mongolia: 94 MERRA-2 and CERES
  variables) and ranks them by change relative to noise.
- **Cross-checks a model against satellites** (MERRA-2 vs GPM IMERG precipitation).
- **Validates itself**: a known-truth synthetic map and a Monte Carlo table of
  false-positive and detection rates ship with the viewer.

## Run it

```bash
pip install -r requirements.txt
python -m pytest -q                       # statistics + browser/Python agreement
python -m trend_detective.validation      # Monte Carlo table -> web/data/validation.json
python -m trend_detective build           # download, analyse, write web/data/ (~20 min)
cd web && python -m http.server 8000      # open http://localhost:8000
```

Other commands:

```bash
python -m trend_detective vars merra2 --grep soil
python -m trend_detective series merra2 T2M --bbox 104 43 107 45 --start 1981-01 --end 2025-12
python -m trend_detective build --only mn-t2m mn-precip --no-screen
```

Scenes are defined in `trend_detective/scenes.py`; add a `SceneSpec` to
analyse another variable or region.

## Layout

```
trend_detective/
  stats.py       per-cell statistics (MK, Hamed-Rao AR(1), Sen, OLS-AR(1), FDR, Weatherhead, step test)
  analysis.py    field analysis, verdicts, region means
  grid.py        area weights, connected opposite-sign regions
  power.py       NASA POWER Zarr access (anonymous HTTPS, cached)
  catalog.py     products, documented data-source transitions, notes
  scenes.py      scene definitions, variable screen, model-vs-satellite comparison
  synthetic.py   known-truth test fields
  validation.py  Monte Carlo size/power table
  geo.py         coastlines and borders (Natural Earth via world-atlas)
web/             static viewer (index.html, css/, js/, data/)
tests/           pytest suite, including JS-vs-Python agreement
docs/METHODS.md  methods, validation results, data traps, limits
```

## Results worth looking at

See the viewer and `docs/METHODS.md`. Highlights:

- On a synthetic map with known trends, about two thirds of cells flagged by
  a naive p < 0.05 map are false; after FDR it is close to the 10 % target.
- The published Hamed-Rao test rejected 15 % of trend-free records at
  phi = 0.6 in our Monte Carlo runs; the AR(1)-modelled variant used here
  stays at 5 %.
- NASA POWER masks total ozone below 200 DU, which removes the Antarctic
  ozone hole; the tool detects this and refuses to compute censored trends.
- MERRA-2 Antarctic sea-ice area trends conflict with NSIDC; the tool shows
  the source changes behind MERRA-2's sea-ice boundary data.

## Монгол хураангуй

**Trend Detective** нь NASA-гийн хиймэл дагуул болон загварын хувьсагч бүрийн
хувьд **юу**, **хаана**, **хэр их** өөрчлөгдөж байгааг, мөн тэр өөрчлөлт
**статистикийн хувьд бодит эсэхийг** тогтоодог прототип хэрэгсэл.

- Өгөгдөл: NASA POWER v10 (MERRA-2 загвар 1981-, CERES хиймэл дагуул 2001-,
  GPM IMERG 1998-), AWS дээрх нээлттэй Zarr, нэвтрэх эрх шаардахгүй.
- Нүд бүрт: автокорреляцид засварласан Mann-Kendall тест, Sen-ий налуу ба
  95 %-ийн итгэлийн завсар, OLS + AR(1) хяналтын тест.
- Газрын зураг бүхэлдээ: FDR (Wilks 2016) — naive газрын зурагтай зэрэгцүүлж харуулна.
- "Чиг байхгүй" биш, "одоогоор илрэх боломжгүй" гэж хэлдэг (Weatherhead 1998).
- Сенсор, өгөгдлийн эх сурвалж солигдсон огноонуудад алхамын тест хийнэ.
- Монгол орны 94 хувьсагчийг өөрчлөлтийн хэмжээгээр нь эрэмбэлнэ.
- MERRA-2 загварыг GPM IMERG хиймэл дагуултай харьцуулна.

Ажиллуулах: дээрх "Run it" хэсгийг үзнэ үү.

## Before submitting to Space Apps

This prototype was written before the hackathon. Some secondary sources say
2026 projects must be created during the event; the official 2026 Project
Submission Guide (due 13 Nov 2026) decides. Check it, and if prior work is
allowed, list this repository under References.

## Data and licences

- NASA POWER v10 on AWS Open Data, `s3://nasa-power`, CC BY 4.0.
  The POWER project is funded by the NASA Applied Sciences Program.
- Boundaries: Natural Earth via `world-atlas` 2.0.2 (ISC).
- Statistical references are listed in `docs/METHODS.md`.
