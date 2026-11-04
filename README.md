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

- **Case files** (the first screen, the *Case files* button in the layer
  manager, or the *Cases* menu): ten guided investigations, each a question
  answered step by step: *Is the planet warming, and where fastest? Is
  Mongolia warming, and in which season? Is Antarctic sea ice growing? (a
  model and a satellite disagree) Where did the ozone hole go? Is the Gobi
  getting dustier? Is Ulaanbaatar's heaviest rain getting heavier? Are the
  ingredients of dzud changing? How fire-prone is the land around
  Ulaanbaatar today? When will we know? Can the detective be fooled?* Each
  step sets the workbench (dataset, years, months, layer, selection) and
  shows an **evidence** line computed live from the results on screen; the
  last step is a **verdict**: what is changing, where, how much, is it
  significant, when will we know, and caveats. Every step has a link
  (`#case/<id>/<step>`, e.g.
  <https://buyja047.github.io/earth_trending/#case/antarctic-ice/2>) and a
  **QR code** for a phone; a verdict can be saved as a **1200 × 630 PNG
  card**. Cases are plain bilingual data in `web/js/cases.js`; a new case
  needs no new code.
  - **Your own case**: the last card on the board starts the live analysis;
    pick any of the 1,320 NASA POWER variables and a box anywhere on Earth,
    and the result is presented as a five-step case with the same verdict.
- **Regime shift** layer (*Layer ▾*, windows of 20 years or more): every cell
  tested twice, on the first and the second half of the chosen years; colour
  where the two halves disagree in sign (strong: both significant; faded: one;
  faint: neither), grey where they agree. A reversal is a reason to distrust
  one straight line, not a trend in itself.
- **What if the trend were…** (details pane, after clicking a cell or a box):
  a slider gives the year a hypothetical trend would become detectable at
  that selection's noise and memory.
- **Glossary** (Help menu, and hover on the chips and statistic labels):
  FDR, Sen slope, corrected p, φ, σ, smallest detectable trend, year
  detectable, step test, in both languages.
- **Offline after one visit**: on the hosted site a service worker keeps a
  copy of the pages and of every dataset you opened (network first, cache
  when offline; NASA POWER, GIBS and Earth Engine are never cached). The
  ZIP copy works offline without it.

- **Daily yellow dust maps**: **Risk zones → Yellow dust storm → Date (UTC)**.
  `modis-dust` downloads matched NASA MOD021KM/MOD03/MOD35_L2 channels,
  calibrates native radiances/reflectances and applies the thesis's IDI/Otsu
  decision tree per overpass before taking the daily union. `dust-serve
  --modis-live` connects this directly to date selection; the optional GitHub
  workflow publishes daily processed maps to Pages after secret/Pages setup.
  Requires a server-side `EARTHDATA_TOKEN`; authenticated real-data processing
  is not yet validated in this session because no Earthdata account is connected.
  Missing dates stay blank. [Setup and method](docs/DUST_MODIS.md).

- **MODIS trends at 1 km and 5 km** (`modis-trend` command, Earth Engine): the
  MERRA-2 cells are ~50 km and are never interpolated; instead separate
  scenes from MODIS Terra (2000–2025) give daytime and night-time land
  surface temperature, growing-season NDVI and winter snow-covered days at
  5 km over Mongolia and at 1 km in three 160 km boxes (Ulaanbaatar, the
  South Gobi mines, Khövsgöl), tested with the same statistics. Clear-sky
  skin temperature over 26 years, not air temperature over 45: the scenes
  say so, and Terra's orbit drift since 2020 is tested as a step. Setup,
  rules and limits: [docs/MODIS_TRENDS.md](docs/MODIS_TRENDS.md).

- **Earth Engine fire map** uses the existing **Risk zones** map, legend and
  details panel. The `fire-map` command reads actual Landsat / ERA5 pixels and
  creates `web/data/fire-risk.js`; no separate site or credentials in the browser.
  Green–yellow–red classes show experimental relative susceptibility, not a
  calibrated ignition probability. No map is fabricated if access or data are
  missing. [Setup and method](docs/FIRE_EARTH_ENGINE.md).

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
  Documented data-source changes that fall inside the chosen years are tested
  as steps in every cell, as in the precomputed scenes, so the *Source steps*
  layer and the step warnings work for live scenes too.
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
- **Snow, rain and wind hazards** (group *Mongolia hazards 1981–2025 (daily)*):
  daily MERRA-2 from NASA POWER, counted per month. The indices are dust-prone
  days (snow-free, dry, windy at 6, 8 or 10 m/s), snow-covered days, wet days,
  windy days, heavy-rain days (≥ 10 mm) and the wettest day of the month.
  - The **Risk zone** layer marks where an index is high (thirds across the
    map) and rising (an upward trend after FDR) in the chosen months. The
    **Risk zones** button in the toolbar, or the link
    <https://buyja047.github.io/earth_trending/#risk>, opens it from anywhere.
  - The Analysis tab shows, for Tavan Tolgoi, Oyu Tolgoi and Tsagaan Suvarga,
    where winds carried dust on dust-prone days and how often each nearby soum
    centre lay downwind.
  - Checks: the MERRA-2 snow cover was calibrated against MODIS. Over Mongolia
    the dust-prone-day decline sits before 1992, a MERRA-2 production-stream
    boundary, so it is reported as unconfirmed. Over Ulaanbaatar, IMERG
    confirms the rise in the wettest day. Against Sentinel-5P's UV aerosol
    index (2018–2025, day by day), dust-prone days over the South Gobi read
    higher than calmer days, and the index rises with wind speed. Only about
    one in six shows a clear plume, so the index means "dust likely", not
    "dust seen" (`scripts/check_dust_s5p.py`).
  - Details: `docs/METHODS.md`. Licences of every data source:
    `docs/DATA_LICENSES.md`.
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
  js/cases.js         case files: bilingual step definitions with live evidence, and the engine that drives the workbench
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

The 2026 hackathon is on **14–15 November 2026**; the challenge resources and
the Project Submission Guide appear on 13 November. The official participant
FAQ says teams may not begin working on the challenges before the hackathon,
and the submission form asks teams to confirm original work and to list every
external resource under References. This repository is public and dated
before the event, so it must be disclosed as a pre-existing resource and the
hackathon project described as the increment built on the weekend.
[docs/SPACEAPPS.md](docs/SPACEAPPS.md) has the verified dates, the five
judging criteria, the compliance plan, a 48-hour plan, a video storyboard and
draft project-page text, in English and Mongolian.

## Data and licences

- NASA POWER v10 on AWS Open Data, `s3://nasa-power`, CC BY 4.0 (monthly
  and daily stores). The POWER project is funded by the NASA Applied Sciences
  Program.
- MODIS Terra monthly snow cover (MOD10CM) and HLS Sentinel-2 imagery via
  GIBS, used to check MERRA-2 snow and to place the Tavan Tolgoi pit ("Contains
  modified Copernicus Sentinel data 2025"). Full table, including what was read
  but not redistributed (Esri Wayback, journal articles): `docs/DATA_LICENSES.md`.
- Sentinel-5P TROPOMI UV aerosol index, DLR daily L3 composites (CC BY 4.0;
  "Contains modified Copernicus Sentinel data 2018–2025 processed by DLR"; L2
  from NASA TropOMAER). Used only for the dust check; the gridded data are not
  stored in the repository.
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

### Detailed Sentinel-2 background

Select **Background imagery → Sentinel-2 cloudless 2020 (10 m)** and zoom
to a mine or town. This selects colour imagery and sets data opacity to zero
so coarse climate cells do not obscure the image; increase Data opacity to
restore the trend overlay. The climate measurements retain their native resolution.
This is EOX's cloudless 2020 composite, not live imagery or a selected day's
observation. Tiles load directly from `https://tiles.maps.eox.at/wms`; no
Earth Engine login, server, or API key is needed for the GitHub Pages viewer.
An internet connection is required. External service availability and CORS
are required; live tile delivery has not yet been validated in the cloud
environment because its network policy blocks the domain.
