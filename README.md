# Trend Detective

A prototype for the NASA Space Apps 2026 challenge **"Be an Earth System Trend
Detective"**. Pick a variable measured by a NASA mission or produced by a NASA
model, and the tool reports **what** is changing, **where**, **how much**, and
whether the change is **significant** once autocorrelation, multiple testing,
record length and data-source changes are taken into account.

English and Mongolian interface · works offline · no installation needed to view.

---

## Open it in one minute (no installation)

1. On GitHub press **Code → Download ZIP** (or use
   `https://github.com/Buyja047/earth_trending/archive/refs/heads/main.zip`).
2. Unzip the file anywhere.
3. Double-click **`TrendDetective.html`** in the unzipped folder.

That is all. The viewer runs in any modern browser (Chrome, Edge, Firefox,
Safari), works without internet once unzipped, and keeps every calculation on
your computer. Keep the `web/` folder next to `TrendDetective.html`.

## Нэг минутад нээх (суулгах шаардлагагүй)

1. GitHub дээр **Code → Download ZIP** дарна (эсвэл
   `https://github.com/Buyja047/earth_trending/archive/refs/heads/main.zip`).
2. Татсан ZIP файлаа хүссэн газраа задална.
3. Задалсан хавтас доторх **`TrendDetective.html`** файлыг давхар товшино.

Ингээд л болно. Хөтөч (Chrome, Edge, Firefox, Safari) дээр ажиллана, задалсны
дараа интернэтгүй ажиллана, бүх тооцоо таны компьютер дээр хийгдэнэ.
`web/` хавтсыг `TrendDetective.html`-ийн хажууд байлгаарай. Хэлийг баруун
дээд буланд **EN / МН** товчоор солино.

---

## What you can do in the viewer

- **Datasets** (left panel): global MERRA-2 temperature, precipitation, soil
  wetness, sea ice and ozone (1981–2025); Mongolia temperature, precipitation,
  soil wetness, wind, snow (1981–2025), CERES aerosol and IMERG precipitation
  (2001–2025); a known-truth test field.
- **Layers** (right edge of the map, as on windy.com): FDR-tested trend, naive
  trend, verdict, smallest detectable trend, year-by-year anomaly, data-source
  steps.
- **Timeline** under the map: press ▶ to play the anomalies year by year.
- **Years**: pick a start and end year and press Apply. Every trend, test,
  false-discovery threshold and count is recomputed in the browser (monthly
  values for Mongolia, annual means for the globe). Change α the same way.
- **Click a cell** for its time series and statistics; **drag a box** to
  average a region (on touch screens switch on *Box select* first).
- **3D surface** (toolbar or View menu): the trend field as a landscape; drag
  to rotate, scroll to zoom, change the height.
- **Search** Mongolian aimag centres, Oyu Tolgoi, the Tavan Tolgoi airfield
  and world capitals (GeoNames).
- **Analysis tab**: area means, the start/end-year triangle, case notes, and
  cross-checks (MERRA-2 vs GPM IMERG precipitation; MERRA-2 vs NSIDC sea ice).
- **Variable ranking tab**: 91 MERRA-2 and CERES variables over Mongolia.
- **Method tab**: how significance is decided, with a Monte Carlo check.
- **Legend**: click the unit to switch between per decade, per year and total.
- **View menu**: light, dark or system theme; hide side panels.

## What it does

- **Reads real NASA data** from the public NASA POWER v10 analysis-ready Zarr
  stores on AWS Open Data (no login): MERRA-2 reanalysis (model, 1981-),
  CERES SYN1deg (satellites, 2001-) and GPM IMERG precipitation (satellites, 1998-),
  plus the NSIDC Sea Ice Index (G02135 v4) as an independent sea-ice reference.
- **Tests every grid cell** with an autocorrelation-corrected Mann-Kendall
  test, a Theil-Sen slope with confidence interval, and an independent
  OLS + AR(1) check.
- **Controls false discoveries across the map** with Benjamini-Hochberg FDR
  (alpha_FDR = 2 alpha_global, Wilks 2016) and shows the naive map beside it.
- **Says "not yet detectable"** instead of "no trend" when the record is too
  short (Weatherhead et al. 1998, scaled for the sampling interval).
- **Guards against artificial trends**: step tests at documented instrument
  and data-source changes, cells with missing months excluded with a reason.
- **Validates itself**: a known-truth synthetic map and a Monte Carlo table.

## Rebuild the data or run your own analysis (optional)

Needs Python 3.10+ and an internet connection.

| | Windows | macOS / Linux |
|---|---|---|
| 1. Install once | double-click `install_analysis.bat` | `bash install_analysis.sh` |
| 2. Rebuild `web/data` (20–30 min) | double-click `run_analysis.bat` | `bash run_analysis.sh` |

Then open `TrendDetective.html` again. For developers:

```bash
pip install -r requirements.txt
python -m pytest -q                       # statistics, JS/Python agreement, payloads
python -m trend_detective.validation      # Monte Carlo table -> web/data/validation.js
python -m trend_detective build           # NASA POWER + NSIDC -> web/data/*.js
python -m trend_detective build --only mn-t2m --no-screen
python -m trend_detective series merra2 T2M --bbox 104 43 107 45
python -m trend_detective vars merra2 --grep soil
python -m trend_detective furniture --geonames DIR --world-atlas DIR
```

Scenes are defined in `trend_detective/scenes.py`; add a `SceneSpec` to
analyse another variable or region.

## Layout

```
TrendDetective.html   double-click to open the viewer
web/                  viewer (index.html, css/, js/, data/*.js)
trend_detective/
  stats.py            per-cell statistics (MK, Hamed-Rao AR(1), Sen, OLS-AR(1), FDR, Weatherhead, step test)
  analysis.py         field analysis, verdicts, region means
  scenes.py           scene definitions, variable screen, cross-checks
  power.py, nsidc.py  data access (NASA POWER Zarr, NSIDC Sea Ice Index)
  catalog.py          products and documented data-source transitions
  payload.py          data files the viewer reads from disk or HTTP
  geo.py              coastlines (Natural Earth) and places (GeoNames)
  grid.py, synthetic.py, validation.py
tests/                pytest suite
docs/METHODS.md       methods, validation, data traps, limits
```

## Results worth looking at

- On a synthetic map with known trends, 66 % of cells flagged by a naive
  p < 0.05 map are false; after FDR it is 13 %.
- The published Hamed-Rao test rejected 15 % of trend-free records at
  phi = 0.6 in our Monte Carlo runs; the AR(1)-modelled variant used here
  stays at 5 %.
- NASA POWER masks total ozone below 200 DU, which removes the Antarctic
  ozone hole; the tool detects this and refuses to compute censored trends.
- MERRA-2 shows Antarctic sea ice growing (+0.19 million km2/decade); the
  NSIDC Sea Ice Index shows no trend (-0.03). The difference jumps by +0.86
  million km2 in January 2005 (p 8e-7), when the sea-ice input inside the
  Reynolds SST analysis used by MERRA-2 changed source.

## Before submitting to Space Apps

This prototype was written before the hackathon. Some secondary sources say
2026 projects must be created during the event; the official 2026 Project
Submission Guide (due 13 Nov 2026) decides. Check it, and if prior work is
allowed, list this repository under References.

## Data and licences

- NASA POWER v10 on AWS Open Data, `s3://nasa-power`, CC BY 4.0. The POWER
  project is funded by the NASA Applied Sciences Program.
- NSIDC Sea Ice Index, G02135 v4, doi:10.7265/a98x-0f50.
- Places: GeoNames, CC BY 4.0. Coastlines and borders: Natural Earth via
  `world-atlas` 2.0.2 (ISC).
- Statistical references are listed in `docs/METHODS.md`.
