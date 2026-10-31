# Earth Engine → Trend Detective risk map

## Монгол заавар

Үндсэн сайтын бүтэц өөрчлөгдөөгүй. Earth Engine-ээс авсан пикселүүдийг
одоо байгаа **Эрсдэлтэй бүсүүд** газрын зураг, өнгөний тайлбар, баруун талын
дэлгэрэнгүй самбарт харуулна. Тусдаа шинэ хуудас руу шилжихгүй.

Газрын зураг таван ангилалтай: маш бага (ногоон), бага (цайвар ногоон),
дунд (шар), өндөр (улбар шар), маш өндөр (улаан). Энэ бол **туршилтын,
харьцангуй өртөмтгий байдлын** зураг; гал гарах магадлал эсвэл баталгаажсан
сэрэмжлүүлэг биш. Ногоон нь эрсдэлгүй гэсэн үг биш. Өгөгдөлгүй, цастай,
үүлтэй, шатах ургамлын ангилалд ороогүй пикселүүд өнгөгүй үлдэнэ.

### Үндсэн цонхонд огноо сонгох

**Эрсдэлийн бүс** товчийг дарахад үндсэн toolbar дээр **Түймрийн огноо**
сонголт гарна. Он/сар/өдрөө сонгоход тэр өдөрт таарсан зураг үндсэн canvas
дээр ачаална. Тусдаа page эсвэл файл оруулах modal нээхгүй. Өөр өдрийн
зураг орлуулахгүй; өгөгдөлгүй бол өмнөх өнгөт дүрсийг арилгаж тайлбарлана.

Хоёр ажиллах зам бий:

- GitHub Pages дээр `fire-map-index.json`-д бүртгэгдсэн, огноотой бодит
  өгөгдлүүдээс уншина. `fire-map` команд нэг удаад шинэ snapshot болон
  огнооны жагсаалтыг үүсгэж, өмнөх огноонуудыг хадгална.
- Earth Engine эрхтэй сервер дээр дараах командыг ажиллуулбал үндсэн
  цонхны огноо сонголт same-origin `/api/fire-map` руу хүсэлт явуулж
  тухайн өдрийн пикселийг татна. Хүсэлтэд одоогийн бүс/сонгосон хайрцаг
  орно; 2,500 км² хязгаарт багтах жижиг бүс сонгоно.

```bash
.venv/bin/python -m trend_detective fire-serve --project sigma-513109 --port 8000
```

Энэ нь localhost дээр ажиллах dev server. GitHub Pages нь Python ажиллуулдаггүй.
Одоогийн Pages сайт дээр дурын өдрийн live хүсэлт ажиллуулахын тулд эрхтэй
сервер байршуулж, ижил origin-ийн API route-тай холбох шаардлагатай. Google
identity болон тэр hosted service одоогоор тохируулагдаагүй. Хоосон archive
нь бодит өгөгдөл татсан мэт харагдуулахгүй. Файл импорт нь зөвхөн File
цэсний нэмэлт боломж бөгөөд үндсэн огноо сонгох урсгалд шаардлагагүй.

### Бодит өгөгдөл авах

Google Cloud project ID дангаараа нэвтрэлт болохгүй. Одоогийн cloud орчинд
Earth Engine-ийн эрхтэй Google identity байхгүй тул бодит зураг таталт
**баталгаажаагүй**. Сайтад жишээ эсвэл зохиомол эрсдэлийн өгөгдөл оруулаагүй.

[Earth Engine access](https://developers.google.com/earth-engine/guides/access)
заавраар төслөө бүртгүүлж API-г идэвхжүүлнэ. `sigma-513109`,
`temp-support-478105`, `nuur-492511` төслүүдээс өөрийн бүртгэл эрхтэйг сонгоно.
Өөрийн терминалд [Google-ийн authentication заавар](https://developers.google.com/earth-engine/guides/auth)
дагуу нэвтрэх эсвэл cloud орчны аюулгүй тохиргоонд Google identity холбоно.
Токен, нууц үг, authorization code-ыг чат, GitHub эсвэл сайт руу оруулахгүй.

```bash
cd earth_trending
python -m pip install -r requirements-earthengine.txt
earthengine authenticate
python -m trend_detective fire-map \
  --project sigma-513109 \
  --bbox 106.7 47.7 107.0 47.9 \
  --start 2025-04-01 --end 2025-10-01 \
  --resolution 100 --out web/data/fire-risk.js
```

Cloud checkout-д `.venv/bin/python` ашиглана. Команд хамгийн сүүлийн шаардлага
хангасан нэг Landsat зургийн пикселүүдийг авна; өөр өдрийн дүрсээр нүх нөхөхгүй.
`END` өдөр орохгүй. Өөрийн бүс, хугацааг сонгоно; анхны жишээ нь Улаанбаатарын
ойролцоох жижиг талбай. Нэг хүсэлт ≤2,500 км², ≤366 хоног, ≤250,000 дэлгэцийн
пиксел; 100–1000 м дэлгэцийн алхам. Монголын хилээр маскалдаг. Бүх улсыг
хамрахын тулд олон хэсэг, олон зураг, хугацааны тусдаа хяналт шаардлагатай;
энэ команд бүх улсын өнөөдрийн зураг гэж тайлагнахгүй.

Амжилттай гарсан `web/data/fire-risk.js`-ийг сайттай хамт нийтэлбэл үндсэн
viewer ачаалаад **Эрсдэлтэй бүсүүд** товчоор харуулна. Одоо байгаа тоосжилтын
dataset-ийн Давхарга → Эрсдэлийн бүс гэсэн хуучин функц хэвээр. Бусад dataset-ийн
чиг хандлага, FDR, жил/улирлын тохируулга хэвээр. Түймрийн агшин зургийг
сонгоход жил/улирлын чиг-хандлагын удирдлага түр идэвхгүй болно.

`--out cache/fire/map.json` гэж гаргасан файлыг **File → Import Earth Engine
map…**-аар үндсэн зурагт оруулж болно. Энэ нь нэмэлт импорт бөгөөд өдөр сонгох үндсэн урсгал modal нээхгүй. Файлыг JSON байдлаар уншина; JavaScript ажиллуулахгүй. Нүд дээр
дарахад зургаан оролтын утга, ажиглалтын цаг харагдана; хайрцаг сонгох,
zoom, газрын нэр, хил, CSV таталт, хэл солих боломж хадгалагдсан.

Дахин шинэчлэхдээ хүссэн хугацаагаар командыг ажиллуулаад үүссэн өгөгдлийг
нийтэлнэ. Автомат хуваарьт ажил эсвэл байнгын шинэчлэлт суулгаагүй. Ажил
амжилтгүй бол өмнөх файлыг дарж өөрчлөхгүй; газрын зурагт үзүүлсэн огноог
заавал харна. Өмнөх `fire-context` команд нь бүсийн дундаж тайлан гаргах
хэрэгсэл хэвээр; тэр тайлан нь пикселийн газрын зурагтай ижил формат биш.

## Method and data lineage

Asset catalogue availability was checked on 2026-10-31. Remote computations in
the user's Google projects still require authentication and live validation.

| Input | Earth Engine source | Support / processing |
|---|---|---|
| Surface heat, NDMI | [Landsat 8](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C02_T1_L2), [Landsat 9](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC09_C02_T1_L2) | Collection 2 Tier 1 L2SP, `0 <= CLOUD_COVER <= 2`; exclude unknown −1. QA_PIXEL bits 0–5 and nonzero QA_RADSAT excluded. Reflectance = DN×0.0000275−0.2; LST °C = DN×0.00341802+149−273.15; NDMI=(NIR−SWIR1)/(NIR+SWIR1). |
| VPD, 10 m wind, 0–7 cm soil water | [ERA5-Land hourly](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_HOURLY) | Acquisition UTC hour, floor to hour. VPD from Magnus saturation pressure at air/dew-point temperatures; wind = hypot(u,v). ~11 km reanalysis, not forecasts or gusts. |
| Previous rain | [ERA5-Land daily](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_DAILY_AGGR) | Previous 7 complete UTC days; all seven per-pixel samples required. m→mm. Negative accumulation artefacts excluded from classification. |
| Vegetated mask | [ESA WorldCover v200](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200) | Static 2021 classes 10,20,30,40,90,95,100 (tree/shrub/grass/crop/wetland/mangrove/moss-lichen). Not current fuel load or fuel moisture. |
| Country boundary | Existing Natural Earth focus polygon | Outside Mongolia is excluded. |

For **complete vegetated pixels only**, rank six inputs within this request's
valid footprint: high LST, low NDMI, high VPD, high wind, low previous rain,
low soil water. Tied values have identical average ranks. Scale ranks to 0–1,
take their equal-weight mean, and classify in `[0,.2)`, `[.2,.4)`, `[.4,.6)`,
`[.6,.8)`, `[.8,1]`. Constants contribute 0.5 rather than invented spatial
variation. Fewer than two valid pixels produces no classification. NDMI outside
−1..1, negative VPD/wind/rain and soil water outside 0..1 are excluded.

This is an explicit exploratory screening rule, **not a literature-calibrated
fire risk model, FWI implementation, or probability**. Equal weights and bins
are provisional. It needs historical fire labels, out-of-time validation and
local calibration before any operational use. A changed footprint changes the
ranks; maps of different regions/dates cannot be compared as absolute severity.
Missing observations and excluded cover remain `-1`, never a low-risk value.

Output uses an explicit EPSG:4326 grid, north-first download converted to the
viewer's south-to-north row-major layout. Nearest-neighbour display at 100 m
adds no detail to ERA5's ~11 km measurements. Landsat thermal has ~100 m native
support (30 m delivered grid). The generated payload preserves scene ID, scene
cloud cover, acquisition/weather times, rain period, source IDs, grid spacing,
method version, per-pixel inputs, score and class. CSV contains numerical map
cells; the map and side panel retain the source dates and method.

## Additional factors and limits

Terrain slope/aspect, lightning, fuel continuity/curing, human ignition sources,
roads and power infrastructure matter. The [Canadian FWI description](https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi)
explains why persistent fuel-moisture states need history. A single thermal
image is insufficient. [SRTM](https://developers.google.com/earth-engine/datasets/catalog/USGS_SRTMGL1_003)
and WorldCover are available for terrain/fuel context; [VIIRS fire detections](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP14A1)
and [MODIS burned area](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD64A1)
are potential validation data, not pre-ignition predictors in this map.

[Sentinel-5P ozone](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_O3)
and surface pressure remain contextual observations in the `fire-context`
command, not arbitrary weights in this susceptibility score. A single ozone
column does not establish ozone-layer thinning or surface ozone. Atmospheric
pressure is strongly affected by elevation. See [data credits](DATA_LICENSES.md).

## Verification

`.venv/bin/python -m pytest -q` exercises ranking/ties/missing pixels, real SDK
expression construction with mocked remote responses, grid orientation, the
existing canvas/legend/selection, language switching and return to trend layers.
Browser fixtures are test-only and are never saved as site data. These checks
verify software behaviour, not live Google access or predictive skill.
