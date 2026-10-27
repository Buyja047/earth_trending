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

## Recomputing for chosen years in the viewer

When the reader picks a start and end year, the browser reruns the same
battery (`web/js/stats.js`, tested against the Python engine) for every valid
cell: on monthly values re-deseasonalised within that window where the scene
stores monthly series (Mongolia), on annual means otherwise (globe), followed
by the map-wide FDR at the chosen alpha. Step tests, cross-checks and case
notes stay on the full record and say so.

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
