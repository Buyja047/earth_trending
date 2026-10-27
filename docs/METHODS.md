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
2. **Sea-ice boundary data.** MERRA-2 sea ice is a boundary condition whose
   source changed in Jan 1982 (AMIP II -> Reynolds OISST) and Apr 2006
   (-> OSTIA) per the UCAR Climate Data Guide citing Bosilovich et al. (2015).
   In a Canadian Arctic Archipelago box, January ice fraction jumps from
   0.39-0.40 (2003-04) to 0.45-0.46 (2005-09), which is not physical for
   saturated winter ice. The MERRA-2 Antarctic sea-ice area trend
   (+0.19 million km2/decade, 1981-2025) conflicts with NSIDC's Sea Ice Index,
   whose 2023 lows turned the long-term Antarctic annual trend slightly
   negative. NSIDC governs for sea ice; the single check is to run this tool
   on NSIDC G02135.
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
- Hamed, K.H., Rao, A.R. (1998) J. Hydrol. 204:182-196.
- Reichle, R.H. et al. (2017) J. Climate, doi:10.1175/JCLI-D-16-0570.1.
- Santer, B.D. et al. (2000) JGR 105:7337-7356.
- Sen, P.K. (1968) JASA 63:1379-1389.
- Weatherhead, E.C. et al. (1998) JGR 103:17149-17161.
- Wilks, D.S. (2016) BAMS 97:2263-2273.
- Wargan, K. et al. (2017) J. Climate (MERRA-2 ozone).
- UCAR Climate Data Guide, "NASA's MERRA2 reanalysis".
- NASA POWER on AWS Open Data: https://registry.opendata.aws/nasa-power/
