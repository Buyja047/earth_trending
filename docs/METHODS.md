# Methods, validation and known limits

This file records what the tool computes, why each choice was made, and what
our own stress tests found. Every number here can be regenerated:
`python -m trend_detective.validation` and `python -m pytest`.

## Question the tool answers

For a chosen variable, region and period:

| Challenge wording | What the tool reports |
|---|---|
| what is changing | variable screen: every variable in a region ranked by change relative to noise |
| where | per-cell trend map; connected regions of significant increase and decrease |
| how much | Theil-Sen slope per decade with a 95 % rank confidence interval |
| is it significant | autocorrelation-corrected Mann-Kendall p per cell, Benjamini-Hochberg FDR across the map, parametric cross-check, detectability, homogeneity |

## Pipeline per scene

1. Read monthly data from the public NASA POWER v10 Zarr stores
   (`s3://nasa-power`, anonymous HTTPS). Products: MERRA-2 (model, 1981-),
   CERES SYN1deg (satellites, 2001-), GPM IMERG (satellites, 1998-).
2. Optional block averaging (global scenes: 4 x 4 native cells, about 2 x 2.5 deg).
3. Remove the calendar-month climatology. Cells missing any month are
   excluded and reported (status 6), never gap-filled.
4. Per cell, on monthly anomalies (`trend_detective/stats.py`):
   - Mann-Kendall S and Var(S) with the tie correction.
   - Hamed & Rao (1998) variance inflation with the rank ACF of the
     Sen-detrended series modelled as AR(1), phi from the lag-1 rank
     autocorrelation with Kendall's bias correction (n r1 + 1)/(n - 4).
     **This is the primary p-value.**
   - Theil-Sen slope; CI from Sen (1968)/Gilbert (1987) using the corrected Var(S).
   - OLS slope with the Santer et al. (2000) AR(1) effective sample size,
     n_e = n (1 - r1)/(1 + r1), as an independent check.
   - Weatherhead et al. (1998): minimum detectable trend for the record,
     MDT = 3.3 sigma_N sqrt((1+phi)/(1-phi)) / n_years^1.5, and years needed
     for a trend of the observed size, n* = [3.3 sigma_N/|omega| sqrt((1+phi)/(1-phi))]^(2/3).
   - For each documented data-source transition: OLS fit of trend + step and
     a test of the step with the same effective sample size.
5. Across the map: Benjamini-Hochberg FDR over valid cells with
   alpha_FDR = 2 x alpha_global = 0.10 (Wilks 2016 for correlated fields).
   The same FDR is applied to each transition's step p-values.
6. Verdict per cell: (1) FDR-significant and OLS-AR(1) agrees; (2) FDR-significant
   only; (3) naive p < 0.05 only; (4) not yet detectable (n* > record);
   (5) inconclusive; (6) excluded.
7. Area means use cos(latitude) weights over valid cells only; sea-ice
   scenes report approximate hemispheric area (fraction x cell area).

## Detectability for annual data

Weatherhead's constant 3.3 assumes monthly sampling. For a series sampled every
`step` years the trend standard error scales by sqrt(12 x step), so the tool
uses K = 3.3 sqrt(12 step) (11.4 for annual data). Our Monte Carlo check found
that keeping 3.3 for annual series gave only 10-20 % power at the claimed
"90 %" detectable trend; with the scaled constant it is 87-90 %
(`tests/test_stats.py::test_weatherhead_scales_with_sampling_interval`).

## Year detectable

The *Year detectable* layer answers "when?": the year by which a trend of the
measured size is detected with 90 % probability at the 5 % level, if it
continues at the measured rate.

- **Years needed.** n* = [K σ_N / |ω| · sqrt((1+φ)/(1−φ))]^(2/3), with K = 3.3
  for monthly data (scaled for other sampling as above). The same formula and
  the same 90 %/95 % reading appear in Whiteman et al. (2011, co-authored by
  Weatherhead), Henson et al. (2016) and Sutton et al. (2019). The map shows
  start year + ⌈n*⌉ − 1.
- **What it means for a detected trend.** With Weatherhead's standard error
  for the trend, n*/n = (3.3 / z)^(2/3), where n is the record length and z is
  the trend divided by its standard error. A year inside the record therefore
  means z ≥ 3.3. A trend can pass the FDR test with z ≈ 2, so a detected cell
  can still show a later year: it was found before detection became 90 %
  likely. (Mongolia mean temperature, 1981–2025: p = 0.002, year 2029.)
- **Range.** n* is proportional to |ω|^(−2/3), so the Sen 95 % confidence
  interval maps onto n* directly. Its ends are then widened by e^±B for the
  estimated σ_N and φ, B = 4 / (3 sqrt(m)) · sqrt((1+φ)/(1−φ)). If the trend
  interval includes zero, the upper end is "maybe never".
- **Which m.** Sutton et al. (2019) give m as the number of months. We could
  not open the 1998 paper (publisher paywall; the Harvard copy refused
  access). A first-order error propagation for σ_N and φ estimated from m
  values gives a standard error of log n* proportional to 1/sqrt(m), so m is
  the number of samples. The Monte Carlo below agrees: with m = samples the
  noise part alone is covered 88–95 % of the time; reading m as years makes it
  ~3.5 times too wide (100 %).
- **Terminology.** Sutton et al. (2019) call n* the time of emergence. Others
  define emergence as the first year a signal-to-noise ratio passes a
  threshold such as 1 or 2 (Hawkins and Sutton 2012). Here the year always
  means trend detection.

Monte Carlo (`trend_detective.validation.run_detection`, 400 records of 45
years per row, σ_N = 1, trend set so that the true n* is known). "Range
covers" is how often the range contains the true n*:

| Sampling | φ | true n* (years) | range covers | Sen CI only | e^±B, m = samples | e^±B, m = years | median n̂*/n* |
|---|---|---|---|---|---|---|---|
| monthly | 0.0 | 20 / 45 / 90 | 99.0 / 96.0 / 97.5 % | 89.5 / 92.7 / 96.3 % | 89.5 % | 100 % | 0.99 / 0.99 / 0.95 |
| monthly | 0.3 | 20 / 45 / 90 | 99.0 / 98.3 / 98.0 % | 89.0 / 94.8 / 97.5 % | 93.0 % | 100 % | 1.00 / 1.02 / 1.05 |
| monthly | 0.6 | 20 / 45 / 90 | 99.3 / 97.0 / 97.8 % | 83.0 / 92.2 / 97.3 % | 94.5 % | 100 % | 0.98 / 0.98 / 0.95 |
| monthly | 0.9 | 20 / 45 / 90 | 95.0 / 97.5 / 98.0 % | 53.7 / 88.5 / 95.8 % | 88.0 % | 100 % | 0.94 / 0.92 / 0.90 |
| annual | 0.0 / 0.3 / 0.6 | 45 | 98.3 / 95.5 / 92.5 % | 91.0 / 83.8 / 78.7 % | 84.5 / 83.0 / 77.0 % | same | 0.97 / 0.92 / 0.87 |

The Sen interval alone is not enough when the trend is large and the noise
estimate dominates (54 % at φ = 0.9, n* = 20). With 45 annual values φ is
underestimated, so n̂* runs 3–13 % low and the range slightly under-covers
at φ = 0.6. The year assumes a straight-line trend and unchanged noise; it is
a statement about detectability, not a forecast of the climate.

## Live analysis in the browser

*Analyse any variable* reads monthly NASA POWER values for a box straight from
the public Zarr stores (`s3://nasa-power`, anonymous HTTPS; CORS allows any
origin, including pages opened from disk) and runs the same per-cell tests,
FDR and detectability as the precomputed scenes.

- **Catalog.** `python -m trend_detective catalog` writes
  `web/data/power-catalog.js` from each store's own metadata: 472 MERRA-2 and
  848 CERES SYN1deg variables, the regular grid (checked), the monthly time
  axis (checked consecutive), the chunk layout and each variable's
  fixedscaleoffset scale (10 to 10000). One CERES variable stored as int16 is
  left out. The latest month comes from the bucket's `last_available.json`.
- **Decoding.** Chunks are Blosc containers compressed with zstd, byte-
  (MERRA-2) or bit-shuffled (CERES). `web/js/zarr.js` follows c-blosc 1.x
  (block, split and unshuffle rules) and uses the vendored fzstd decoder.
  Tests compare it with numcodecs over every shuffle mode, block layouts with
  leftovers, uncompressed buffers, forced split blocks and the full filter
  chain, bit for bit. Four real chunks (MERRA-2 T2M, PRECTOTCORR_00, TO3;
  CERES ALLSKY_SFC_SW_DWN; 2.3 million values) decode bit-identically to
  xarray.
- **Equivalence.** Read live for the Mongolia box, MERRA-2 T2M gives the same
  53 × 24 grid and cell validity as the Python scene, per-cell Sen slopes
  within 0.04 % (the Python values are stored to four significant digits),
  the same 585-cell country mask, and the same country mean: +0.1942 °C per
  decade, p = 0.00239.
- **Limits.** At most 5,000 cells and 40 chunks per run (about 25 MB). Step
  tests at documented source changes are not run live; those changes are
  listed with the result instead. IMERG (0.1°) is not offered: a useful box
  holds tens of thousands of cells. The claude.ai preview of the page may not
  be allowed to reach AWS; the downloaded `TrendDetective.html` is.

## Dust over Mongolia (MERRA-2 aerosols, GES DISC)

NASA POWER carries no dust variables (its catalog has only CERES total aerosol
optical depth, 2001 onward). Dust comes from the MERRA-2 monthly aerosol
collection M2TMNXAER 5.12.4 at GES DISC (CMR C1276812866-GES_DISC; variables
from CMR: DUSMASS, DUSMASS25, DUCMASS, DUEXTTAU among others), on the same
0.5° × 0.625° grid as the POWER MERRA-2 store.

- **Access.** GES DISC requires an Earthdata Login with the "NASA GESDISC
  DATA ARCHIVE" application approved (stated on GES DISC's own archive pages).
  Files are 80 MB per month, so `trend_detective/gesdisc.py` lists granules
  through the public CMR API and asks Cloud OPeNDAP (DAP4) for the box only;
  an unusable answer falls back to the whole file, and `dust-check` compares
  both for one month before a build relies on the subset. GES DISC's on-premise
  servers close "no earlier than September 30th 2026"; the code uses the
  Earthdata Cloud URLs that CMR lists.
- **Why the step tests matter here.** MERRA-2 aerosols are model fields nudged
  by assimilated aerosol optical depth, and the observations changed (GMAO
  technical report by Randles et al., Table 3.1): AVHRR over ocean only until
  August 2002; MISR over bright surfaces (deserts) February 2000 – June 2014;
  MODIS Terra from March 2000 and Aqua from August 2002; AERONET about 1999 –
  October 2014. Over the Gobi, dust is therefore unconstrained by observations
  before 2000, constrained by MISR from 2000 to mid-2014, and much less after.
  Steps are tested at 2000-03, 2002-08 and 2014-07; a trend that disappears
  once those steps are allowed for should not be reported as a dust trend.
- **Independent check.** CERES total aerosol optical depth (2001 onward, scene
  `mn-aod`) is a different quantity (all aerosols, not dust alone) but can be
  set beside `mn-dust-aod` with *Compare*; agreement in sign and timing is
  supporting evidence, not equality.

## Comparing two halves of the map

*Compare* draws a second dataset, or the same dataset for other years, on the
right of a draggable divider, using the same statistics. With equal units both
halves share one colour scale (the larger of the two limits), and the
year-detectable colours count from the earlier start year, so a colour means
the same thing on both sides. On a shared grid the details pane counts cells
whose trends share a sign and cells significant on both sides with the same or
opposite sign. Example (2001–2025, Mongolia): MERRA-2 precipitation trends
+0.065 mm/day per decade and GPM IMERG +0.018; 80 % of cells share a sign; 116
cells are significant in both with the same sign and none with opposite signs.

No test of the difference between the halves is offered. Two windows of one
record share autocorrelated noise (and overlap when the windows overlap), and a
model and a satellite product over the same place share the weather; a
two-sample test that assumes independence would overstate the evidence.
Overlapping confidence intervals are also not a test of equality.

## Background imagery

Imagery comes from NASA GIBS (WMTS, EPSG:4326 "best" endpoint) and is only
for orientation; no statistic uses it. The tile grid is taken from GIBS's own
WMTSCapabilities: top-left corner (−180°, 90°), 512 × 512-pixel tiles, one
tile spanning 288°/2^level, deepest level 7 (500 m sets), 8 (250 m) or 11
(31.25 m). Level-0 tiles extend past the globe; we checked on real tiles that
the image content ends at column 127 and row 319 (180° E, 90° S), and drawing
is clipped to the globe. The level is chosen so that one image pixel is no
coarser than one screen pixel. Because both the map and the tiles are plain
longitude-latitude grids, a tile maps onto the map by scaling alone. Tests
check matrix sizes and URL templates against the capabilities document.

## Recomputing for chosen years in the viewer

When the reader picks a start and end year, the browser reruns the same
battery (`web/js/stats.js`, tested against the Python engine) for every valid
cell: on monthly values re-deseasonalised within that window where the scene
stores monthly series (Mongolia), on annual means otherwise (globe), followed
by the map-wide FDR at the chosen alpha. Step tests, cross-checks and case
notes stay on the full record and say so.

## Seasons and single months

The *Months* control replaces each year's twelve values by the mean of the
chosen months, then runs the same battery (Hamed-Rao Mann-Kendall, Theil-Sen,
OLS + AR(1), Weatherhead n\*, map-wide FDR) on that one-value-per-year
series. Only datasets that keep monthly values per cell offer it (Mongolia and
live analyses); the global datasets store annual means per cell.

- **Which year a season belongs to.** A season that crosses New Year counts in
  the year of its last month: Dec–Feb 1990 is December 1989 to February 1990.
  This matches NOAA CPC's Oceanic Niño Index file (`oni.ascii.txt`), whose
  first row "DJF 1950" is the December 1949 to February 1950 season
  (climate.gov describes the series as starting in DJF 1949–50). CPC labels a
  season by its middle month, which gives the same year for Dec–Feb and
  Nov–Mar, the two choices here that cross New Year. Software differs here:
  pandas' `resample("QS-DEC")` labels the same season by its December
  timestamp (1989), so compare labels before comparing numbers. A Dec–Feb
  analysis of a record that starts in January 1981 therefore starts in 1982.
- **Missing months.** A season value needs all of its months; one missing month
  leaves that year empty rather than averaging a different part of the seasonal
  cycle.
- **Exact arithmetic.** The page stores each series as 16-bit integers times a
  scale. Season means are taken on the integers and scaled afterwards, so two
  years with the same stored sum get identical means and Mann-Kendall's ties
  stay ties. Rounding the means to 32-bit floats instead moved S by up to 3 and
  p by up to 12 % in single cells. With integer means the browser matches an
  independent Python implementation (`analysis.season_means`, grouping by label
  instead of index arithmetic) to the last digit of the exported CSV for all
  1,272 Mongolian T2M cells in Mar–May and Dec–Feb and for snow in Jun–Aug
  (`tests/test_js_season.py`).
- **Cells that never change.** Mean snow depth over Jun–Aug is the same in
  every year in 206 of 1,272 cells (no summer snow at all). Such a series has no trend to test; it is left out of the test
  and of the counts, and the summary says how many.
- **How reliable the test is with one value per year.** Here φ is the memory
  from one year to the next, estimated from 20–45 points. Monte Carlo
  (`validation.run_one_per_year`, 2,000 trend-free AR(1) series per row) gives
  these false-positive rates at the 5 % level:

  | Years | φ | Uncorrected MK | Corrected MK (used) | OLS + AR(1) | Both, same sign |
  |---|---|---|---|---|---|
  | 44 | 0.0 | 4.5 % | 3.8 % | 3.9 % | 3.0 % |
  | 44 | 0.3 | 13.4 % | 5.8 % | 6.2 % | 4.6 % |
  | 44 | 0.6 | 32.3 % | 9.4 % | 9.6 % | 8.3 % |
  | 25 | 0.0 | 5.1 % | 4.1 % | 4.4 % | 2.9 % |
  | 25 | 0.3 | 13.8 % | 8.4 % | 9.4 % | 7.2 % |
  | 25 | 0.6 | 28.7 % | 11.9 % | 12.9 % | 10.8 % |

  So the corrected test is close to nominal when consecutive years are
  unrelated and somewhat liberal when they are alike, more so for short
  windows. Over Mongolia the median year-to-year φ of season means is about
  −0.1 to 0.3 depending on variable and season (90th percentile 0.5–0.6 for
  soil wetness in Dec–Feb and Sep–Nov and for wind in Jun–Aug). The verdict "parametric test agrees"
  requires both tests, which trims the excess. The monthly analysis keeps its
  own, better calibrated check (table above).
- **Trying several seasons is itself a multiple test.** The FDR controls false
  discoveries among the cells of one map, not across the 18 month choices a
  reader can try. Choose the season for a physical reason before looking, or
  report every season you looked at. Season results are recomputed in the
  browser; the step tests at documented source changes stay on the full record.

Example, MERRA-2 T2M over Mongolia 1981–2025: the country mean warmed
+0.28 °C/decade in Mar–May (95 % CI 0.054 to 0.565, corrected p 0.019; 737 of
1,272 cells after FDR) against +0.19 for the whole year, while Dec–Feb shows
−0.06 (p 0.70; no cell after FDR).

## Snow, rain and wind hazards (daily MERRA-2)

Mines, tailings and haul roads only make dust when the ground is bare and dry
and the wind is strong; snow and rain switch them off. The *Mongolia hazards
1981–2025 (daily)* datasets count, per ~50 km MERRA-2 cell and month, days
from the NASA POWER daily store (`trend_detective/hazard.py`):

| Index | A day counts when | Basis |
|---|---|---|
| Dust-prone days (6, 8, 10 m/s) | snow cover < 0.3, precipitation < 0.254 mm, daily maximum 10 m wind ≥ 6, 8 or 10 m/s | US EPA AP-42 13.2.2: a day with ≥ 0.254 mm counts as dust-free; AP-42 13.2.5: mine surfaces erode above 10–27 m/s in gusts; snow cover raises the dust-outbreak threshold in Mongolia (Kurosaki and Mikami 2004, 2005) |
| Snow-covered days | MERRA-2 snow cover ≥ 0.3 | calibrated to MODIS, below |
| Wet days | precipitation ≥ 0.254 mm | AP-42 13.2.2 |
| Windy days | daily maximum 10 m wind ≥ 8 m/s | |
| Heavy-rain days | precipitation ≥ 10 mm | ETCCDI R10mm |
| Wettest day of the month | largest daily precipitation | ETCCDI Rx1day |

Every index is a monthly series, so the trend battery, the months filter, the
map-wide FDR and the CSV export apply unchanged.

**Snow from MERRA-2 had to be repaired.** Snow depth (SNODP) cannot be used: in
the POWER store it stays at 17.33 cm through whole Gobi winters while the
snow-covered fraction (FRSNO) is 1–20 % (Tavan Tolgoi cell, November 2010 to
March 2011). The MERRA-2 file specification calls SNODP "snow depth" and FRSNO
the "fractional area of land snowcover"; the data show SNODP is a depth over the
snow-covered part only. FRSNO in turn reads low. Against MODIS Terra monthly
snow cover (MOD10CM, decoded from GIBS with its own colour table) over
186,092 Mongolian cell-months (November–April 2001–2025), MERRA-2 shows
25.2 % where MODIS shows 45.1 % (r = 0.798); over the
Gobi south of 45.5° N it is 5.7 % against
16.8 %. The fit MODIS = 1.097 × MERRA-2 + 17.46 puts MODIS's
"half covered" at MERRA-2 29.7 %, so a cell counts as snow-covered from
0.3 (`scripts/check_snow_modis.py`, `docs/snow_check_modis.json`). The
intercept says MERRA-2 misses thin snow that MODIS sees, so Gobi winter counts
of dust-prone days remain an upper estimate.

**Results, MERRA-2, Mongolia (country mean, days per month per decade):**

| Index | 1981–2025 | 1992–2025 | 2001–2025 |
|---|---|---|---|
| Dust-prone days, 8 m/s | -0.27 (-0.39 to -0.16), p 9.3e-06 | -0.07 (-0.23 to +0.10), p 0.43 | -0.04 (-0.33 to +0.26), p 0.8 |
| Dust-prone days, 6 m/s | -0.26 (-0.43 to -0.09), p 0.0025 | -0.26 (-0.52 to +0.00), p 0.053 | -0.26 (-0.73 to +0.20), p 0.28 |
| Dust-prone days, 10 m/s | -0.15 (-0.22 to -0.09), p 1.8e-06 | -0.01 (-0.09 to +0.07), p 0.88 | -0.00 (-0.14 to +0.14), p 0.99 |
| Windy days, 8 m/s | -0.31 (-0.48 to -0.14), p 0.00032 | +0.16 (-0.04 to +0.36), p 0.12 | +0.24 (-0.09 to +0.58), p 0.15 |
| Wet days | -0.01 (-0.15 to +0.13), p 0.91 | +0.35 (+0.15 to +0.54), p 0.00068 | +0.65 (+0.32 to +0.97), p 0.00016 |
| Wettest day (mm) | +0.10 (+0.00 to +0.20), p 0.041 | +0.33 (+0.19 to +0.48), p 4.1e-06 | +0.58 (+0.31 to +0.88), p 1.5e-05 |

* All three wind thresholds give a decline from 1981 (411 cells down and
  52 up after FDR at 8 m/s), and 87 % of the significant cells keep their sign at
  6 and 10 m/s. Repeating the build with the uncorrected snow threshold (0.5)
  changes the 8 m/s country trend from −0.276 to −0.273: the result does not
  hang on the snow rule.
* **The decline sits before 1992.** From 1992, the start of a new MERRA-2
  production stream, there is no significant trend at 8 or 10 m/s, and windy
  days turn slightly upward. The step test finds a drop at January 1992 in the
  country mean (p 0.008) and in 463 cells. Whether the windy 1980s are real
  (stilling of surface winds is reported across East Asia) or a stream artefact
  needs station winds, which are not openly licensed (`docs/DATA_LICENSES.md`).
  Report the 1981–2025 decline as unconfirmed.
* **Does the index follow dust?** Monthly anomalies of dust-prone days correlate
  with MERRA-2 surface dust (DUSMASS) at r = 0.738 over the South Gobi
  (0.458 country-wide), as expected from one model. Against the independent
  CERES total aerosol optical depth they correlate *negatively* (r = -0.337 over the
  South Gobi, -0.458 country-wide in March–May). Total AOD over Mongolia is not a
  dust measure (smoke and haze build up in calm weather, windy days ventilate
  them), so this is no confirmation either way. The index describes weather
  that allows dust, not dust that was observed.
* **Rain indices rise, and IMERG agrees over Ulaanbaatar.** In the MERRA-2 cell over
  Ulaanbaatar the wettest day of the month rose +0.39 mm per decade in
  2001–2025 (p 0.0987). GPM IMERG averaged over the same cell gives
  +0.39 (p 0.00462), and its wettest 0.1° pixel +0.95 (p
  0.00614). At pixel scale the June–August wettest day averages 25.7 mm against
  15.0 mm for the cell, which is why a cell value is not a flood threshold. The
  Ulaanbaatar flood studies use 10–40 mm in 30 minutes (Badamdorj and Chogsom
  2021) and a terrain-weighted overlay at 12.5–90 m (Ishdorj et al. 2025). IMERG
  changed calibration from TRMM to GPM in June 2014. For heavy-rain day counts
  the Sen slope is often 0 because most months have none; the p-value still
  tests the trend.

**Risk zones.** For any daily index the *Risk zone* layer combines how high
the index is in the chosen months with whether it is rising. The level is the
whole-record mean per month in those months, split into thirds across the map.
"Rising" means an upward trend that survives the FDR test for the chosen years.
The classes are, in order: high and rising, high, rising, middle, low. The
thirds are relative to the map, as in the class-based overlays of the
Ulaanbaatar flood studies; they are not a regulatory standard.

**Downwind of the mines.** For Tavan Tolgoi (pit centre read off NASA HLS
Sentinel-2 imagery, 43.63° N 105.49° E), Oyu Tolgoi and Tsagaan Suvarga
(GeoNames), each dust-prone day of the mine's cell is assigned the direction its
daily mean 10 m wind blew toward. A soum centre counts as downwind when it lies
within ±22.5° of that direction. From 1981 to 2025, winds on dust-prone days
at Tavan Tolgoi blew toward the east and south-east: SE 22 %, ESE 22 %, E 18 %.
Tsogttsetsii (21.6 km ENE) was downwind on 38 days a year and Bayan-Ovoo (89 km
SE) on 49, against 3 for Dalanzadgad (86 km W). Khanbogd (36 km NE of Oyu
Tolgoi) was downwind on 22 days a year.

These are direction and frequency only. A daily mean direction over a 50 km
cell is not a plume. Concentrations need emissions and a dispersion model such
as AERMOD; in Jalayer et al. (2026) the 24-h PM10 limit was exceeded only
within 0.8–1.4 km of the crushers. Winter dust from cleared pits and roads
under a low boundary layer (Wang et al. 2022) is not captured, because the
index counts natural snow cover.

## Exported tables (CSV)

Every *⤓ CSV* file holds exactly what the viewer shows for the current
dataset, years and α, so a reader can check or reuse it elsewhere. The map
table has one row per grid cell (cell-centre latitude and longitude) with
Sen slope and 95 % interval per decade, the naive, Hamed-Rao-corrected and
OLS + AR(1) p-values, the FDR flag (`significant_fdr`, at α_FDR = 2α), the
verdict code and text, φ, noise SD, the smallest detectable trend, n\* and
the year-detectable estimate with its range; cells without data are kept with
empty fields so the grid stays complete. A series file holds the anomalies
the statistics were computed from (monthly anomalies re-deseasonalised within
the chosen years, or annual means) with the statistics in its header.

For the full record of a precomputed dataset the statistics come from the
Python build on full-precision data, while the page carries a rounded copy of
each series (16-bit steps, 0.00036 °C for Mongolian T2M). Recomputing from
that copy can therefore differ in the third or fourth significant digit
(0.12172 against 0.1218 °C/decade for the Ulaanbaatar cell); the file says
so in `statistics_from`. For chosen years, boxes and live analyses the
statistics are computed from exactly the values in the file, and our test
recomputes them from the file to the last digit. The map table's
`trend_per_decade` equals the dataset's stored values for all 1,272
Mongolian cells, and its FDR flags reproduce the on-screen count (1,101).

## Why not the published Hamed-Rao test

We first implemented Hamed-Rao exactly as published (and as in
pyMannKendall: empirical rank ACF, only lags with |rho| > 1.96/sqrt(n)). It
matches pyMannKendall to floating-point rounding (`tests/test_stats.py`). But
with 540 monthly values, about 27 of the 539 lags pass that screen by chance,
and their noise leaks into the variance correction:

Monte Carlo, 400 trend-free AR(1) records of 45 years per row, false-positive
rate at the 5 % level (MC standard error about 1.1 points), and detection
rate when the trend equals Weatherhead's MDT (target 90 %):

| phi | naive MK | Hamed-Rao, published | **MK, AR(1)-modelled HR (used)** | OLS + AR(1) | Sen CI coverage |
|---|---|---|---|---|---|
| 0.0 | 3.7 % / 93 % | 6.8 % / 93 % | **3.0 % / 92 %** | 3.5 % / 92 % | 97 % |
| 0.3 | 13.3 % / 97 % | 10.5 % / 94 % | **4.8 % / 91 %** | 3.7 % / 92 % | 95 % |
| 0.6 | 33.0 % / 98 % | 15.0 % / 94 % | **5.2 % / 90 %** | 3.7 % / 90 % | 95 % |
| 0.9 | 65.2 % / 100 % | 26.5 % / 97 % | **7.7 % / 91 %** | 7.5 % / 90 % | 92 % |

The modelled variant stays near nominal size; Weatherhead's MDT formula
predicts the 90 % detection rate well. At phi = 0.9 all corrected tests run
slightly hot (7-8 %).

## Why no Pettitt change-point test

On trend-free AR(1) noise, Pettitt applied to detrended residuals flagged 98 %
of series at phi = 0.9 (it assumes independence). After prewhitening it
flagged almost nothing, including real 0.5-sigma steps. We therefore test
steps only at documented transition dates, where the regression step test
kept its size (5.5 % and 5.2 % at phi = 0.3 and 0.9) and estimated the step
without bias.

## Field significance on a known-truth map

`synthetic.dipole_field` plants one warming and one cooling region in
spatially smoothed AR(1) noise. Scores are in `web/data/synthetic-truth.json`:
the naive p < 0.05 map's false discovery proportion is 66 %; the FDR map's
is 13 %, close to the 10 % target. FDR finds fewer true cells, mostly the
cells whose planted trend is below the detectable size.

## Data traps the tool found in real data

1. **Censored ozone.** POWER marks total ozone below its `valid_min` of 200 DU
   as missing. The Antarctic ozone hole lies below 200 DU, so in October 2006,
   42 % of native cells south of 60 S are missing. A trend computed on the
   remaining values would be censored. The tool detects partially missing
   cells and excludes them with an explanation.
2. **Sea-ice boundary data, checked against NSIDC.** MERRA-2 sea ice is a
   boundary condition copied from other analyses. Over 1981-2025 its Antarctic
   area rises +0.19 million km2/decade (corrected p 0.039), while the NSIDC
   Sea Ice Index (G02135 v4, the record built for this purpose) gives -0.03
   (95 % CI -0.16 to +0.11, p 0.66): no detectable trend. MERRA-2 minus NSIDC
   anomalies trend +0.25/decade (p 0.0003) and jump by +0.86 million km2 in
   January 2005 (p 8e-7); with that step allowed for, the excess is -0.04.
   January 2005 is when the sea-ice input inside Reynolds OISST, which
   MERRA-2 uses until April 2006, switched from NASA GSFC to NCEP (UCAR
   Climate Data Guide and NOAA NCEI OISST pages). The jump was found in the
   data first and then matched to that documentation, so the date was not
   chosen blind; the documented AMIP II -> Reynolds (Jan 1982) and
   Reynolds -> OSTIA (Apr 2006) switches are tested as well. The Arctic
   agrees in both records (MERRA-2 -0.31, NSIDC area -0.28 million
   km2/decade; difference +0.00, p 0.97). Conclusion: the MERRA-2 Antarctic
   gain is a data artifact; NSIDC governs. NSIDC itself switched its input
   from SSMIS to AMSR2 on 1 Jan 2025 (NSIDC user notice); that step is tested
   in its own series and is not significant (p 0.24).
3. **Precipitation taper.** MERRA-2 corrected precipitation is gauge-based at
   low and middle latitudes and tapers to model precipitation between 42.5
   and 62.5 deg (Reichle et al. 2017). Mongolia lies in the taper zone.

## Known limits

- **Long memory.** If noise has slow components beyond AR(1), every test here
  is too liberal: with 30 % of variance in an AR(1) of phi = 0.995, all tests
  flagged 54-74 % of trend-free series. Cross-product agreement (model vs
  satellite) and longer records are the defence; the viewer shows both.
- **Variable screen.** Variables are correlated, so its FDR is a guide.
- **Linear rates.** The trend triangle shows when a straight line is a poor
  summary (acceleration, regime shifts); the tool does not fit nonlinear trends.
- **Stored precision.** POWER stores values with two decimal places. For a
  0-1 variable such as soil wetness, monthly anomalies are only a few steps
  of 0.01, so many values tie and some cells get a Sen slope of exactly 0.
  The tie-corrected tests remain valid; the slope estimate is coarse there.
- **Resolution.** MERRA-2 is about 50 km and CERES 1 deg. They show regional
  climate, not the footprint of a single mine or road.
- **Unverified transitions** (ozone MLS v2.2 -> v4.2 in 2015, month unknown;
  CERES constellation changes) are listed as warnings and not tested.

## References

- Benjamini, Y., Hochberg, Y. (1995) JRSS-B 57:289-300.
- Gilbert, R.O. (1987) Statistical Methods for Environmental Pollution Monitoring.
- Hawkins, E., Sutton, R. (2012) GRL 39:L01702 (time of emergence by signal-to-noise).
- Henson, S.A. et al. (2016) Global Change Biology 22:1561-1571, doi:10.1111/gcb.13152.
- Hamed, K.H., Rao, A.R. (1998) J. Hydrol. 204:182-196.
- Reichle, R.H. et al. (2017) J. Climate, doi:10.1175/JCLI-D-16-0570.1.
- Santer, B.D. et al. (2000) JGR 105:7337-7356.
- Sen, P.K. (1968) JASA 63:1379-1389.
- Sutton, A.J. et al. (2019) Earth Syst. Sci. Data 11:421-439, doi:10.5194/essd-11-421-2019.
- Weatherhead, E.C. et al. (1998) JGR 103:17149-17161.
- Whiteman, D.N. et al. (2011) JGR 116:D21118.
- Wilks, D.S. (2016) BAMS 97:2263-2273.
- Wargan, K. et al. (2017) J. Climate (MERRA-2 ozone).
- UCAR Climate Data Guide, "NASA's MERRA2 reanalysis".
- NASA POWER on AWS Open Data: https://registry.opendata.aws/nasa-power/
