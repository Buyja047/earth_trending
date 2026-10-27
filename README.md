# Trend Detective

A prototype for the NASA Space Apps 2026 challenge **"Be an Earth System Trend
Detective"**. Pick a variable measured by a NASA mission or produced by a NASA
model, and the tool reports **what** is changing, **where**, **how much**, and
whether the change is **significant** once autocorrelation, multiple testing,
record length and data-source changes are taken into account.

English and Mongolian interface · works offline · no installation needed to view.

**Open it online: https://buyja047.github.io/earth_trending/** (any modern
browser, phones included; send the link to anyone). Онлайнаар нээх:
https://buyja047.github.io/earth_trending/ — холбоосыг хэнд ч илгээж болно.

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

- **Datasets** (layer manager on the left, the one place to pick data): global
  MERRA-2 temperature, precipitation, soil wetness, sea ice and ozone
  (1981–2025); Mongolia temperature, precipitation, soil wetness, wind, snow
  (1981–2025), CERES aerosol and IMERG precipitation (2001–2025); a
  known-truth test field.
- **Live analysis of any variable** (*+ Analyse any variable* in the layer
  manager, or File menu): pick any of 472 MERRA-2 or 848 CERES monthly
  variables and a box anywhere on Earth; the page reads the data straight
  from NASA POWER on AWS (needs internet; about 0.6 MB per 30 × 30-cell
  tile) and runs every test in the browser. Over Mongolia it reproduces the
  precomputed Python results (country-mean T2M +0.1942 °C/decade, p 0.00239).
- **Layers** (the *Layer ▾* button at the end of the tab row, so nothing
  covers the map): FDR-tested trend, naive trend, verdict, smallest detectable
  trend, year-by-year anomaly, data-source steps, each with a one-line
  explanation.
- **Year detectable** layer: the year by which a trend of the measured size is
  detected with 90 % probability if it continues (Weatherhead et al. 1998),
  with a range that our Monte Carlo shows covers the true value 92–99 % of
  the time; also shown for every cell, box and area mean.
- **Background imagery** (NASA GIBS, left panel): Blue Marble relief, grey
  ASTER terrain, 2016 night lights, or the MODIS Terra image of a day (most
  days since 24 February 2000; GIBS lists the gaps), under the data with adjustable opacity and an optional grey
  filter. Off by default, so the viewer stays fully offline until you pick one.
- **Compare** (toolbar or View menu): split the map with a draggable
  divider. By default a model is set against its satellite partner (MERRA-2
  vs GPM IMERG precipitation, same grid), otherwise one dataset against
  itself for two periods (first and second half of the years). One colour
  scale when the units match; the details pane gives both halves' area
  means, cell-by-cell sign agreement, and both values for a clicked cell. No
  p-value is given for the difference: the halves are not independent.
- **Zoom and pan**: mouse wheel, two-finger pinch, double-click or the + / −
  buttons; drag to move; ⤢ shows the whole map. Zoomed in, each cell prints its
  value and every town in Mongolia (or every capital on the globe) is
  labelled. Keyboard: + − 0 and the arrow keys on the focused map.
- **Timeline** under the map: press ▶ to play the anomalies year by year.
- **Months** (toolbar, next to the years): analyse one season or one month
  instead of the whole year: Dec–Feb, Mar–May, Jun–Aug, Sep–Nov, Nov–Mar,
  May–Sep or any single month. Each year contributes the mean of those months
  and every test, count, map layer, chart and CSV follows. Works on the
  Mongolian datasets and live analyses (they keep monthly values per cell).
  Mongolia, 1981–2025: spring (Mar–May) warmed +0.28 °C/decade (737 of 1,272
  cells after FDR), winter (Dec–Feb) shows no detectable trend (−0.06, p 0.70).
- **Years**: pick a start and end year and press Apply. Every trend, test,
  false-discovery threshold and count is recomputed in the browser (monthly
  values for Mongolia, annual means for the globe). Change α the same way.
- **Click a cell** for its time series and statistics; **Shift-drag a box**
  to average a region (or switch on *Box select*, also on touch screens).
- **3D surface** (toolbar or View menu): the trend field as a landscape; drag
  to rotate, scroll to zoom, change the height.
- **Search** Mongolian aimag centres, Oyu Tolgoi, the Tavan Tolgoi airfield
  and world capitals (GeoNames); the map zooms to the place.
- **Analysis tab**: area means, the start/end-year triangle, case notes, and
  cross-checks (MERRA-2 vs GPM IMERG precipitation; MERRA-2 vs NSIDC sea ice).
- **Variable ranking tab**: 91 MERRA-2 and CERES variables over Mongolia.
- **Method tab**: how significance is decided, with a Monte Carlo check.
- **Legend**: click the unit to switch between per decade, per year and total.
- **Download as CSV** (*⤓ CSV* buttons, or the File menu): the map table
  (one row per cell: trend, 95 % interval, the three p-values, FDR flag,
  verdict, smallest detectable trend, year detectable), the series of a
  clicked cell or box, an area mean, or the variable ranking. The numbers are
  the ones on screen for the chosen years and α; `# key: value` lines on top
  record dataset, units, years and method (`pandas.read_csv(f, comment="#")`).
  Columns are in English in both languages.
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

Then open `TrendDetective.html` again.

### Dust over Mongolia (needs a free Earthdata Login)

NASA POWER has no dust variables, so the dust scenes (`mn-dust`: surface dust
concentration, `mn-dust-aod`: dust optical depth) read MERRA-2 aerosol
diagnostics from NASA GES DISC, which requires an account:

1. Register at https://urs.earthdata.nasa.gov and, under Applications →
   Authorized Apps, approve **NASA GESDISC DATA ARCHIVE**.
2. Generate a user token (valid 60 days) and provide it as the environment
   variable `EARTHDATA_TOKEN` (in a Claude Code cloud environment: as a secret
   in the environment settings, then start a new session).
3. `python -m trend_detective dust-check` reads one month two ways
   (server-side subset and whole file) and must report a difference of 0.
4. `python -m trend_detective build --only mn-dust mn-dust-aod --no-screen`
   (about 540 small requests per scene).

Without the token, `build` skips these scenes (or keeps a previous build).

For developers:

```bash
pip install -r requirements.txt
python -m pytest -q                       # statistics, JS/Python agreement, payloads
python -m trend_detective.validation      # Monte Carlo table -> web/data/validation.js
python -m trend_detective build           # NASA POWER + NSIDC -> web/data/*.js
python -m trend_detective build --only mn-t2m --no-screen
python -m trend_detective series merra2 T2M --bbox 104 43 107 45
python -m trend_detective vars merra2 --grep soil
python -m trend_detective furniture --geonames DIR --world-atlas DIR
python -m trend_detective catalog         # variable catalog for live analysis
```

Scenes are defined in `trend_detective/scenes.py`; add a `SceneSpec` to
analyse another variable or region.

## Layout

```
TrendDetective.html   double-click to open the viewer
web/                  viewer (index.html, css/, js/, data/*.js)
  js/zarr.js, live.js live reading of NASA POWER Zarr chunks (Blosc/zstd) in the browser
  js/basemap.js       NASA GIBS imagery tiles (WMTS, EPSG:4326)
  js/season.js        season / single-month means (mirrors analysis.season_means)
trend_detective/
  stats.py            per-cell statistics (MK, Hamed-Rao AR(1), Sen, OLS-AR(1), FDR, Weatherhead, step test)
  analysis.py         field analysis, verdicts, region means, annual and season means
  scenes.py           scene definitions, variable screen, cross-checks
  power.py, nsidc.py  data access (NASA POWER Zarr, NSIDC Sea Ice Index)
  catalog.py          products and documented data-source transitions
  livecat.py          variable catalog for live analysis (web/data/power-catalog.js)
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
- zstd decoding in the browser: fzstd 0.1.1 (MIT, `web/js/vendor/`).
- Background imagery: "We acknowledge the use of imagery provided by services
  from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth
  Science Data and Information System (ESDIS)." Layers: Blue Marble shaded
  relief and bathymetry, ASTER GDEM greyscale shaded relief (NASA/METI),
  VIIRS Black Marble 2016, MODIS Terra corrected reflectance.
- Statistical references are listed in `docs/METHODS.md`.
