# Өдөр тутмын шар шороон шуурганы тархалт · MODIS

**Эрсдэлийн бүс → Шар шороон шуурга → Огноо (UTC)**. Өмнөх/дараах
өдөр рүү сумтай товчоор шилжинэ. Түймрийн зураг руу мөн энэ сонголтоос
шилжинэ. Үерийн сонголт харагдах боловч арга, өгөгдөл нэмэгдэх хүртэл идэвхгүй.
MODIS-ийн бодит сувгийн мэдээг серверээр шууд татаж тооцох, эсвэл өмнө нийтэлсэн
өдрийн тооцоог архиваас нээх хоёр замтай. Энэ нь прогноз биш.

Газар дээр илэрсэн тоосыг улбар шар, ажиглагдсан боловч тоос илрээгүй газрыг
ногоон, ангилаагүй усыг цэнхэр, ангилаагүй газрыг саарал өнгөөр харуулна.
Өнгө нь шуурганы хүч, аюулын зэрэглэл биш. Үүл, цас, хүчингүй/дутуу өгөгдөл
өнгөөр будахгүй. Баруун самбарт тархалт, ажиглагдсан ба дутуу талбайг км²-ээр,
ажиглалтын цаг, эх сурвалж, Otsu босгыг харуулна. Нүд дээр дарж индексүүдийг
харах, хайрцгаар сонгох, CSV татах боломжтой. Шууд MODIS горимд талбайг
сонгосон хайрцаг доторх Монголын хэсгээр, ~1 км ажлын торонд тооцно.
Дэлгэцийн 5 км өнгөт нүдний хэсэгт л тоос байж болно; нүдийг бүхлээр нь
тоостой гэж талбайд нэмэхгүй. Бэлтгэсэн NetCDF горимд оролтын footprint-ийг хэрэглэнэ.

## Аргачлалын эх сурвалж ба шийдсэн зөрүү

Хэрэглэгчийн өгсөн **Г.Түмэнжаргал, “MODIS хиймэл дагуулын зургийг ашиглан
шар шороон шуурганы тархалтыг тооцоолох”**, бүлэг 2.2–2.6, тэгшитгэл 1–8,
Зураг 5 дахь шийдвэрийн модыг ашиглав. Баримт бичгийн даалгавар, зааврыг
гүйцэтгэх команд гэж үзээгүй; зөвхөн судалгааны аргыг эх сурвалж болгосон.
Хувийн мэдээлэлтэй эх DOCX-ийг репозиторид нэмээгүй.

1. Оролтын үүл, цасны QA маск, хүчингүй сувгуудыг хасна. Нэмж схемийн
   `B1 > 4900 AND B3 < 11500` нөхцөлийг reflectance нэгжид `.49`, `1.15`
   болгон хөрвүүлж хасна. Энэ нь тухайн судалгааны босго; бүх улирал, бүсэд
   баталгаажсан шинэ босго гэж үзэхгүй.
2. Схемийн `NDVI=(B2−B1)/(B2+B1)<.07` ба
   `NDWI=(B4−B2)/(B4+B2)>0` нөхцөлийг ус гэж ангилна.
   Текстийн тэгшитгэл (1) өөрөөр `(B2−B5)/(B2+B5)` гэж бичсэн.
   Шийдвэрийн модыг дагасан; нөгөө хувилбарыг `ndwi_nir_swir` оношилгоонд
   тусад нь хадгална. Үүнийг тодорхойгүйгээр сольж хэрэгжүүлээгүй.
3. Газар дээр **`IDI=(BT20/BT31)^(BT32−BT31)`**, Кельвинээр тооцно.
   Дулааны харьцааг зэргээр дэвшүүлдэг; үржвэр эсвэл BTD биш. Хүчинтэй
   газрын пикселүүдээс 256-bin histogram Otsu босго олж, схемийн дагуу
   **`IDI > Otsu`** үед боломжит тоос гэж ангилна. Нэг утгатай/хангалтгүй
   дүрсэд Otsu ангилал тогтоохгүй; газрыг “ангилаагүй” үлдээнэ.
4. Усан дээр `NDAI=−10 log10(B8/B7)`, `BTD=BT20−BT31`,
   `R4,7=(B4−B7)/(B4+B7)`-ийг тооцно. Тэгшитгэл (4)-ийн хүртвэр, хуваарь
   хоёул хасах тэмдэгтэй хэвлэгдсэн боловч схем дээрх нийлбэр хуваарийг дагав.
   Баримт бичиг BTD/R4,7/NDAI-ийн тоон босго, бүрэн чиглэлийг заагаагүй.
   Иймд **анхдагчаар усан дээр тоос/тоосгүй гэж дүгнэхгүй**. Тусад нь
   баталгаажуулсан гурван `--water-…-min` босгыг өгсөн үед тус бүрээс их
   байх туршилтын салбар ажиллана; энэ нэмэлт нөхцөл нь дипломын бүрэн
   давталт гэж батлагдаагүй. API-ийн анхдагч салбар ус ангилахгүй.
5. WGS84 нүдний бодит хил, өргөргийн синусын ялгаагаар бөмбөрцгийн талбай
   тооцно (радиус 6371.0088 км). Нүд бүрийг 1 км² гэж таамаглахгүй.

Otsu нь хоёр хэсэг болгон хуваах статистик арга тул үүл/цас/гадаргуугийн
алдаа, бүхэлдээ тоостой эсвэл тоосгүй дүрсэд ташаа ангилал гаргаж болно.
Газрын ажиглалттай баталгаажуулах шаардлагатай. Энэ нь MODIS overpass-ийн
**боломжит тоосны ажиглалт**; өдрийн бүх цагийн хамгийн их тархалт, PM2.5,
салхины тооцоо эсвэл ирээдүйн эрсдэлийн магадлал биш.

## MODIS сувгаас шууд тооцох

`modis-dust` болон `dust-serve --modis-live` нь дараах бүх алхмыг гүйцэтгэнэ:

1. NASA CMR-ээс сонгосон UTC өдөр, хайрцагт таарах **Collection 6.1**
   MOD021KM + MOD03 + MOD35_L2 (Aqua бол MYD…) файлыг хайна.
   Хиймэл дагуул, acquisition өдөр/цагийг яг тааруулж хослуулна.
   Дутуу companion файлыг өөр цагийнхаар нөхөхгүй; хэт олон үр дүнг огтлохгүй.
2. Серверийн `EARTHDATA_TOKEN`-оор LAADS-аас raw HDF4 файлуудыг татна.
   Content signature, бүрэн татагдсан хэмжээ, SHA-256 cache receipt шалгана.
   Нэвтрэх HTML хуудас, тасарсан файлыг мэдээ гэж хүлээн авахгүй.
3. MOD03-ийн **1 км** latitude/longitude, solar zenith-ийг ашиглана.
   MOD021KM-ийн 1/2, 3/4/5/7, 8 болон 20/31/32 сувгийг нэг acquisition-оос уншина.
   SDS доторх scale/offset, valid range, fill value-г хэрэглэнэ.
4. Reflectance: `(DN-offset)*scale/cos(solar zenith)`; solar zenith ≥85°-г хасна.
   Дулааны радиансыг W m⁻² sr⁻¹ µm⁻¹ нэгжээр гаргаж, Planck болон
   MODIS_BRIGHT effective wavenumber, correction slope/intercept-ээр **Кельвин** болгоно.
   LST болон өнгөт JPEG-ийг brightness temperature болгон ашиглахгүй.
5. MOD35 byte 0: cloud mask determined, daytime, confidently clear байхыг шаардана;
   snow/ice-ийг тусад нь хасна. Confidence нь cloudy/uncertain/probably-clear
   бол тооцоонд оруулахгүй. Энэ хатуу маск зарим тоосыг бас хасаж болно.
6. Ажиглалт **бүрд** эх 1 км swath дээр IDI/Otsu тооцоод, ~1 км WGS84 ажлын
   торонд 1.5 км-ээс хол сунгахгүйгээр nearest-neighbour байрлуулна.
   Дараагийн цэвэр/үүлтэй ажиглалт өмнөх тоос илэрсэн нүдийг арилгахгүй.
   Өөр өөр цагийн спектрийн сувгуудыг холихгүй.
7. Өдрийн нийлбэрийг дэлгэцийн торонд (анхдагч 5 км) хураангуйлна.
   Нүд бүрийн индекс нь нэг сонгогдсон ажиглалтынх; `observation_index` нь
   түүний эх файл, цаг, тухайн swath-ийн Otsu босгыг заана. Inspector, CSV-д
   энэ acquisition lineage харагдана. Талбайг 5 км өнгөт нүдээр дахин тоолохгүй.

Энэ нь MODIS-ийн ажигласан цагууд дахь **боломжит тоосны нийлбэр тархалт**.
Өдрийн ажиглагдаагүй цагт юу болсныг тогтоохгүй. L1B **TOA reflectance** нь
MOD09-ийн atmosphere-corrected surface reflectance-тэй ижил бүтээгдэхүүн биш;
дипломын эмпирик үүл/усны босгыг L1B-д хэрэглэсэн энэ хувилбарыг газрын
ажиглалттай дахин баталгаажуулах шаардлагатай.

### Earthdata эрхийг нэг удаа тохируулах

Raw сувгийн файл нь үнэгүй боловч NASA Earthdata Login шаарддаг.
[Earthdata бүртгэл](https://urs.earthdata.nasa.gov/users/new) үүсгээд
[NASA-ийн EDL token заавар](https://ladsweb.modaps.eosdis.nasa.gov/learn/download-files-using-edl-tokens/)-аар
токен авна. Чат, JSON, HTML, JavaScript, git файлд токеноо бичихгүй.

- Codex/cloud серверт: Environment **Secrets** дотор `EARTHDATA_TOKEN` нэрээр холбоно.
- GitHub Actions-д: **Settings → Secrets and variables → Actions → New repository secret**,
  нэр нь `EARTHDATA_TOKEN`, утга нь өөрийн EDL token.
- Өөрийн компьютерт: process environment эсвэл системийн secret manager-ээр холбоно.

```bash
python -m pip install -r requirements-modis.txt

# Зөвхөн каталог шалгана; Earthdata эрх хэрэггүй.
python -m trend_detective modis-dust --date 2013-03-09 --plan

# Сувгийг шууд татаж тооцоод огноотой архив гаргана.
python -m trend_detective modis-dust --date 2013-03-09 \
  --out web/data/dust-risk.js

# Дурын өдөр сонгоход сервер бодит сувгийг татаж тооцно.
python -m trend_detective dust-serve --modis-live --port 8000
# http://localhost:8000/web/index.html#risk/dust/2013-03-09
```

`--sensor terra|aqua|both`, `--bbox WEST SOUTH EAST NORTH`, `--resolution 1000..20000`
(1000 м-ийн бүхэл үржвэр), `--cache cache/modis` сонголттой. Бүх Монголд 5 км
дэлгэцийн тор тохиромжтой; 1 км-ийг жижиг хайрцагт хэрэглэнэ. Хайрцаг бүрт
≤32 acquisition, дэлгэцэд ≤250,000 нүд, ажлын торонд ≤6,000,000 нүд.
Кэш нь огноо, bbox, sensor, арга, тохиргоогоор тусдаа; хожим нэмэгдсэн файлыг
CMR-ээс шалгаж тооцоогоо шинэчилнэ.

### Одоогийн GitHub Pages-д өдөр бүр гаргах

`.github/workflows/modis-dust.yml` нь хэрэгжүүлсэн workflow. PR merge хийгдэж,
дээрх repository secret тохируулагдсаны дараа:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions** сонгоно.
2. **Actions → Daily MODIS channel dust maps → Run workflow** нээж, турших
   огноо (жишээ нь `2013-03-09`) өгнө. Амжилттай бол бодит үр дүнг архивт
   commit хийгээд Pages artifact-аар сайтад байршуулна.
3. Цаашид өдөр бүр **06:17 (Asia/Ulaanbaatar)**-д сүүлийн 3 бүтэн UTC өдрийг
   дахин шалгана (NASA-ийн хожуу ирсэн бүтээгдэхүүнийг авахын тулд).
   Токенгүй/алдаатай бол ажил амжилтгүй болж, шинэ зураг зохиож нийтлэхгүй.

Зөвхөн `web/`, үндсэн HTML-үүдийг Pages artifact-д оруулна; raw cache, токен,
серверийн process environment орохгүй. Энэ өөрчлөлт PR салбарт байх үед
хуваарь үндсэн сайтад идэвхжихгүй. GitHub Actions-ийн ажлын хугацаа, таталт нь
тухайн дансны runner quota-г хэрэглэнэ.

GitHub Pages өөрөө Python ажиллуулахгүй. Урьдчилан боловсруулаагүй дурын
огноог browser-оос шууд тооцуулах бол дээрх серверийг gateway-ийн цаана байрлуулаад:

```bash
python -m trend_detective dust-serve --modis-live \
  --allow-origin https://buyja047.github.io --port 8000
```

`web/data/services.json` дахь `dust_api_base`-д тухайн **HTTPS серверийн base URL**
тавина (өгөгдмөл нь хоосон, same-origin `/api/dust-map`). Токен оруулахгүй.
CORS origin-ийг яг тааруулна. Сервер анхдагчаар loopback-д сонсдог; гаднаас
хандах deployment нь reverse proxy-оор холбох үүрэгтэй.
Суурь MODIS RGB зураг өдөр сонголттой зэрэг солигдоно; RGB нь тооцооны эх суваг биш.

### Бодит хандалтын шалгалтын төлөв

2026-11-03-нд CMR-ээс 2013-03-09 (106–107°E, 45–46°N) өдрийн нэг бүрэн
triplet, мөн 2026-11-02-нд бүх Монголын bbox-д **5 acquisition-ийн бүрэн triplet**
олсон. Энэ session-д Earthdata бүртгэл/токен байхгүй тул authenticated raw
таталт, Монголын бодит сувгийн end-to-end тооцоог **ажиллуулж баталгаажуулаагүй**.
NASA-ийн unauthenticated файл хүсэлт Earthdata login руу шилжсэнийг шалгасан.
Тестийн HDF4-үүд нь зөвхөн тестийн өгөгдөл; сайт руу нийтлээгүй.

## Бэлтгэсэн NetCDF ашиглах нэмэлт зам

`dust-map --input` болон `dust-serve --input-dir` хуучин нэмэлт замууд хэвээр.
Шууд MODIS горимд хэрэглэгч NetCDF бэлтгэх шаардлагагүй. Хэрэв өөрийн calibration
pipeline-ийн файл ашиглах бол нэг daytime acquisition-ий дараах бүтэцтэй байна:

NetCDF оролтын заавал байх бүтэц:

| Зүйл | Шаардлага |
| --- | --- |
| Координат | `lat`, `lon`: өсөх, жигд алхамтай WGS84 нүдний төв, тус бүр ≥2 |
| Хэмжээс | Суваг/маск бүр `lat,lon`; ≤250,000 нүд |
| Reflectance | `b1,b2,b3,b4,b5,b7,b8`; `units="1"`; scale/offset хэрэглэсэн |
| Температур | `bt20,bt31,bt32`; `units="K"`; brightness temperature |
| Маск | `cloud_mask,snow_mask`; `units="1"`; 0=хасахгүй, 1=хасна; NaN/бусад утга=хүчингүй |
| Атрибут | `acquired_utc`: timezone-тай UTC өдрийн timestamp; `source`: бүтээгдэхүүн/гранулын ID; `native_resolution_m`: ≥1000 |

Өдрийг UTC-ээр шалгана. Давхаргаар харагдах огноо яг оролтын ажиглалтын
өдөртэй таарна. Координат, нэгж, шаардлагатай суваг, огноо тохироогүй бол
алдаатай зогсоно. Өмнөх өдрийн зураг орлуулж харуулахгүй.

```bash
python -m trend_detective dust-map \
  --input /path/to/modis/2025-06-01.nc --date 2025-06-01 \
  --out web/data/dust-risk.js
```

Энэ нь `dust-risk-2025-06-01.js`, `dust-risk.js`, `dust-map-index.json` болон
офлайнаар сонгоход ашиглах `dust-map-index.js` үүсгэнэ. Өмнөх огноонуудыг
хадгална. Өдөр тутмын upstream pipeline шинэ NetCDF бэлтгэсний дараа энэ
командыг ажиллуулж, шинэ archive-ийг GitHub Pages-тэй хамт нийтэлнэ.
Шууд MODIS горим болон дээрх workflow нь энэ NetCDF алхмыг шаарддаггүй.

Огноогоор шууд боловсруулах локал сервер:

```bash
python -m trend_detective dust-serve --input-dir /path/to/modis --port 8000
# http://localhost:8000/web/index.html#risk/dust/2025-06-01
```

Сервер `/path/to/modis/YYYY-MM-DD.nc`-г exact date-аар нээнэ. Файлгүй бол
өгөгдөлгүй гэж буцаана. Түймрийн Earth Engine endpoint-тай хамтад нь:

```bash
python -m trend_detective fire-serve --project YOUR_PROJECT \
  --dust-dir /path/to/modis --port 8000
```

GitHub Pages Python ажиллуулахгүй; тэнд зөвхөн нийтэлсэн өдрийн archive
ажиллана. Hosted live service хэрэгтэй бол same-origin `/api/dust-map`
route-тай эрхтэй сервер байрлуулах шаардлагатай. Өгөгдлийн эрхийг browser
эсвэл git файлд хадгалахгүй; GitHub Actions-д encrypted secret хэрэглэнэ.

## Өргөтгөх ба шалгах

`web/js/risk-maps.js` нь төрөл, нэр, доод огноо, adapter-ийн бүртгэл.
Үерийн бодит загвар/өгөгдөл бэлэн болоход өөрийн adapter-ийг бүртгэж,
disabled төлвийг арилгана. Огноо сонголт, canvas, inspector, CSV,
хэл солих, тренд шинжилгээ рүү буцах нийтлэг урсгалыг хуулбарлахгүй.

`tests/test_dust.py`: томьёо, босгоны чиглэл, дутуу өгөгдөл, үүл/цас,
усны салбар, талбай, огноо, archive. `tests/test_dust_viewer.py`: canvas-ийн
өнгө, төрөл/огноо/хэл солих, дутуу өдөр, трендэд буцах. Зөвхөн тестийн
хиймэл raster ашиглана; тэдгээр нь `web/data`-д нийлүүлэгдэхгүй.

## Калибровк, QA-ийн техникийн эх сурвалж

- [NASA MODIS Collection 6.1 MOD021KM product](https://modaps.modaps.eosdis.nasa.gov/services/about/products/c61/MOD021KM.html)
- [NASA CMR Search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- [NASA MOD35 format and dimensions](https://modis-images.gsfc.nasa.gov/MOD35_L2/format.html),
  [Cloud Mask Users Guide](https://modis-images.gsfc.nasa.gov/_docs/CMUSERSGUIDE.pdf)
- [NASA SatVision calibration equations and MODIS_BRIGHT coefficients](https://huggingface.co/nasa-cisto-data-science-group/satvision-toa-giant-patch8-window8-128)
- [Satpy MODIS L1B calibration reference](https://github.com/pytroll/satpy/blob/main/satpy/readers/modis_l1b.py)

`tests/test_modis_channels.py` нь жинхэнэ HDF4 SDS уншилт, scale/offset,
термал хувиргалт, QA bit flags, яг таарсан triplet, тасарсан/HTML таталт,
өдрийн union ба per-cell lineage, display reduction, cache refresh-ийг шалгана.
Бодит нэвтрэлтийг эдгээр тест орлохгүй.
