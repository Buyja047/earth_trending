/* A categorical raster for the existing map; no extra page or live credentials. */
(function(root){
'use strict';
const colors=['#238b00','#8cdb00','#ffea00','#ff9500','#e31a1c'];
const labels={en:['Very low','Low','Moderate','High','Very high'],mn:['Маш бага','Бага','Дунд','Өндөр','Маш өндөр']};
const fields={lst_c:['Surface °C','Гадарга °C'],ndmi:['NDMI','NDMI'],vpd_kpa:['VPD kPa','VPD кПа'],wind_ms:['Wind m/s','Салхи м/с'],rain_7d_mm:['Rain 7 d mm','7 хоногийн тунадас мм'],soil_water:['Soil water m³/m³','Хөрсний ус м³/м³']};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const is=sc=>sc?.kind==='fire-risk';
function validate(sc){
 const g=sc?.grid,n=g?.nx*g?.ny;
 if(sc?.schema!=='trend-detective/fire-map/v1'||sc.id!=='fire-risk'||!is(sc)||!Number.isInteger(g?.nx)||!Number.isInteger(g?.ny)||g.nx<1||g.ny<1||n>250000) throw Error('Invalid fire map');
 for(const [a,size,d] of [[g.lon,g.nx,g.dlon],[g.lat,g.ny,g.dlat]]){
  if(!Array.isArray(a)||a.length!==size||!Number.isFinite(d)||d<=0||!a.every((x,i)=>Number.isFinite(x)&&(!i||Math.abs(x-a[i-1]-d)<d*1e-5))) throw Error('Invalid map geometry');
 }
 if(g.lon[0]<-180||g.lon.at(-1)>180||g.lat[0]<-90||g.lat.at(-1)>90) throw Error('Invalid coordinates');
 if(!Array.isArray(sc.classes)||sc.classes.length!==n||!sc.classes.every(c=>Number.isInteger(c)&&c>=-1&&c<=4)) throw Error('Invalid classes');
 for(const a of [sc.score,...Object.keys(fields).map(k=>sc.factors?.[k])]) if(!Array.isArray(a)||a.length!==n||!a.every(x=>x===null||Number.isFinite(x))) throw Error('Invalid factors');
 if(!Number.isFinite(sc.metadata?.CLOUD_COVER)||sc.metadata.CLOUD_COVER<0||sc.metadata.CLOUD_COVER>2||sc.method!=='relative-percentile-six-factor-v1') throw Error('Invalid source/method');
 for(const date of [sc.acquired_utc,sc.weather_hour_utc,sc.period?.start,sc.period?.end]) if(typeof date!=='string'||!Number.isFinite(Date.parse(date))) throw Error('Invalid date');
 sc.classes.forEach((c,i)=>{if(c>=0&&(sc.score[i]===null||sc.score[i]<0||sc.score[i]>1||c!==Math.min(4,Math.floor(sc.score[i]*5))||Object.keys(fields).some(k=>sc.factors[k][i]===null))) throw Error('Incomplete valid pixel');});
 return sc;
}
function method(mn){return mn?'Туршилтын харьцангуй өртөмтгий байдал: гадаргын халуун, NDMI-ийн бууралт, агаарын хуурайшилт, салхи, хур тунадас ба хөрсний чийгийн бууралтын бүс доторх эрэмбийн дундаж. Зургаан үзүүлэлт ижил жинтэй. Онооны 0.2 тутмын заагаар тав ангилсан; бүсүүдийг хооронд нь шууд харьцуулахгүй. Гал гарах магадлал биш; ногоон нь эрсдэлгүй гэсэн үг биш. Хоосон хэсэг нь өгөгдөлгүй эсвэл шатах ургамлын бүрхэвчгүй. Цаг агаарын бодит тор ~11 км; зурагт нарийвчилж байрлуулах нь шинэ хэмжилт нэмэхгүй.':'Experimental relative susceptibility: equal-weight within-region percentile ranks of surface heat, low NDMI, VPD, wind, low rain and low soil moisture; score bins every 0.2. Not comparable across regions, not a calibrated fire probability. Green does not mean zero risk. Blank means incomplete data or excluded land cover. Weather has ~11 km native support; display pixels add no meteorological detail.';}
function empty(date,bbox,message){
 const [w,s,e,n]=bbox;
 return {kind:'fire-risk',id:'fire-risk',unavailable:true,message,period:{start:date,end:date},title:'Fire risk',region:'mongolia',grid:{nx:1,ny:1,lon:[(w+e)/2],lat:[(s+n)/2],dlon:e-w,dlat:n-s},classes:[-1],score:[null],metadata:{},factors:{}};
}
function summary(sc,mn){if(sc.unavailable)return `<b>${mn?'Түймрийн зураг · ':'Fire map · '}${esc(sc.period.start)}</b><p>${esc(sc.message)}</p>`;return `<b>${mn?'Түймрийн харьцангуй өртөмтгий байдал':'Relative fire susceptibility'}</b><p>${esc(sc.acquired_utc)} · ${esc(sc.metadata.LANDSAT_PRODUCT_ID)} · ${sc.metadata.CLOUD_COVER}% ${mn?'үүл':'cloud'}</p><p>${esc(method(mn))}</p>`;}
function legend(sc,mn){if(sc.unavailable)return `<span>${esc(sc.period.start)} · ${mn?'Энэ өдрийн эрсдэлийн өгөгдөлгүй':'No risk data for this date'}</span>`;return colors.map((c,i)=>`<span><i class="sw" style="background:${c}"></i>${labels[mn?'mn':'en'][i]}</span>`).join('')+`<span class="muted">${mn?'Харьцангуй ангилал · хоосон: өгөгдөлгүй / хасагдсан':'Relative classes · blank: no data / excluded'} · ${esc(sc.acquired_utc)}</span>`;}
function inspect(sc,sel,mn){
 const ids=sel?.type==='cell'?[sel.i]:sel?.cells||[];
 if(!ids.length)return mn?'Газрын зургийн өнгөт хэсэг дээр дарж үзүүлэлтүүдийг харна.':'Click a coloured map cell to inspect the observations.';
 const ok=ids.filter(i=>sc.classes[i]>=0);
 if(!ok.length)return mn?'Хүчинтэй өгөгдөлгүй':'No valid observations';
 const rows=Object.entries(fields).map(([k,names])=>{const v=ok.reduce((s,i)=>s+sc.factors[k][i],0)/ok.length;return `<dt>${names[mn?1:0]}</dt><dd>${v.toFixed(3)}</dd>`;}).join('');
 return `<p>${ok.length===1?labels[mn?'mn':'en'][sc.classes[ok[0]]]:`${ok.length} cells`} · ${esc(sc.acquired_utc)}</p><dl class="kv">${rows}</dl><p>${mn?'Цаг агаарын цаг':'Weather hour'}: ${esc(sc.weather_hour_utc)}</p>`;
}
function csv(sc){const names=Object.keys(fields),g=sc.grid;return ['lon,lat,class,relative_score,'+names.join(','),...sc.classes.flatMap((c,i)=>c<0?[]:[[g.lon[i%g.nx],g.lat[Math.floor(i/g.nx)],c,sc.score[i],...names.map(k=>sc.factors[k][i])].join(',')])].join('\n');}
root.TDFireMap={is,empty,validate,colors,labels,method,summary,legend,inspect,csv};
})(typeof window==='undefined'?globalThis:window);
