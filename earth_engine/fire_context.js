// Paste into https://code.earthengine.google.com/ after signing in and selecting
// a registered Cloud project, e.g. sigma-513109. No API key belongs in this file.
// Change ROI and dates. END is exclusive. Re-run to query newly ingested imagery.
var ROI = ee.Geometry.Rectangle([106.7, 47.7, 107.0, 47.9], null, false);
var START = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
var END = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
print('Requested UTC dates (end exclusive)', START, END);
Map.centerObject(ROI, 10);
Map.addLayer(ROI, {}, 'Requested region', false);

var scenes = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(ROI).filterDate(START, END)
  .filter(ee.Filter.gte('CLOUD_COVER', 0))
  .filter(ee.Filter.lte('CLOUD_COVER', 2))
  .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
  .sort('system:time_start', false);
print('Matching scenes, newest first (no cloud relaxation)', scenes);
print('Observations only: no calibrated ignition probability. Weather is ~11 km; Landsat thermal is ~100 m resampled to 30 m.');

var cover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
var coverDisplay = cover.remap([10,20,30,40,50,60,70,80,90,95,100], [0,1,2,3,4,5,6,7,8,9,10]);
Map.addLayer(coverDisplay.clip(ROI), {min:0,max:10,palette:['006400','ffbb22','ffff4c','f096ff','fa0000','b4b4b4','f0f0f0','0064c8','0096a0','00cf75','fae6a0']}, 'Land cover, 2021 (fuel context, not current fuel moisture)', false);
var elevation = ee.Image('USGS/SRTMGL1_003').select('elevation');
Map.addLayer(ee.Terrain.slope(elevation).clip(ROI), {min: 0, max: 45}, 'Terrain slope, degrees', false);

scenes.size().evaluate(function (count, error) {
  if (error) { print('Earth Engine request failed', error); return; }
  if (!count) { print('No 0–2% cloud L2SP scene. Try another period; threshold stays at 2%.'); return; }
  var image = ee.Image(scenes.first());
  var when = ee.Date(image.get('system:time_start'));
  print('Latest scene metadata', image.toDictionary([
    'LANDSAT_PRODUCT_ID', 'SPACECRAFT_ID', 'CLOUD_COVER', 'CLOUD_COVER_LAND',
    'system:time_start', 'PROCESSING_LEVEL', 'WRS_PATH', 'WRS_ROW', 'SUN_ELEVATION']));
  var clear = image.select('QA_PIXEL').bitwiseAnd(63).eq(0)
    .and(image.select('QA_RADSAT').eq(0));
  var sr = image.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
    .multiply(0.0000275).add(-0.2).updateMask(clear);
  function index(a, b, name) {
    var x = sr.select(a), y = sr.select(b);
    return x.subtract(y).divide(x.add(y)).updateMask(x.add(y).abs().gt(1e-6)).rename(name);
  }
  var lst = image.select('ST_B10').multiply(0.00341802).add(149 - 273.15)
    .updateMask(clear).rename('lst_c');
  var ndmi = index('SR_B5','SR_B6','ndmi'), ndvi = index('SR_B5','SR_B4','ndvi');
  var nbr = index('SR_B5','SR_B7','nbr');
  Map.addLayer(sr.clip(ROI), {bands:['SR_B4','SR_B3','SR_B2'], min:0, max:0.3}, 'Latest qualifying Landsat RGB');
  Map.addLayer(lst.clip(ROI), {min:-10, max:50, palette:['2455a4','f4e9ad','c32622']}, 'Surface temperature °C', false);
  Map.addLayer(ndmi.clip(ROI), {min:-0.5, max:0.5, palette:['a45c25','f4e9ad','167b58']}, 'Vegetation moisture proxy NDMI', false);
  Map.addLayer(ndvi.clip(ROI), {min:0, max:1}, 'Vegetation greenness NDVI', false);
  Map.addLayer(nbr.clip(ROI), {min:-1, max:1}, 'NBR (single observation, not burn severity)', false);
  print('Acquired UTC', when.format('YYYY-MM-dd HH:mm:ss'));
  var hour = ee.Date.parse('YYYY-MM-dd HH', when.format('YYYY-MM-dd HH'));
  var weather = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY').filterDate(hour, hour.advance(1,'hour'));
  weather.size().evaluate(function (n, err) {
    if (err || !n) { print('Weather unavailable for acquisition hour; no older observation substituted.', err); return; }
    var w = ee.Image(weather.first());
    var t = w.select('temperature_2m').subtract(273.15);
    var td = w.select('dewpoint_temperature_2m').subtract(273.15);
    function vapor(c) { return c.multiply(17.27).divide(c.add(237.3)).exp().multiply(0.6108); }
    var rh = vapor(td).divide(vapor(t)).multiply(100).clamp(0,100);
    var vpd = vapor(t).subtract(vapor(td)).max(0);
    var wind = w.select('u_component_of_wind_10m').hypot(w.select('v_component_of_wind_10m'));
    var windFrom = w.select('u_component_of_wind_10m').multiply(-1)
      .atan2(w.select('v_component_of_wind_10m').multiply(-1))
      .multiply(180 / Math.PI).add(360).mod(360).updateMask(wind.gte(0.1));
    Map.addLayer(t.clip(ROI), {min:-10,max:40}, 'Air temperature °C, ERA5 hourly', false);
    Map.addLayer(rh.clip(ROI), {min:0,max:100}, 'Relative humidity %, ERA5', false);
    Map.addLayer(vpd.clip(ROI), {min:0,max:4}, 'Vapour pressure deficit kPa, ERA5', false);
    Map.addLayer(wind.clip(ROI), {min:0,max:15}, '10 m wind speed m/s (not gusts)', false);
    Map.addLayer(windFrom.clip(ROI), {min:0,max:360}, 'Wind direction FROM degrees (0 north, 90 east)', false);
    Map.addLayer(w.select('surface_pressure').divide(100).clip(ROI), {min:750,max:1050}, 'Surface pressure hPa (not sea-level)', false);
    Map.addLayer(w.select('volumetric_soil_water_layer_1').clip(ROI), {min:0,max:0.5}, 'Soil water 0–7 cm, m³/m³', false);
  });
  var day = ee.Date.parse('YYYY-MM-dd', when.format('YYYY-MM-dd'));
  var rain = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
    .filterDate(day.advance(-7,'day'),day).select('total_precipitation_sum');
  rain.size().evaluate(function (n, err) {
    if (err || n !== 7) { print('Incomplete previous 7 days of rain; omitted.', err); return; }
    Map.addLayer(rain.sum().updateMask(rain.count().eq(7)).multiply(1000).clip(ROI), {min:0,max:50}, 'Previous 7 complete UTC days rain mm', false);
  });
  var ozone = ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_O3')
    .filterBounds(ROI).filterDate(day,day.advance(1,'day')).select('O3_column_number_density');
  ozone.size().evaluate(function (n, err) {
    if (err || !n) { print('No same-day ozone column observation.', err); return; }
    Map.addLayer(ozone.mean().divide(0.00044615).clip(ROI), {min:200,max:450}, 'Ozone column DU: context, not ozone thinning or fire probability', false);
  });
  // Creates a task definition only. Choose Tasks → Run explicitly to export.
  Export.image.toDrive({image:sr.addBands([lst,ndmi,ndvi,nbr]).toFloat(),
    description:'landsat_fire_context',region:ROI,scale:30,maxPixels:1e8,fileFormat:'GeoTIFF'});
});
