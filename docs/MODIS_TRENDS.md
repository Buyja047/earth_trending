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
| Mongolia (`country`) | 5 km, each the mean of the native pixels inside it | ~62,000 inside the border | ~8 MB |
| Ulaanbaatar (`ub`), 160 km box | 1 km, one pixel each | 25,600 | ~3.5 MB |
| South Gobi mines (`gobi`), 160 km box around Tavan Tolgoi and Oyu Tolgoi | 1 km | 25,600 | ~3.5 MB |
| Khövsgöl (`khovsgol`), 160 km box | 1 km | 25,600 | ~3.5 MB |

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
  days do not count as either; a month needs clear observations on at least half its days;
  a winter needs all five months.
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

## Running it

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

## Sources

- MOD11A2.061 and MOD13A3.061: NASA LP DAAC, "no restrictions on subsequent use, sale, or
  redistribution"; cite per LP DAAC guidance. Earth Engine catalog pages
  `MODIS/061/MOD11A2`, `MODIS/061/MOD13A3`.
- MOD10A1.061: NSIDC; cite Hall, D. K., G. A. Riggs and V. V. Salomonson (2016), MODIS/Terra
  Snow Cover Daily L3 Global 500m Grid, Version 6(.1). Earth Engine `MODIS/061/MOD10A1`.
- Terra orbit: NASA Terra project pages on the orbit change (last manoeuvre 27 February
  2020; 10:15 crossing by fall 2022) and the LP DAAC Terra orbit drift notice.
- `computePixels` limits (48 MB, 32K pixels per side, 1024 bands): Earth Engine REST reference.

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

**Нүд ба бүс.** Улс даяар 5 км (нүд бүр доторх пикселүүдийн дундаж, ~62,000 нүд, ~8 МБ/багц);
Улаанбаатар, Өмнөговийн уурхайнууд, Хөвсгөл 160×160 км-ийн хайрцаг 1 км-д (25,600 нүд, ~3.5
МБ/багц). Улс даяар 1 км = 1.56 сая нүд = 80 МБ/багц тул хөтөчид тохирохгүй.

**Чанарын дүрэм, нөхөлтгүй.** LST: QA «сайн/бусад», алдаа ≤ 2 K, сард ≥ 2 композит; NDVI:
SummaryQA сайн/дунд, 5–9-р сар бүгд; цас: NDSI ≥ 40, сарын өдрийн хагасаас дээш цэлмэг, 11–3-р
сар бүгд. Нэг ч сар дутуу нүдийг **хасаж, тэмдэглэнэ**; хөршөөс, өөр жилээс нөхөхгүй.

**Занга.** Terra-гийн тойрог 2020-02-27-ны сүүлчийн маневрын дараа шилжиж, 10:30-ийн
өнгөрөлт эрт болж байна (2022 оны намар 10:15): нар намхан, сүүдэр урт, өдрийн гадаргын
температур бага. 2020-03-д шилжилт гэж бүртгэж, нүд бүрт алхмын тестээр шалгана; `--end 2019`-тэй
харьцуулаарай. 2000–2002 онд 10:45 → 10:30 шилжилт (сар тодорхойгүй): бүртгэсэн, шалгаагүй.

**Ажиллуулах.** Earth Engine-д бүртгэлтэй project, `pip install -r requirements-earthengine.txt`,
`earthengine authenticate`, дараа нь:

```bash
python -m trend_detective modis-trend --project <PROJECT_ID> --regions ub --vars lstd ndvi
```

Бүгдийг (16 багц) `--regions`, `--vars`-гүйгээр. Жил бүрийн пикселийг `cache/modis/`-д хадгалдаг тул
тасарсан ажил үргэлжилнэ. Үр дүн `web/data/<бүс>-modis-<хувьсагч>.js`-д бичигдэж, `index.js`-д
нэмэгдэнэ. Эрх эсвэл өгөгдөл байхгүй бол юу ч бичихгүй.
