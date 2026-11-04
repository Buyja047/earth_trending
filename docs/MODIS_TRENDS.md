# MODIS trends at 1 km and 5 km (Earth Engine)

Монгол заавар доор байна (§ Монгол).

## Why these scenes exist, and what they are not

The MERRA-2 scenes have cells of about 50 km (0.5° × 0.625°). A trend map at 1 km cannot
be made from them: interpolating a 50 km cell to 1 km produces 2,500 copies of the same
trend and the same p-value, adds no information, and breaks the false-discovery-rate test
(copies are not independent tests). So the viewer never interpolates. Instead, the
`modis-trend` command builds **separate** scenes from NASA's MODIS Terra record, the only
NASA data at 1 km with a trend-length record:

| Scene | Source | Native | Quantity | Record |
|---|---|---|---|---|
| Surface temperature, day / night | MOD11A2 (LP DAAC) | 1 km, 8-day | Clear-sky **land surface** temperature at the Terra overpass (~10:30 / ~22:30 local). Not the 2 m air temperature of the reanalysis | 2000-03 → |
| Greenness May–Sep (NDVI) | MOD13A3 (LP DAAC) | 1 km, monthly | Mean of the five growing-season months; one value per year | 2000 → |
| Snow-covered days Nov–Mar | MOD10A1 (NSIDC) | 500 m, daily | Days with NDSI ≥ 40 among clear days, scaled to the month, summed over the winter; one value per year | winter 2000/01 → |

Everything else is unchanged: the same Mann-Kendall test with the AR(1) correction, the
same FDR across the map, the same "not yet detectable" verdict, the same step tests. Two
things do change and the scenes say so: the record is 26 years, not 45, so "not yet
detectable" is more common; and the quantities are different physical things, so a MODIS
map is not a sharper MERRA-2 map.

## Cells, regions and sizes

| Region | Cells | Cell count | Scene file |
|---|---|---|---|
| Mongolia (`country`) | Earthdata source (the published scenes): 0.1° cells, each the mean of the 2 × 2 climate-modelling-grid cells (0.05°) inside it, about 11 km north-south and 7.6 km east-west at 47°N. Earth Engine source: 5 km, each the mean of the native pixels | ~18,500 inside the border (0.1°); ~74,000 at 0.05° (`--country-deg 0.05`, 22 MB per scene) | ~6 MB |
| Ulaanbaatar (`ub`), 160 km box | 1 km, one pixel each | 25,440 | ~4.5 MB |
| South Gobi mines (`gobi`), 160 km box around Tavan Tolgoi and Oyu Tolgoi | 1 km | 25,281 | ~4.5 MB |
| Khövsgöl (`khovsgol`), 160 km box | 1 km | 25,440 | ~4.5 MB |

Why not the whole country at 1 km: 1.56 million cells would be 80 MB of annual series per
scene, which no browser tab should load; at 5 km the country fits in the budget of the
other scenes, and the three boxes show what 1 km looks like where it matters. Boxes and
cell sizes are set in `trend_detective/modis.py` (`REGIONS`).

The browser re-tests the cells when you change the years. With this many cells it works on
the **annual** values (one per year), like the global scenes, so the months filter is off
for MODIS scenes; the seasons are built into the variables instead.

## Quality rules (no gap-filling)

- LST: a composite counts when its mandatory QA is "good" or "other quality" and the LST
  error flag is ≤ 2 K; a month needs at least two valid 8-day composites, else it is missing.
- NDVI: `SummaryQA` good or marginal only; a year needs all five months May–September.
- Snow days: `NDSI_Snow_Cover ≥ 40` counts a day as snow-covered; clouds, night and missing
  days do not count as either; a month needs at least one clear-sky observation
  (`MIN_CLEAR_OBS`, the minimum NASA's own monthly product MOD10CM uses); a winter needs all
  five months, and a cell needs all 25 winters. Why not half the days: in a Mongolian winter
  MODIS sees a 500 m pixel clearly on a median of 8 days per month (January 2021 at Khövsgöl;
  the cloud mask is conservative over cold, snow-covered ground), so a half-the-days rule left
  0.1 % of the box's pixels with a complete winter. Sensitivity over Mongolia at 0.1°, all 25
  winters: a minimum of 1, 2, 3 or 4 clear observations per month keeps 86, 67, 48 or 32 % of
  the cells, while the mean winter snow-cover days move only from 74.2 to 72.6; the threshold
  decides exclusion, not the estimate, so the product's own minimum is used. The raw monthly
  ingredients are cached, so the rule can be re-applied without downloading again.
- A cell with any missing month (or season) is **excluded and listed as such**, the same
  rule as the MERRA-2 scenes. Nothing is filled from neighbours or from other years.

## Known traps, tested

- **Terra's orbit drift.** Terra's last inclination manoeuvre was on 27 February 2020; its
  10:30 equator crossing has drifted earlier since (10:15 by autumn 2022, with a lower
  sun, longer shadows and lower daytime surface temperatures). The catalog lists it as a
  documented transition at 2020-03, tested as a step in every cell (the *Source steps*
  layer). It is a gradual change, so read a flagged step as "the last years are sampled
  differently", and compare with `--end 2019`.
- **2000–2002.** Terra's crossing time moved from 10:45 to 10:30 during 2000–2002 (month
  not fixed); many MODIS climate studies omit those years. Listed, not tested.
- **Clear sky only.** A cloudier decade is also a differently sampled one; the clear-sky
  mean is not the all-sky mean.

## Two ways to read the archive

`--source earthdata` (the default for the published scenes) reads the archives themselves and
needs no Earth Engine project, only an Earthdata Login bearer token in `EARTHDATA_TOKEN`
(https://urs.earthdata.nasa.gov, *Generate Token*); `trend_detective/modis_cloud.py`:

| Scene | Read from | How |
|---|---|---|
| Country LST day / night | MOD11C3.061 (monthly, 0.05° CMG), LP DAAC Earthdata Cloud | OPeNDAP subsets of Mongolia's rows and columns (four fields, about 0.5 MB per month); QC rule as above; 2 × 2 cells averaged |
| Country NDVI | MOD13C2.061 (monthly, 0.05° CMG), LP DAAC | OPeNDAP subsets; `pixel reliability` good or marginal; the five months averaged, then 2 × 2 |
| Country snow days | MOD10C1.061 (daily, 0.05° CMG), NSIDC Earthdata Cloud | whole files (4 MB a day); a day counts when the cell's *Clear Index* is above 70 % (the MOD10CM rule) and the snow share of the clearly seen land is `Day_CMG_Snow_Cover / Clear_Index`; then the rule above and 2 × 2 |
| Box LST day / night | MOD11A2.061 tiles as cloud-optimised GeoTIFFs on Microsoft's Planetary Computer mirror of the NASA archive | window reads of the box (STAC search, Terra only, a free SAS token, no account); one pixel per cell (the pixel holding the cell centre); monthly mean of the QA-passing composites, at least two |
| Box NDVI | MOD13A3.061 tiles, LP DAAC Earthdata Cloud | whole tiles (21 MB a month), cut into the boxes that share them and cached as windows |
| Box snow days | MOD10A1.061 tiles on the Planetary Computer | window reads at 500 m; the rule per pixel, then the mean of the pixels whose centres fall in each 1 km cell |

Measured here through a proxy at 2–10 MB/s: country LST 9 s per year, NDVI 17 s, snow 50 s per
winter; a box 25 s per year for LST (both day and night), 30 s per winter for snow, 20 s per
month-tile for NDVI. The whole set takes about two hours. Everything is cached under
`cache/modis-earthdata/` (per-year arrays, the raw snow ingredients as `raw/*.npz`, the NDVI
windows), so an interrupted run resumes and the snow rule can be changed without downloading.

```bash
export EARTHDATA_TOKEN=...   # never commit it
```

```bash
python -m trend_detective modis-trend --source earthdata --regions ub --vars lstd ndvi
```

```bash
python -m trend_detective modis-trend --source earthdata
```

The MODIS sinusoidal grid is sheared at 107°E (one pixel row north shifts x by about 1.4 km),
so "one pixel per cell" means the pixel holding the cell centre, and a tile window is a bounding
box of a parallelogram; `tests/test_modis_cloud.py` checks both mappings in the projection's own
metres and in degrees.

## Running it through Earth Engine

Needs a Google Cloud project registered for Earth Engine (non-commercial use is free; see
[docs/FIRE_EARTH_ENGINE.md](FIRE_EARTH_ENGINE.md) for registration) and
`pip install -r requirements-earthengine.txt`. Pixels are read with `computePixels`, one
year per request, and cached in `cache/modis/` so an interrupted run resumes.

```bash
earthengine authenticate
```

```bash
python -m trend_detective modis-trend --project <PROJECT_ID> --regions ub --vars lstd ndvi
```

```bash
python -m trend_detective modis-trend --project <PROJECT_ID>
```

The second form builds every region and variable (16 scenes). Expect roughly one to three
minutes per region-variable-year of Earth Engine time for the 1 km boxes and more for the
country at 5 km; the snow-day scenes are the slowest because they reduce daily images. The
command writes `web/data/<region>-modis-<var>.js` and adds the scenes to
`web/data/index.js`; the viewer lists them under *Datasets* and the risk, compare and
case tools work on them like on any other scene. Nothing is written when access or data
are missing.

Scene ids: `mn-modis-lst-day`, `mn-modis-lst-night`, `mn-modis-ndvi`, `mn-modis-snowdays`
and the same with `ub-`, `gobi-`, `khovsgol-`.

## Checking the scenes

- `tests/test_modis.py` runs the real Earth Engine client offline: the request graphs
  must carry the collection, the QA bits, the explicit grid and (for 5 km) the
  `reduceResolution` mean; synthetic pixels with a planted trend and a missing corner must
  come out as the right verdicts, with the gappy cell excluded; and the viewer must open
  the result.
- After a real run, compare the 5 km daytime LST trend over Mongolia with the MERRA-2
  air-temperature trend by eye (same box, *Compare* works across the two grids): the signs
  should agree over most of the country, the sizes need not (skin vs air, clear sky vs
  all sky, 26 vs 45 years).

## Case files

Four case files (`web/js/cases.js`) are written for these scenes and appear on the case board
only once their scenes are in `web/data/index.js`; until then the board says how many are
waiting. Every number in them is computed from the scene on screen, so nothing needs editing
after a real run:

| Case | Scenes | What it does |
|---|---|---|
| Ulaanbaatar at 1 km: is the city's surface warming faster than the land around it? | `ub-modis-lst-day`, `ub-modis-lst-night` | a 24 × 16 km city box against the 160 km box mean, by day and by night; Terra's drift as a step; the 2000–2019 window |
| The South Gobi mines at 1 km | `gobi-modis-ndvi`, `gobi-modis-lst-day` | 20 km boxes around Tavan Tolgoi (105.49°E 43.63°N) and Oyu Tolgoi (106.843°E 43.008°N) in greenness and daytime surface temperature. Dates used: open-pit mining at Ukhaa Khudag from 2009, exports from 2011 (Mongolian Mining Corporation); Oyu Tolgoi's first concentrate shipment July 2013 (Oyu Tolgoi LLC) |
| Khövsgöl at 1 km: are winters losing snow-covered days? | `khovsgol-modis-snowdays`, `khovsgol-modis-lst-night` | a 10 km box around Mörön, night-time surface temperature as the second witness, the winter a trend would show |
| Do 1 km satellites and the 50 km model agree? | `mn-modis-lst-day` with `mn-t2m` | split view over 2000–2025; for every 5 km cell the sign of its Sen slope against the 50 km MERRA-2 cell that holds it, overall and among cells significant in both |

`tests/test_modis.py` builds synthetic versions of the seven scenes (the real boxes at 4 km)
and walks the four cases to their verdicts in Chromium.

## Sources

- MOD11A2.061 and MOD13A3.061: NASA LP DAAC, "no restrictions on subsequent use, sale, or
  redistribution"; cite per LP DAAC guidance. Earth Engine catalog pages
  `MODIS/061/MOD11A2`, `MODIS/061/MOD13A3`.
- MOD10A1.061: NSIDC; cite Hall, D. K., G. A. Riggs and V. V. Salomonson (2016), MODIS/Terra
  Snow Cover Daily L3 Global 500m Grid, Version 6(.1). Earth Engine `MODIS/061/MOD10A1`.
- Terra orbit: NASA Terra project pages on the orbit change (last manoeuvre 27 February
  2020; 10:15 crossing by fall 2022) and the LP DAAC Terra orbit drift notice.
- `computePixels` limits (48 MB, 32K pixels per side, 1024 bands): Earth Engine REST reference.
- MOD11C3.061 (Wan, Hook and Hulley 2021, doi:10.5067/MODIS/MOD11C3.061), MOD13C2.061 (Didan 2021,
  doi:10.5067/MODIS/MOD13C2.061): LP DAAC, read by OPeNDAP from `opendap.earthdata.nasa.gov`.
- MOD10C1.061 (Hall and Riggs 2021, doi:10.5067/MODIS/MOD10C1.061) and its user guide (the
  Clear Index, the special values 107 lake ice, 237 inland water, 250 cloud); MOD10CM's user
  guide for the Clear Index > 70 rule: NSIDC.
- Microsoft Planetary Computer: STAC collections `modis-11A2-061` and `modis-10A1-061`
  (licensor NASA LP DAAC / NSIDC, host Microsoft), read as cloud-optimised GeoTIFF windows.
- Mine dates in the Gobi case: Ukhaa Khudag (Mongolian Mining Corporation) mining from 2009,
  exports from 2011; Oyu Tolgoi's first concentrate shipment 9 July 2013 (Oyu Tolgoi LLC).

---

## Монгол

**Яагаад тусдаа багц вэ.** MERRA-2-ийн нүд ~50 км. Түүнийг 1 км болгон интерполяц хийвэл
нэг нүдэнд 2,500 ижил чиг, ижил p утга давтагдаж, мэдээлэл нэмэгдэхгүй, FDR тест эвдэрнэ.
Иймд хэрэгсэл интерполяц хийхгүй. `modis-trend` команд NASA-гийн 1 км-ийн цорын ганц урт
бүртгэл болох MODIS Terra-гаас **тусдаа** багцууд үүсгэнэ: гадаргын температур (өдөр/шөнө,
MOD11A2), ургалтын улирлын NDVI (MOD13A3), өвлийн цасан бүрхүүлтэй өдөр (MOD10A1), 2000 оноос.

**Юу өөрчлөгдөхгүй вэ.** Ижил статистик (AR(1) засвартай Mann-Kendall, FDR, илрэх он, алхмын
тест). **Юу өөрчлөгдөх вэ.** Бүртгэл 45 биш 26 жил тул «хараахан илрэхгүй» илүү олон; хэмжигдэхүүн
нь агаарын биш **гадаргын** температур, зөвхөн цэлмэг тэнгэрт. Тиймээс MODIS зураг бол MERRA-2-ийн
нарийн хувилбар биш, өөр зүйлийн зураг.

**Нүд ба бүс.** Улс даяар 0.1° (нийтлэгдсэн багцууд: нүд бүр доторх 0.05°-ийн 2 × 2 CMG нүдний
дундаж, 47°N-д ~11 × 7.6 км, ~18,500 нүд, ~6 МБ/багц; Earth Engine-ээр 5 км); Улаанбаатар,
Өмнөговийн уурхайнууд, Хөвсгөл 160×160 км-ийн хайрцаг 1 км-д (~25,400 нүд, ~4.5 МБ/багц). Улс
даяар 1 км = 1.56 сая нүд = 80 МБ/багц, 0.05° = 22 МБ/багц тул хөтөчид тохирохгүй.

**Чанарын дүрэм, нөхөлтгүй.** LST: QA «сайн/бусад», алдаа ≤ 2 K, сард ≥ 2 композит; NDVI:
SummaryQA сайн/дунд, 5–9-р сар бүгд; цас: NDSI ≥ 40, сард дор хаяж 1 цэлмэг ажиглалт (NASA-гийн
сарын бүтээгдэхүүн MOD10CM-ийн доод хэмжээ; Монголын өвөлд MODIS нэг пикселийг сард дунджаар 8
өдөр л цэлмэг хардаг тул «өдрийн хагас» дүрэм бараг бүх нүдийг хасдаг байсан; босгыг 1/2/3/4
болгоход улсын нүдний 86/67/48/32 % нь 25 өвөл бүгд хүчинтэй үлдэж, дундаж цастай өдөр 74.2–72.6
хооронд л хэлбэлзэнэ), 11–3-р сар бүгд. Нэг ч сар дутуу нүдийг **хасаж, тэмдэглэнэ**; хөршөөс,
өөр жилээс нөхөхгүй. Цасыг зөвхөн цэлмэг өдөр тоолдог, цас орох өдөр үүлтэй тул тоо цастай тал
руугаа хазайдаг: энэ нь бүтээгдэхүүний мөн чанар, анхаарах зүйлд бичсэн.

**Earth Engine-гүйгээр (`--source earthdata`).** Нийтлэгдсэн багцуудыг архиваас шууд уншсан:
улсыг LP DAAC-ийн MOD11C3/MOD13C2 (сарын 0.05° CMG, OPeNDAP-аар Монголын хэсгийг л татна) ба
NSIDC-ийн MOD10C1 (өдөр тутмын 0.05°, бүтэн файл) -аас; хайрцгуудыг Microsoft Planetary
Computer дээрх NASA-гийн MOD11A2, MOD10A1 tile-уудын COG цонхоор (бүртгэлгүй, үнэгүй) ба LP
DAAC-ийн MOD13A3 tile-аас. Зөвхөн `EARTHDATA_TOKEN` (Earthdata Login-ийн token) хэрэгтэй.
Бүхэлдээ ~2 цаг; `cache/modis-earthdata/`-д хадгалагддаг тул тасарсан ажил үргэлжилнэ.

**Занга.** Terra-гийн тойрог 2020-02-27-ны сүүлчийн маневрын дараа шилжиж, 10:30-ийн
өнгөрөлт эрт болж байна (2022 оны намар 10:15): нар намхан, сүүдэр урт, өдрийн гадаргын
температур бага. 2020-03-д шилжилт гэж бүртгэж, нүд бүрт алхмын тестээр шалгана; `--end 2019`-тэй
харьцуулаарай. 2000–2002 онд 10:45 → 10:30 шилжилт (сар тодорхойгүй): бүртгэсэн, шалгаагүй.

**Ажиллуулах.** Earth Engine-д бүртгэлтэй project, `pip install -r requirements-earthengine.txt`,
`earthengine authenticate`, дараа нь:

```bash
python -m trend_detective modis-trend --project <PROJECT_ID> --regions ub --vars lstd ndvi
```

**Хэргийн хавтас.** Эдгээр багцад зориулсан дөрвөн хэргийн хавтас (`web/js/cases.js`) бий:
Улаанбаатарын гадаргуу 1 км-д (хотын хайрцаг ба 160 км-ийн хайрцаг, өдөр/шөнө, Terra-гийн
шилжилт), Өмнөговийн уурхайнууд (Таван толгой, Оюу толгойн эргэн тойрны 20 км-ийн хайрцаг, NDVI ба
өдрийн гадаргын температур), Хөвсгөлийн цастай өдөр (Мөрөнгийн нүд, шөнийн гадаргуу), 5 км-ийн
гадаргуу ба 50 км-ийн агаарын тохироо (нүд бүрийг агуулж буй MERRA-2 нүдтэй нь тэмдгээр тулгана).
Багц нь `index.js`-д орсон үед л хэргийн самбарт гарна; түүнээс өмнө самбар хэдэн хэрэг хүлээж
байгааг хэлнэ. Тоо бүр дэлгэц дээрх багцаас тооцогддог тул бодит ажиллуулалтын дараа засах зүйлгүй.

Бүгдийг (16 багц) `--regions`, `--vars`-гүйгээр. Жил бүрийн пикселийг `cache/modis/`-д хадгалдаг тул
тасарсан ажил үргэлжилнэ. Үр дүн `web/data/<бүс>-modis-<хувьсагч>.js`-д бичигдэж, `index.js`-д
нэмэгдэнэ. Эрх эсвэл өгөгдөл байхгүй бол юу ч бичихгүй.
