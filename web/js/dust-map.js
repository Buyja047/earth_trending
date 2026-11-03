/* Actual MODIS detections. Every classification has its own meaning, not severity. */
(function(root){
'use strict';
const colors=['#75aa83','#edaa30','#537d9d','#c77726','#9b929f'];
const labels={en:['Clear land','Dust over land','Water · unclassified','Dust over water','Land · unclassified'],mn:['Тоос илрээгүй газар','Газар дээрх тоос','Ус · ангилаагүй','Усан дээрх тоос','Газар · ангилаагүй']};
const fields={idi:'IDI',ndai:'NDAI',ndvi:'NDVI',ndwi:'NDWI (green/NIR)',ndwi_nir_swir:'NDWI (NIR/SWIR)',btd_20_31:'BT20 − BT31 (K)',r47:'R4,7'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const is=sc=>sc?.kind==='dust-risk';
function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function validate(sc){
 const g=sc?.grid,n=g?.nx*g?.ny;
 if(!is(sc)||sc.id!=='dust-risk'||sc.schema!=='trend-detective/dust-map/v1'||sc.method!=='modis-idi-otsu-v1'||!Number.isInteger(g?.nx)||!Number.isInteger(g?.ny)||g.nx<2||g.ny<2||n>250000)throw Error('Invalid MODIS dust map');
 for(const [a,size,d,lo,hi] of [[g.lon,g.nx,g.dlon,-180,180],[g.lat,g.ny,g.dlat,-90,90]]){
  if(!Array.isArray(a)||a.length!==size||!Number.isFinite(d)||d<=0||!a.every((x,i)=>Number.isFinite(x)&&x-d/2>=lo-1e-8&&x+d/2<=hi+1e-8&&(!i||Math.abs(x-a[i-1]-d)<d*1e-5)))throw Error('Invalid dust map geometry');
 }
 if(!validDay(sc.period?.start)||sc.period.end!==sc.period.start||typeof sc.acquired_utc!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(sc.acquired_utc)||!Number.isFinite(Date.parse(sc.acquired_utc))||new Date(sc.acquired_utc).toISOString().slice(0,10)!==sc.period.start)throw Error('Dust map date mismatch');
 if(!Array.isArray(sc.classes)||sc.classes.length!==n||!sc.classes.every(c=>Number.isInteger(c)&&c>=-1&&c<=4))throw Error('Invalid dust classes');
 for(const key of Object.keys(fields))if(!Array.isArray(sc.factors?.[key])||sc.factors[key].length!==n||!sc.factors[key].every(x=>x===null||Number.isFinite(x)))throw Error('Invalid dust indices');
 if(typeof sc.source!=='string'||!sc.source||!Number.isFinite(sc.native_resolution_m)||sc.native_resolution_m<1000||typeof sc.water_detection_enabled!=='boolean'||!(sc.idi_threshold===null||Number.isFinite(sc.idi_threshold)))throw Error('Missing MODIS provenance');
 for(const k of ['land_dust_km2','water_dust_km2','observed_km2','unclassified_km2','missing_km2','total_km2'])if(!Number.isFinite(sc.areas?.[k])||sc.areas[k]<0)throw Error('Invalid dust area');
 sc.classes.forEach((c,i)=>{if((c>=0&&['idi','ndvi','ndwi'].some(k=>sc.factors[k][i]===null))||(c===3&&!sc.water_detection_enabled)||([0,1].includes(c)&&(sc.idi_threshold===null||(sc.factors.idi[i]>sc.idi_threshold)!==(c===1))))throw Error('Inconsistent dust classification');});
 return sc;
}
function method(mn){return mn?'Г.Түмэнжаргалын дипломын MODIS шийдвэрийн модны аргыг ашиглав. Үүл, цас, хүчингүй пикселийг хасна. Схемийн NDVI < 0.07 ба NDWI=(B4−B2)/(B4+B2)>0 нөхцөлөөр усыг ялгана. IDI=(BT20/BT31)^(BT32−BT31); газар дээр IDI > Otsu босго үед тоос гэж ангилна. Усны NDAI=−10 log10(B8/B7); усны гурван босгыг тохируулаагүй бол усыг ангилаагүй үлдээнэ. Otsu босго ганц төрлийн утгаас тогтохгүй бол газрыг мөн ангилаагүй үлдээнэ. Энэ нь тухайн өдрийн дагуулын ажиглалтын боломжит тоосны тархалт; хүч, PM2.5, ирээдүйн эрсдэлийн магадлал биш. Хоосон хэсгийг тоосгүй гэж үзэхгүй.':'Adapted from G. Tumenjargal’s MODIS decision tree. Mask cloud, snow and invalid pixels. Water: NDVI < 0.07 and NDWI=(B4−B2)/(B4+B2)>0, following the diagram. Land dust: IDI=(BT20/BT31)^(BT32−BT31) > the scene’s Otsu threshold. Water NDAI=−10 log10(B8/B7) requires three calibrated water thresholds; otherwise water remains unclassified. Land also remains unclassified when Otsu cannot split a constant scene. Candidate dust observed at an overpass on this UTC date, not intensity, PM2.5 or a forecast probability. Blank pixels do not establish dust absence.';}
function empty(date,bbox,message){
 const [w,s,e,n]=bbox;
 return {id:'dust-risk',kind:'dust-risk',unavailable:true,message,period:{start:date,end:date},title:'Daily yellow dust',region:'mongolia',grid:{nx:1,ny:1,lon:[(w+e)/2],lat:[(s+n)/2],dlon:e-w,dlat:n-s},classes:[-1],factors:{}};
}
const area=x=>Number(x).toLocaleString(undefined,{maximumFractionDigits:1});
function summary(sc,mn){
 const title=mn?'Шар шороон шуурганы тархалт':'Yellow dust distribution';
 if(sc.unavailable)return `<b>${title} · ${esc(sc.period.start)}</b><p>${esc(sc.message)}</p><p>${mn?'Энэ өдрийн тархалтыг тодорхойлох боломжгүй.':'Distribution cannot be determined for this date.'}</p>`;
 const a=sc.areas, dust=a.land_dust_km2+a.water_dust_km2;
 const coverage=a.total_km2?100*a.observed_km2/a.total_km2:0;
 return `<b>${title}</b><p>${esc(sc.period.start)} · UTC · MODIS</p><p><strong>${area(dust)} км²</strong> · ${mn?'тоос илэрсэн талбай':'detected dust area'}</p><p>${mn?'Ажиглалтаар хамарсан':'Observation coverage'}: ${coverage.toFixed(1)}%</p><p>${mn?'Ажиглагдсан':'Observed'}: ${area(a.observed_km2)} км²<br>${mn?'Ангилаагүй':'Unclassified'}: ${area(a.unclassified_km2)} км²<br>${mn?'Үүл / цас / өгөгдөлгүй':'Cloud / snow / missing'}: ${area(a.missing_km2)} км²</p><p>${mn?'Дагуулын ажиглалтаар илрүүлсэн боломжит тоос. Хоосон хэсгийг тоосгүй гэж үзэхгүй.':'Candidate dust from a satellite overpass. Blank areas do not establish dust absence.'}</p><details><summary>${mn?'Ажиглалтын мэдээлэл':'Observation details'}</summary><p>${esc(sc.source)}<br>${esc(sc.acquired_utc)}<br>${sc.native_resolution_m} m · IDI / Otsu: ${sc.idi_threshold===null?'—':sc.idi_threshold.toPrecision(5)}</p></details>`;
}
function legend(sc,mn){if(sc.unavailable)return `<span>${esc(sc.period.start)} · ${mn?'Энэ өдрийн шуурганы өгөгдөлгүй':'No dust data for this date'}</span>`;return colors.map((c,i)=>`<span><i class="sw" style="background:${c}"></i>${labels[mn?'mn':'en'][i]}</span>`).join('')+`<span class="muted">${mn?'Хоосон: үүл / цас / өгөгдөлгүй':'Blank: cloud / snow / missing'} · ${esc(sc.period.start)} UTC</span>`;}
function inspect(sc,sel,mn){
 const ids=sel?.type==='cell'?[sel.i]:sel?.cells||[],ok=ids.filter(i=>sc.classes[i]>=0);
 if(!ok.length)return mn?'Газрын зураг дээр дарж индексүүдийг харна.':'Click the map to inspect MODIS indices.';
 const rows=Object.entries(fields).map(([k,name])=>{const v=ok.map(i=>sc.factors[k][i]).filter(x=>x!==null);return `<dt>${name}</dt><dd>${v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(4):'—'}</dd>`;}).join('');
 return `<p>${ok.length===1?labels[mn?'mn':'en'][sc.classes[ok[0]]]:`${ok.length} ${mn?'нүдний дундаж':'cell means'}`}</p><dl class="kv">${rows}</dl><p>${esc(sc.acquired_utc)}</p>`;
}
function csv(sc){const keys=Object.keys(fields),g=sc.grid;return ['# '+sc.period.start+' UTC; '+sc.method+'; -1=missing/cloud/snow; 0=clear land; 1=land dust; 2=unclassified water; 3=water dust; 4=unclassified land','date_utc,lon,lat,class,'+keys.join(','),...sc.classes.map((c,i)=>[sc.period.start,g.lon[i%g.nx],g.lat[Math.floor(i/g.nx)],c,...keys.map(k=>sc.factors[k][i]??'')].join(','))].join('\n');}
root.TDDustMap={is,validate,validDay,colors,labels,method,empty,summary,legend,inspect,csv};
})(typeof window==='undefined'?globalThis:window);
