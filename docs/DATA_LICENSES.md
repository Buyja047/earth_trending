# Data, imagery and literature: what may be used, and how

Checked against each issuer's own page (October 2026). "Shown in the tool"
means the data or a product derived from it reaches the viewer or the
repository. Space Apps asks teams to list every outside resource in the
submission form's *NASA Data* and *Space Agency Partner & Other Data* fields
and to cite all sources, so each row says how to cite it.

## Data the tool uses

| Source | Issuer | Licence / terms | Shown in the tool | Credit line |
|---|---|---|---|---|
| NASA POWER v10 (MERRA-2, CERES SYN1deg, GPM IMERG; monthly and daily Zarr on AWS) | NASA LaRC / GMAO / CERES / GPM | CC BY 4.0, as labelled on its [AWS registry entry](https://registry.opendata.aws/nasa-power/): "no restrictions on the use … We request that you cite the NASA POWER Project". NASA's general rule is CC0 *unless the content is labelled*, and a label governs ([Earthdata data use guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance)), so CC BY 4.0 with attribution is the term to follow | yes: every scene, live analysis, daily hazard indices, mine winds | "Data from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program" |
| MERRA-2 aerosol diagnostics M2TMNXAER (dust) | NASA GES DISC | NASA policy (CC0 unless marked); needs a free Earthdata Login to download | yes: mn-dust, mn-dust-aod | GMAO (2015), doi:10.5067/FH9A0MLJPC7N |
| NASA GIBS imagery (Blue Marble, ASTER GDEM relief, VIIRS Black Marble, MODIS true colour, MODIS snow cover) | NASA ESDIS | NASA policy; GIBS asks for an acknowledgement | yes: background imagery; MODIS snow cover used to check MERRA-2 snow | "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." |
| HLS S30 (Harmonized Landsat Sentinel-2) via GIBS | NASA / USGS, with Copernicus Sentinel-2 input | NASA policy for the product; the Sentinel-2 part falls under the [Copernicus Sentinel data licence](https://ewds.climate.copernicus.eu/licences/ec-sentinel): free, full and open, notice required when modified | used once, to place the Tavan Tolgoi pit centre (2025-07-25 image); not redistributed | "Contains modified Copernicus Sentinel data 2025, processed by NASA HLS" |
| Sentinel-5P TROPOMI UV aerosol index, DLR daily L3 composites (`S5P_TROPOMI_L3_P1D_AI_v2`, 0.1°, 2018–2025) | DLR (gridding) on Copernicus Sentinel-5P (EU/ESA) radiances; L2 UVAI by NASA TropOMAER | CC BY 4.0, as written in every file (`license = "CC-BY-4.0; contains modified Copernicus Sentinel data (YEAR) processed by DLR"`) and on the [dataset page](https://geoservice.dlr.de/web/datasets/tropomi_l3_ai). **Conflict:** the STAC collection's licence *link* points to CC BY-NC 4.0 while its text says CC BY 4.0. The file and page govern (DLR's [terms](https://geoservice.dlr.de/web/terms): a CC licence applies where it is expressly stated, and the file, the dataset page and every STAC item say CC BY 4.0; only the collection's link URL says BY-NC); if BY-NC were right, use would be limited to non-commercial, which Space Apps is. The underlying Sentinel data fall under the [Copernicus Sentinel data licence](https://ads.atmosphere.copernicus.eu/licences/ec-sentinel) | no map layer; only statistics (`docs/s5p_check.json`) and code are in the repository; the daily fields stay in the local cache | "Contains modified Copernicus Sentinel data 2018–2025 processed by DLR (CC BY 4.0); UV aerosol index from NASA TropOMAER (Torres et al. 2020, doi:10.5194/amt-13-6789-2020)" |
| NSIDC Sea Ice Index G02135 v4 | NOAA@NSIDC | open, cite the data set | yes: sea-ice cross-check | NSIDC Sea Ice Index G02135 v4, doi:10.7265/a98x-0f50 |
| GeoNames (places, soum centres, Oyu Tolgoi and Tsagaan Suvarga mine points) | GeoNames | [Creative Commons Attribution](https://www.geonames.org/about.html) (CC BY 4.0) | yes | "GeoNames, CC BY 4.0" |
| Natural Earth via world-atlas 2.0.2 (coastlines, borders) | Natural Earth; world-atlas by M. Bostock | public domain data; ISC licence for the package | yes | "Natural Earth" |
| US EPA AP-42 sections 13.2.2, 13.2.4, 13.2.5 (11/06) | US EPA | a US government work, so no copyright in the United States | the 0.254 mm wet-day rule and the threshold range are used, not the text | US EPA (2006), AP-42 Fifth Edition, Vol. I, Ch. 13.2 |

## Material read but not redistributed

| Source | Terms | How the project uses it |
|---|---|---|
| Esri World Imagery Wayback (Tavan Tolgoi view) | [Esri Master License Agreement](https://www.arcgis.com/sharing/rest/content/items/10df2279f9684e4a9f6a7f08febac2a9?f=json) ("This work is licensed under the Esri Master License Agreement"); tracing for data collection is allowed, export and redistribution are not | Not in the tool. The mine centre was read off NASA HLS instead, so no Esri content is redistributed. Showing a Wayback screenshot in the pitch would need Esri's attribution terms; NASA HLS or GIBS imagery avoids the question. |
| Jalayer et al. (2026), *Environ. Monit. Assess.* 198:598, doi:10.1007/s10661-026-15421-y | Springer, all rights reserved | Cited: AERMOD with AP-42 emission factors; 24-h PM10 limit exceeded within 0.8–1.4 km of the crushers; 8 m/s used for high-dust protocols |
| Wang et al. (2022), *Environ. Pollut.* 292:118293, doi:10.1016/j.envpol.2021.118293 | Elsevier, closed access (abstract read) | Cited: cold-region open-pit dust peaks in December–January under a low boundary layer; water spraying fails in winter |
| Badamdorj and Chogsom (2021), ACRS 2021, paper 198 | conference copyright | Cited: AHP flood-risk mapping of Songinokhairkhan; 10–40 mm in 30 min floods |
| Ishdorj et al. (2025), *ISPRS Archives* XLVIII-4/W14-2025, 75, doi:10.5194/isprs-archives-XLVIII-4-W14-2025-75-2025 | CC BY 4.0 | Cited; figures could be reused with attribution |
| Kurosaki and Mikami (2004, 2005, 2007) | journal copyright | Cited: snow cover raises the threshold wind for dust outbreaks in Mongolia |

## Data deliberately not used

* **Mongolian national station data (NAMEM)**: no open licence found, so not
  redistributed. Station comparisons would need permission.
* **OpenStreetMap mine polygons**: usable under ODbL, but share-alike would
  apply to a derived database; GeoNames points were enough for three mines.
