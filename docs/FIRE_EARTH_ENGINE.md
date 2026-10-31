# Landsat and Earth Engine: fire conditions

## Монгол заавар

`web/index.html`-ийн **Landsat · Түймрийн нөхцөл** холбоосоор шинэ хэсгийг нээнэ.
Энэ нь гадарга, цаг агаарын ажиглалт харуулна; түймрийн баталгаажсан
магадлал, шуурхай сэрэмжлүүлэг гаргахгүй.

Google Cloud project ID нь API key биш. Таны өгсөн `sigma-513109`,
`temp-support-478105`, `nuur-492511` дотроос Earth Engine-д бүртгүүлсэн,
таны Google бүртгэл эрхтэй төслийг сонгоно. Доорх жишээнд `sigma-513109`
ашигласан; төслийн эрх одоогоор баталгаажаагүй. Project number хэрэггүй.

### Chrome / Code Editor

1. [Earth Engine Code Editor](https://code.earthengine.google.com/)-ийг өөрийн
   Chrome дээр нээж Google бүртгэлээрээ нэвтэрнэ.
2. [Cloud project тохируулах заавар](https://developers.google.com/earth-engine/guides/access)
   дагуу төслөө Earth Engine-д бүртгүүлж, Earth Engine API-г идэвхжүүлнэ.
   Бүртгэлийн зориулалт, эрх, төлбөртэй эсэхийг Google-ийн тохиргоонд өөрөө сонгоно.
3. Code Editor-ийн project сонголтод эрхтэй төслөө сонгоно.
4. [earth_engine/fire_context.js](../earth_engine/fire_context.js)-ийг хуулж,
   `ROI`, `START`, `END`-ээ өөрчлөөд **Run** дарна. Жишээ бүс нь Улаанбаатарын
   ойролцоох жижиг талбай; анхны хугацаа нь сүүлийн 90 хоногоос өнөөдрийг
   багтаана. `END` өдөр хайлтад орохгүй.
5. Layers хэсгээс RGB, гадаргын температур, NDMI, NDVI, NBR, цаг агаар,
   газрын бүрхэвч, налуу, озоны давхаргыг сонгоно. Console-д зураг, огноо,
   мета өгөгдөл гарна. Зураг олдохгүй бол хугацаагаа өөрчилнө; 2%-ийг өсгөхгүй.
6. GeoTIFF хэрэгтэй бол Tasks хэсгийн `landsat_fire_context` → **Run**.
   Скрипт автоматаар экспорт эхлүүлэхгүй.

Шинээр татагдсан зураг орох бүрд скриптийг дахин ажиллуулна. Landsat нь
тасралтгүй видео биш; Landsat 8/9 тус бүрийн давтамж ~16 хоног, нийлээд
нэрлэсэн ~8 хоног. Үүлшилтийн хатуу шүүлт, замнал, бүтээгдэхүүний боловсруулалтын
хоцрогдлоос болж завсар урт байж болно. Энэ өөрчлөлт хуваарьт автомат ажил
эсвэл мэдэгдэл суулгаагүй.

### Python → төслийн тайлан

Одоогийн cloud орчинд Earth Engine-ийн эрхтэй Google identity холбогдоогүй.
Нууц түлхүүр, токен, authorization code-ыг GitHub эсвэл чатад бүү оруул.
Өөрийн компьютерын терминалд Google-ийн
[authentication заавар](https://developers.google.com/earth-engine/guides/auth)-ыг
дагаж нэвтэрнэ. Cloud орчинд ашиглах бол эрхтэй Google identity-г орчны
аюулгүй тохиргоогоор холбоно; project ID дангаараа нэвтрэлт үүсгэхгүй.

```bash
cd earth_trending
python -m pip install -r requirements-earthengine.txt
earthengine authenticate
python -m trend_detective fire-context \
  --project sigma-513109 \
  --bbox 106.7 47.7 107.0 47.9 \
  --start 2025-04-01 --end 2025-10-01 \
  --limit 3 --out cache/fire/report.json
```

Cloud checkout-д `.venv/bin/python`, `.venv/bin/earthengine` ашиглаж болно.
Гарсан `report.json`-ыг `web/fire.html` дээр сонгож үзнэ. Файл нь PNG зураг
агуулж болох бөгөөд сервер рүү илгээгдэхгүй. Хэрэв зураг татах хэрэггүй бол
`--no-previews` хэрэглэнэ. Тайлангийн зураг нь 512 пикселийн тойм;
шинжилгээний 30 м GeoTIFF биш. Түүхий үр дүнг Code Editor-оос экспортлоно.

Нэг хүсэлт ≤2,500 км², ≤366 хоног, хамгийн сүүлийн 1–20 шаардлага хангасан
зураг. Бүх Монголыг нэг хүсэлтээр тооцохгүй; том талбайд тусдаа хуваасан
batch workflow хэрэгтэй. Хайлтад тохирсон бүх зургийн тоо болон тайланд
сонгосон тоог тусад нь хадгална. Зураг нь бүсийг хэсэгчлэн хамарч болох тул
бүсийн хүчинтэй пикселийн хамрах хувийг заавал харна. Тайланг дахин гаргахад
заасан гаралтын файл шинэчлэгдэнэ; огноотой нэр хэрэглэвэл түүх хадгалагдана.

## Sources and interpretation

Official catalogue pages checked on 2026-10-31. Catalogue availability is verified;
authenticated remote computation in the user's projects is **not yet verified**.

| Measurement / factor | Earth Engine asset | What is implemented / limits |
|---|---|---|
| Surface temperature, greenness, moisture proxy, NBR | [Landsat 8](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C02_T1_L2), [Landsat 9](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC09_C02_T1_L2) | Both workflows: Collection 2 Tier 1 L2SP only; RGB, LST, NDVI, NDMI, NBR |
| Air temperature, dew point, wind components, surface pressure, topsoil water | [ERA5-Land hourly](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_HOURLY) | Acquisition UTC hour (floor to hour); no older weather substituted; ~11 km reanalysis, not a forecast or gust measurement |
| Antecedent precipitation | [ERA5-Land daily aggregates](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_DAILY_AGGR) | Sum of previous 7 complete UTC days; require all 7 images and per-pixel observations; metres → mm. Inspect known ERA5 accumulation artefacts; no silent clipping |
| Total ozone column | [Sentinel-5P OFFL O3](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_O3) | Same UTC day; mol/m² and DU. Atmospheric context only; not surface ozone or ozone-layer thinning |
| Fuel type / vegetation cover | [ESA WorldCover v200](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200) | Code Editor layer, 2021 static land cover at 10 m. Not current fuel quantity or moisture |
| Terrain slope | [SRTM](https://developers.google.com/earth-engine/datasets/catalog/USGS_SRTMGL1_003) | Code Editor layer, 30 m elevation-derived slope. SRTM coverage ~56°S–60°N; no invented terrain beyond coverage |
| Existing fire detections | [VIIRS VNP14A1](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP14A1) | Catalogue researched; not yet joined to reports. An active fire is an observation after ignition, not a predictor available before it |
| Historical burned area | [MODIS MCD64A1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD64A1) | Catalogue researched; 500 m monthly burned area could validate future models. Not yet a label set or score |

Other relevant factors: prolonged rain deficit, fuel amount/continuity and curing,
lightning, human activity, roads, power infrastructure, slope/aspect, suppression
and access. Landsat does not measure all these. A country-specific ignition
inventory and reliable lightning source remain needed. Do not fabricate them
from scene metadata. The Canadian [Fire Weather Index system](https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi)
uses temperature, relative humidity, wind and rain with persistent moisture codes;
this project does **not** claim to implement FWI or a calibrated risk model.

### Quality and units

- Metadata `0 <= CLOUD_COVER <= 2` is inclusive and applies to the whole scene.
  `-1` (unknown) is excluded. There is no fallback to cloudy imagery.
- `PROCESSING_LEVEL == L2SP` excludes L2SR scenes with empty thermal bands.
- `QA_PIXEL` bits 0–5 remove fill, dilated cloud, cirrus, cloud, cloud shadow and
  snow; `QA_RADSAT == 0` excludes saturation/terrain occlusion. Water is not
  classified as terrestrial fire fuel, and is not excluded from these general
  observation summaries. Mask/stratify land cover before any future fuel model.
- Surface reflectance = DN × 0.0000275 − 0.2. Surface temperature °C =
  ST_B10 × 0.00341802 + 149 − 273.15. Native thermal resolution is ~100 m,
  resampled to the 30 m delivery grid. `ST_QA × 0.01` is uncertainty in K.
  ASTER emissivity gaps can leave permanently missing temperatures; cloud-adjacent
  temperatures can be uncertain even after QA. Mean ST_QA is reported, not
  an uncertainty bound on the regional mean.
- NDVI = (NIR−red)/(NIR+red); NDMI = (NIR−SWIR1)/(NIR+SWIR1);
  NBR = (NIR−SWIR2)/(NIR+SWIR2). Near-zero denominators are masked. Negative
  corrected reflectances are retained, so values may exceed the usual −1..1
  interval. Low NDMI over bare ground is not measured dry fuel. Single-date NBR
  is not burn severity; dNBR needs comparable pre/post observations.
- RH/VPD use the Magnus saturation vapour pressure approximation over liquid
  water. RH is bounded 0..100%, VPD ≥0. Near/below freezing, ice-relative humidity
  differs. Python calculates these from ROI-mean inputs; Code Editor maps them
  per pixel. Wind direction is meteorological **from**, clockwise from north;
  direction is null for a regional mean vector below 0.1 m/s. Averaged u/v is
  a resultant vector, not mean scalar speed or a gust.
- ERA5 pressure is surface pressure /100 in hPa, not sea-level pressure. It
  strongly reflects elevation and is not an independent ignition probability.
- Sentinel-5P catalogue ingestion applies its documented validity filter.
  One DU = 0.00044615 mol/m². The ~1.1 km L3 grid is finer than the instrument's
  multi-kilometre footprint. Ozone thinning requires a seasonal historical
  reference and trend analysis; one low column value cannot establish it.
- No interpolated weather at 30 m, gap-filled values, automatic risk weights or
  fire probabilities are presented. Climate/reanalysis records can lag recent
  imagery; the report preserves missing values and requested times explicitly.

## Verification

Run `.venv/bin/python -m pytest -q`. Earth Engine expression tests use the real
SDK with its offline algorithm catalogue; they do not validate account access,
remote pixel values or scientific predictive skill. Optional browser checks use
Playwright and system Chromium. For a live check after authentication, run the
small-region command above and inspect scene dates, coverage and all data-source
times. No live result or fire forecast has been fabricated for demonstration.
