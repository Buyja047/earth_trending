/* One registry for risk types: add a data adapter here when a type is ready. */
(function(root){
'use strict';
const types={
 dust:{id:'dust-risk',adapter:root.TDDustMap,name:['Yellow dust storm','Шар шороон шуурга'],min:'2000-02-24',source:'MODIS'},
 fire:{id:'fire-risk',adapter:root.TDFireMap,name:['Fire risk zones','Түймрийн эрсдэлийн бүсүүд'],min:'2013-03-18',source:'Earth Engine'},
 flood:{id:'flood-risk',name:['Flood risk zones · coming soon','Үерийн эрсдэлийн бүсүүд · Тун удахгүй'],disabled:true}
};
const type=sc=>Object.keys(types).find(k=>types[k].adapter?.is(sc));
const adapter=sc=>types[type(sc)]?.adapter;
const is=sc=>!!adapter(sc);
const result={types,type,adapter,is,validate:sc=>adapter(sc).validate(sc),
 colors:sc=>adapter(sc).colors,labels:(sc,mn)=>adapter(sc).labels[mn?'mn':'en'],
 method:(sc,mn)=>adapter(sc).method(mn),title:(sc,mn)=>types[type(sc)].name[mn?1:0]};
for(const key of ['summary','legend','inspect','csv'])result[key]=(sc,...args)=>adapter(sc)[key](sc,...args);
root.TDRiskMaps=result;
})(typeof window==='undefined'?globalThis:window);
