/* Offline report viewer: imports data, never credentials or executable HTML. */
(function () {
  'use strict';
  let lang = 'mn', report = null;
  const $ = (s) => document.querySelector(s);
  const t = (en, mn) => lang === 'mn' ? mn : en;
  const factors = [
    ['Surface temperature / NDMI / NDVI / NBR', 'Гадаргын температур / NDMI / NDVI / NBR',
      'Heat and vegetation condition from Landsat bands; not metadata alone. Included in both workflows.',
      'Landsat-ын спектрийн сувгаас тооцно; зөвхөн мета өгөгдөл хангалтгүй. Хоёр аргаар хоёуланд орсон.', 'LANDSAT_LC09_C02_T1_L2'],
    ['Wind, humidity & atmospheric dryness', 'Салхи, чийг ба агаарын хуурайшилт',
      '10 m wind, 2 m air temperature, RH and VPD from hourly ERA5-Land. Wind favours spread; dry air dries fuels.',
      'ERA5-Land-ын цаг тутмын 10 м салхи, 2 м агаарын температур, RH, VPD. Салхи тархалтад, хуурай агаар шатах материалын хаталтад нөлөөлнө.', 'ECMWF_ERA5_LAND_HOURLY'],
    ['Rain & soil moisture', 'Хур тунадас ба хөрсний чийг',
      'Previous 7 complete UTC days of precipitation and topsoil water. Long-term drought needs a historical baseline.',
      'Өмнөх бүтэн 7 хоногийн хур тунадас, 0–7 см хөрсний ус. Урт хугацааны гангийн дүгнэлтэд олон жилийн суурь шаардлагатай.', 'ECMWF_ERA5_LAND_DAILY_AGGR'],
    ['Vegetation / fuel & terrain', 'Ургамал / шатах материал ба рельеф',
      'WorldCover 2021 land cover and SRTM slope are included as Code Editor layers. They do not measure current fuel load.',
      'WorldCover 2021 газрын бүрхэвч, SRTM налуу Code Editor-т нэмэгдсэн. Одоогийн шатах материалын хэмжээг шууд хэмжихгүй.', 'ESA_WorldCover_v200'],
    ['Pressure & ozone context', 'Даралт ба озоны нэмэлт мэдээлэл',
      'Surface pressure is included. Sentinel-5P total ozone column is context only: one image cannot establish thinning, surface ozone or ignition risk.',
      'Гадаргын даралт орсон. Sentinel-5P нийт озоны багана нь нэмэлт мэдээлэл; нэг зургаар озоны нимгэрэл, газрын түвшний озон, галын эрсдэлийг тогтоохгүй.', 'COPERNICUS_S5P_OFFL_L3_O3'],
    ['Active fires & previous burns', 'Идэвхтэй түймэр ба өмнөх шаталт',
      'Available for future validation: VIIRS active fire and MODIS MCD64A1 burned area. Not yet joined to these reports. Detection means a fire already exists.',
      'Баталгаажуулалтад ашиглах VIIRS идэвхтэй түймэр, MODIS MCD64A1 шатсан талбай бий. Энэ тайланд хараахан нийлүүлээгүй. Илрүүлэлт нь аль хэдийн гарсан түймрийг заана.', 'NASA_VIIRS_002_VNP14A1'],
    ['Ignition sources', 'Галын эх үүсвэр',
      'Lightning, human activity, roads, power lines and local fuel observations matter. Local and near-real-time coverage must be checked separately; not inferred from Landsat.',
      'Аянга, хүний үйл ажиллагаа, зам, цахилгааны шугам, шатах материалын газар дээрх хэмжилт чухал. Орон нутгийн шуурхай өгөгдлийг тусад нь шалгана; Landsat-аас таамаглан зохиохгүй.', null]
  ];
  function el(tag, text, parent, cls) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    if (parent) parent.append(e);
    return e;
  }
  function value(v, digits = 2) { return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : t('No data', 'Өгөгдөлгүй'); }
  function table(rows, parent) {
    const tab = el('table', undefined, el('div', undefined, parent, 'table-wrap'));
    const head = el('tr', undefined, el('thead', undefined, tab));
    for (const h of [t('Observation', 'Үзүүлэлт'), t('Value / unit', 'Утга / нэгж')]) el('th', h, head);
    const body = el('tbody', undefined, tab);
    for (const [label, val] of rows) { const row = el('tr', undefined, body); el('td', label, row); el('td', val, row); }
  }
  function renderReport() {
    const root = $('#report'); root.replaceChildren();
    if (!report) return;
    el('p', `${report.start_inclusive} → ${report.end_exclusive} (UTC; ${t('end exclusive', 'төгсгөх огноо орохгүй')}) · ${t('Region', 'Бүс')}: ${report.bbox.join(', ')}`, root);
    el('p', t(`Showing ${report.scenes.length} of ${report.matched_scene_count} matching scenes.`, `Нөхцөл хангасан ${report.matched_scene_count} зургаас ${report.scenes.length}-ыг харуулж байна.`), root);
    if (!report.scenes.length) el('p', t('No qualifying scenes. Try another date range; cloud limits stay at 0–2%.', 'Нөхцөл хангасан зураг алга. Өөр огноо сонгож болно; үүлшилтийн хязгаар 0–2% хэвээр.'), root, 'notice');
    for (const scene of report.scenes) {
      const card = el('article', undefined, root, 'scene'), m = scene.metadata;
      el('h3', m.LANDSAT_PRODUCT_ID || m.SPACECRAFT_ID || 'Landsat', card);
      el('p', `${scene.acquired_utc} · ${t('Scene cloud', 'Зургийн үүлшилт')}: ${value(m.CLOUD_COVER)}%`, card);
      const s = scene.surface_means || {}, c = scene.coverage || {}, w = scene.weather || {}, v = w.values || {}, o = scene.ozone || {};
      const rows = [
        [t('Valid ROI coverage: temperature / NDMI (%)', 'Бүсийн хүчинтэй хамрах хувь: температур / NDMI (%)'), `${value(c.lst_c_valid_roi_pct)} / ${value(c.ndmi_valid_roi_pct)}`],
        [t('Surface temperature (°C)', 'Гадаргын температур (°C)'), value(s.lst_c)],
        [t('Mean temperature uncertainty ST_QA (K)', 'Температурын дундаж тодорхойгүй байдал ST_QA (K)'), value(s.lst_uncertainty_k)],
        ['NDVI / NDMI / NBR', [s.ndvi, s.ndmi, s.nbr].map(x => value(x, 3)).join(' / ')],
        [t('Air temperature (°C)', 'Агаарын температур (°C)'), value(v.air_temperature_c)],
        [t('Relative humidity (%)', 'Харьцангуй чийг (%)'), value(v.relative_humidity_pct)],
        ['VPD (kPa)', value(v.vapor_pressure_deficit_kpa)],
        [t('Wind speed (m/s), direction FROM (°)', 'Салхины хурд (м/с), ирэх зүг (°)'), `${value(v.wind_speed_ms)} / ${value(v.wind_from_degrees, 0)}`],
        [t('Surface pressure (hPa)', 'Гадаргын даралт (hPa)'), value(v.surface_pressure_hpa)],
        [t('Soil water 0–7 cm (m³/m³)', 'Хөрсний ус 0–7 см (м³/м³)'), value(v.soil_water_0_7cm_m3_m3, 3)],
        [t('Previous 7 days precipitation (mm)', 'Өмнөх 7 хоногийн хур тунадас (мм)'), value(w.rain_7d?.mm)],
        [t('Ozone column (DU), context only', 'Озоны багана (DU), нэмэлт мэдээлэл'), value(o.column_du)]
      ];
      table(rows, card);
      el('p', `${t('Weather hour requested', 'Цаг агаарын хүссэн цаг')}: ${w.requested_hour_utc || '—'} · ${t('Observation', 'Ажиглалт')}: ${w.actual_time_utc || t('unavailable', 'байхгүй')} · ${t('Ozone day', 'Озоны өдөр')}: ${o.day_utc || '—'}`, card, 'small');
      const images = el('div', undefined, card, 'images');
      const labels = {rgb:t('True colour • transparent = masked / missing', 'Бодит өнгө • тунгалаг = хасагдсан / өгөгдөлгүй'), lst_c:t('Surface °C • blue −10 → red 50', 'Гадарга °C • хөх −10 → улаан 50'), ndmi:t('NDMI • brown −0.5 → green 0.5', 'NDMI • бор −0.5 → ногоон 0.5')};
      for (const [name, label] of Object.entries(labels)) {
        const src = scene.previews?.[name];
        if (typeof src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)) continue;
        const fig = el('figure', undefined, images), img = el('img', undefined, fig);
        img.src = src; img.alt = label; img.loading = 'lazy'; el('figcaption', label, fig);
      }
    }
    if (Array.isArray(report.attribution)) el('p', report.attribution.filter(x => typeof x === 'string').join(' '), root, 'small');
  }
  function render() {
    document.documentElement.lang = lang;
    for (const e of document.querySelectorAll('[data-en]')) e.textContent = e.dataset[lang];
    $('#language').textContent = lang === 'mn' ? 'English' : 'Монгол';
    const root = $('#factors'); root.replaceChildren();
    for (const [en, mn, enText, mnText, source] of factors) {
      const card = el('article', undefined, root); el('h3', t(en, mn), card); el('p', t(enText, mnText), card);
      if (source) { const a = el('a', t('Official data catalogue ↗', 'Албан ёсны каталог ↗'), card); a.href = 'https://developers.google.com/earth-engine/datasets/catalog/' + source; a.target = '_blank'; a.rel = 'noopener'; }
    }
    $('#status').textContent = report ? '' : t('No report loaded. Live Earth Engine access requires Google sign-in.', 'Тайлан оруулаагүй. Earth Engine-ийн шууд өгөгдөлд Google нэвтрэлт шаардлагатай.');
    renderReport();
  }
  $('#language').addEventListener('click', () => { lang = lang === 'mn' ? 'en' : 'mn'; render(); });
  $('#report-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('size');
      const r = JSON.parse(await file.text());
      if (r.schema !== 'trend-detective/fire-context/v1' || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.bbox.every(Number.isFinite) || !Array.isArray(r.scenes) || r.scenes.length > 20 || !Number.isInteger(r.matched_scene_count) || r.matched_scene_count < r.scenes.length || !r.scenes.every(s => s && typeof s.metadata === 'object' && s.metadata && Number.isFinite(s.metadata.CLOUD_COVER) && s.metadata.CLOUD_COVER >= 0 && s.metadata.CLOUD_COVER <= 2)) throw Error('schema');
      report = r; render();
    } catch (_) {
      report = null; $('#report').replaceChildren();
      $('#status').textContent = t('Invalid report or file over 20 MB. Choose a fire-context JSON report.', 'Тайлан тохирохгүй эсвэл файл 20 МБ-аас их байна. fire-context JSON тайлан сонгоно уу.');
    } finally {
      // Permit importing a freshly regenerated report with the same filename.
      event.target.value = '';
    }
  });
  render();
}());
