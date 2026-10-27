"""Products, curated variables and documented data-source transitions.

Transitions drive the homogeneity guard: each dated entry is tested as a
step (see ``stats.step_test_rows``). ``verified`` says whether the date was
confirmed against a NASA or peer-reviewed source when this table was written;
unverified entries are shown as warnings but never tested as steps.
"""

from __future__ import annotations

PRODUCTS = {
    "merra2": {
        "name": "MERRA-2 reanalysis (via NASA POWER v10)",
        "kind": "model",
        "source": "NASA GMAO Modern-Era Retrospective analysis for Research and Applications, Version 2",
        "native_res": "0.5 deg x 0.625 deg",
        "record_start": "1981-01",
        "url": "https://registry.opendata.aws/nasa-power/",
    },
    "syn1deg": {
        "name": "CERES SYN1deg (via NASA POWER v10)",
        "kind": "mission",
        "source": "NASA CERES on Terra/Aqua with geostationary imagers",
        "native_res": "1 deg",
        "record_start": "2001-01",
        "url": "https://registry.opendata.aws/nasa-power/",
    },
    "nsidc": {
        "name": "NSIDC Sea Ice Index v4 (G02135)",
        "kind": "mission",
        "source": "NOAA@NSIDC passive microwave record (SMMR, SSM/I, SSMIS, AMSR2)",
        "native_res": "25 km",
        "record_start": "1978-11",
        "url": "https://nsidc.org/data/g02135",
    },
    "imerg": {
        "name": "GPM IMERG (via NASA POWER v10)",
        "kind": "mission",
        "source": "NASA/JAXA Global Precipitation Measurement, Integrated Multi-satellitE Retrievals for GPM",
        "native_res": "0.1 deg",
        "record_start": "1998-01",
        "url": "https://registry.opendata.aws/nasa-power/",
    },
}

LAND_VARS = {"GWETROOT", "GWETTOP", "GWETPROF", "SNODP", "FRSNO", "EVLAND", "PRECSNOLAND",
             "TSOIL1", "TSOIL2", "TSOIL3", "TSOIL4", "TSOIL5", "TSOIL6"}

TRANSITIONS = [
    {
        "products": ["merra2"], "vars": ["TO3"], "date": "2004-10", "verified": True,
        "label": "Ozone input switches from SBUV to Aura OMI + MLS",
        "source": "GMAO: MERRA-2 assimilates SBUV Jan 1980-Sep 2004, then MLS and OMI; "
                  "the switch causes a discontinuity (Wargan et al. 2017; see also "
                  "Atmosphere 10:812, 2019)",
    },
    {
        "products": ["merra2"], "vars": ["TO3"], "date": None, "verified": False,
        "label": "MLS retrieval version 2.2 -> 4.2 during 2015 (month not confirmed)",
        "source": "GMAO presentation citing Wargan et al.; month not confirmed",
    },
    {
        "products": ["merra2"], "vars": sorted(LAND_VARS), "date": "1992-01", "verified": True,
        "label": "New MERRA-2 production stream (land spin-up in first year)",
        "source": "Reichle et al. 2017, J. Climate: spin-up affects the first year of each "
                  "stream (1980, 1992, 2001, 2011)",
    },
    {
        "products": ["merra2"], "vars": sorted(LAND_VARS), "date": "2001-01", "verified": True,
        "label": "New MERRA-2 production stream (land spin-up in first year)",
        "source": "Reichle et al. 2017, J. Climate",
    },
    {
        "products": ["merra2"], "vars": sorted(LAND_VARS), "date": "2011-01", "verified": True,
        "label": "New MERRA-2 production stream (land spin-up in first year)",
        "source": "Reichle et al. 2017, J. Climate",
    },
    {
        "products": ["merra2"], "vars": ["FRSEAICE", "TS", "T2M"], "date": "1982-01",
        "verified": True,
        "label": "SST/sea-ice boundary data: AMIP II monthly fields -> Reynolds daily OISST",
        "source": "UCAR Climate Data Guide (citing Bosilovich et al. 2015, sec. 8): AMIP II "
                  "1980-1981; Reynolds et al. (2007) 1982-Mar 2006; OSTIA Apr 2006-present",
    },
    {
        "products": ["merra2"], "vars": ["FRSEAICE", "TS", "T2M"], "date": "2005-01",
        "verified": True,
        "label": "Sea-ice input inside Reynolds OISST: NASA GSFC -> NCEP analysis",
        "source": "UCAR Climate Data Guide and NOAA NCEI OISST pages: GSFC sea ice up to "
                  "2004, NCEP from 2005. Found first as a jump in MERRA-2 minus NSIDC, "
                  "then confirmed in the documentation",
    },
    {
        "products": ["merra2"], "vars": ["FRSEAICE"], "date": None, "verified": False,
        "label": "NCEP sea-ice algorithm changes in 1997, 2004, 2006, 2009 and 2011 "
                 "(months not confirmed)",
        "source": "UCAR Climate Data Guide, OISST sea ice: no adjustments for these switches",
    },
    {
        "products": ["merra2"], "vars": ["FRSEAICE", "TS", "T2M"], "date": "2006-04",
        "verified": True,
        "label": "SST/sea-ice boundary data: Reynolds OISST -> OSTIA",
        "source": "UCAR Climate Data Guide (citing Bosilovich et al. 2015, sec. 8)",
    },
    {
        "products": ["nsidc"], "vars": ["area", "extent"], "date": "2025-01", "verified": True,
        "label": "Sea Ice Index v4: input switches from SSMIS to AMSR2",
        "source": "NSIDC user notice: AMSR2 (NSIDC-0803) from 1 Jan 2025; AMSR2 places the "
                  "ice edge slightly inboard, under 0.15 million km2 less extent in the south",
    },
    {
        "products": ["imerg"], "vars": ["IMERG_PRECTOT"], "date": "2014-06", "verified": True,
        "label": "Calibration switches from TRMM to the GPM Core Observatory",
        "source": "NASA GPM: precipitation-rate histograms show a seam at the start of June 2014",
    },
]

NOTES = {
    ("merra2", "PRECTOTCORR"): (
        "Observation-corrected precipitation: gauge-based (CPCU) at low and middle latitudes, "
        "CMAP over Africa, tapering to model precipitation between 42.5 and 62.5 deg and "
        "model-only poleward of 62.5 deg (Reichle et al. 2017). Mongolia (41-52 N) lies in "
        "the taper zone, so trends there are partly model-driven."
    ),
    ("merra2", "WD10M"): "Wind direction is circular; linear trend tests do not apply.",
    ("syn1deg", None): (
        "CERES SYN1deg merges several satellites whose make-up changes over time; dates of "
        "those changes are not tested here."
    ),
}

# Variables whose linear trend is not meaningful or that duplicate another one.
SCREEN_EXCLUDE_PREFIX = ("WD", "Z0M", "DISPH")
SCREEN_EXCLUDE_SUFFIX = ("_SUM", "_SD", "_MAX", "_MIN", "_MAX_AVG", "_MIN_AVG", "_RANGE")


def transitions_for(product: str, var: str) -> list[dict]:
    return [t for t in TRANSITIONS if product in t["products"] and var in t["vars"]]


def notes_for(product: str, var: str) -> list[str]:
    out = []
    for key in ((product, var), (product, None)):
        if key in NOTES:
            out.append(NOTES[key])
    return out


def screenable(var: str) -> bool:
    if var.startswith(SCREEN_EXCLUDE_PREFIX):
        return False
    return not var.endswith(SCREEN_EXCLUDE_SUFFIX)


def decimal_from_ym(ym: str) -> float:
    """'2004-10' -> 2004.75, the start of that month in decimal years."""
    y, m = ym.split("-")
    return int(y) + (int(m) - 1) / 12.0
