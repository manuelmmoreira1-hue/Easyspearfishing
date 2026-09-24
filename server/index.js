const http = require('http');
const https = require('https');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const TZ = 'Europe/Lisbon';
const VERSION = '3.1.2';

const spots = {
  'Foz do Douro': { lat: 41.148, lon: -8.675, exposure: 285, protection: 'aberta a W/NW', localProfile: 'estuário/foz', camera: { label: 'Beachcam Foz / Porto', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Castelo do Queijo': { lat: 41.169, lon: -8.689, exposure: 285, protection: 'aberta a W/NW', localProfile: 'costa rochosa', camera: { label: 'Beachcam Matosinhos', url: 'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/' } },
  'Matosinhos': { lat: 41.182, lon: -8.705, exposure: 290, protection: 'aberta a W/NW', localProfile: 'praia/porto', camera: { label: 'Beachcam Matosinhos', url: 'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/' } },
  'Leça da Palmeira': { lat: 41.190, lon: -8.704, exposure: 295, protection: 'aberta a W/NW', localProfile: 'molhe/costa exposta', camera: { label: 'Beachcam Leça da Palmeira', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira/' }, camera2: { label: 'Beachcam Leça panorâmica / Aterro', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira-panoraminca-aterro/' }, ipmaCamera: { label: 'IPMA Livecam Leça', url: 'https://www.ipma.pt/pt/maritima/costeira/index.jsp?idLocal=2&selLocal=2' } },
  'Marreco': { lat: 41.235, lon: -8.724, exposure: 300, protection: 'aberta a W/NW', localProfile: 'costa aberta', camera: { label: 'Beachcam Leça / Matosinhos', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Perafita': { lat: 41.225, lon: -8.716, exposure: 300, protection: 'aberta a W/NW', localProfile: 'costa aberta', camera: { label: 'Beachcam Leça da Palmeira', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira/' } },
  'Angeiras': { lat: 41.265, lon: -8.722, exposure: 300, protection: 'aberta a W/NW', localProfile: 'costa rochosa/praia', camera: { label: 'Beachcam Leça / Matosinhos', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Labruge': { lat: 41.280, lon: -8.716, exposure: 305, protection: 'aberta a W/NW', localProfile: 'costa aberta', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Mindelo': { lat: 41.316, lon: -8.724, exposure: 305, protection: 'aberta a W/NW', localProfile: 'costa rochosa/praia', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Azurara': { lat: 41.337, lon: -8.741, exposure: 300, protection: 'aberta a W/NW', localProfile: 'foz do Ave/estuário', camera: { label: 'Beachcam Caxinas', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Vila do Conde': { lat: 41.353, lon: -8.744, exposure: 300, protection: 'aberta a W/NW', localProfile: 'foz do Ave/urbana', camera: { label: 'Beachcam Caxinas', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Póvoa de Varzim': { lat: 41.381, lon: -8.765, exposure: 290, protection: 'aberta a W/NW', localProfile: 'costa aberta/porto', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } }
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*', 'Connection': 'close' });
  res.end(body);
}
function finite(x) { return Number.isFinite(Number(x)) ? Number(x) : null; }
function clamp(v,min=0,max=10){ return Math.max(min,Math.min(max,v)); }
function fmt(v,d=1){ return Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—'; }
function angleDiff(a,b){ return Math.abs(((a-b+540)%360)-180); }
function degToCompass(deg){ if(!Number.isFinite(Number(deg))) return '—'; const dirs=['N','NE','E','SE','S','SW','W','NW']; return dirs[Math.round(Number(deg)/45)%8]; }
function relativeEnergy(wave,period){ if(!Number.isFinite(wave)||!Number.isFinite(period))return null; return 0.49*wave*wave*period; }
function dayLabel(dateStr,todayStr){ if(dateStr===todayStr)return 'Hoje'; const d=new Date(`${dateStr}T12:00:00`); return new Intl.DateTimeFormat('pt-PT',{weekday:'short',day:'2-digit',month:'2-digit'}).format(d); }
function hhmmMinutes(iso){ const m=String(iso||'').match(/T(\d{2}):(\d{2})/); return m?Number(m[1])*60+Number(m[2]):null; }
function daylightForTime(time,daily){ const date=time.slice(0,10); const i=(daily.time||[]).indexOf(date); if(i<0)return false; const sr=hhmmMinutes(daily.sunrise?.[i]), ss=hhmmMinutes(daily.sunset?.[i]), t=hhmmMinutes(time); if(sr==null||ss==null||t==null)return false; return t>=sr+30&&t<=ss-30; }

function scoreComponent(name,score,weight,good,bad){ return {name,score:Number(score.toFixed(1)),weight,reason:score>=8?good:bad}; }
function baseSpearoScore({wave,period,wind,gust,energy,swellDirection,waveDirection,spot,current,waterTemp,visibilityScore}){
  const c=[]; const add=(n,s,w,g,b)=>{if(Number.isFinite(s))c.push(scoreComponent(n,clamp(s),w,g,b));};
  if(Number.isFinite(wave)) add('Onda',wave<=.55?8:wave<=.85?10:wave<=1.10?9:wave<=1.35?7.5:wave<=1.60?5.5:wave<=2?3:1,20,'altura favorável','altura aumenta a exigência');
  if(Number.isFinite(period)) add('Período',period<5?4:period<6.5?7:period<=10.5?10:period<=12?8:period<=14?6:4,8,'período moderado/favorável','período elevado pode trazer sets mais potentes');
  if(Number.isFinite(wind)) add('Vento',wind<=5?10:wind<=10?9:wind<=15?7:wind<=20?5:wind<=28?3:1,12,'vento fraco/moderado','vento aumenta a perturbação da superfície');
  if(Number.isFinite(gust)) add('Rajadas',gust<=10?10:gust<=18?9:gust<=25?7:gust<=32?5:2,8,'rajadas controladas','rajadas podem piorar a superfície');
  if(Number.isFinite(energy)) add('Energia',energy<=5?10:energy<=8?9:energy<=12?7:energy<=16?5:energy<=22?3:1,12,'energia relativa baixa/moderada','energia relativa elevada');
  const dir=Number.isFinite(swellDirection)?swellDirection:waveDirection; if(Number.isFinite(dir)&&spot){ const diff=angleDiff(dir,spot.exposure); add('Exposição ao swell',diff<=25?3.5:diff<=50?5.5:diff<=80?7.5:diff<=120?9:10,8,'swell chega mais oblíquo/protegido','swell mais alinhado com a exposição'); }
  if(Number.isFinite(current)) add('Corrente',current<=.15?10:current<=.30?8:current<=.50?6:current<=.80?4:2,5,'corrente modelada baixa','corrente modelada elevada');
  if(Number.isFinite(waterTemp)) add('Água',waterTemp>=15&&waterTemp<=19?10:waterTemp>=13&&waterTemp<15?8:waterTemp>19&&waterTemp<=21?8:6,3,'temperatura compatível com a época/equipamento','temperatura menos confortável');
  if(Number.isFinite(visibilityScore)) add('Visibilidade',visibilityScore,25,'estimativa de água relativamente limpa','suspensão/turbidez provável');
  if(!c.length)return null; const tw=c.reduce((a,x)=>a+x.weight,0); const score=Number((c.reduce((a,x)=>a+x.score*x.weight,0)/tw).toFixed(1)); const sorted=c.slice().sort((a,b)=>a.score-b.score); return {score,components:c,positives:sorted.filter(x=>x.score>=8.5).slice(-3).map(x=>x.name),negatives:sorted.filter(x=>x.score<7).slice(0,3).map(x=>x.name)};
}
function classify(s){ if(s==null)return ['🟡','Dados insuficientes','Dados insuficientes para classificar.']; if(s>=8.5)return ['🟢','Muito favorável','Condições modeladas favoráveis. Confirma o mar e a visibilidade no local.']; if(s>=7)return ['🟡','Razoável','Condições utilizáveis no modelo, mas confirma a visibilidade e as condições locais.']; if(s>=5)return ['🟠','Exigente','Há fatores que podem dificultar a pesca; avalia localmente antes de entrar.']; return ['🔴','Desfavorável','O modelo indica condições exigentes; não uses este indicador isoladamente.']; }
function fetchJson(url, timeoutMs=18000){
  return new Promise((resolve,reject)=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    fetch(url,{signal:controller.signal,headers:{'User-Agent':'Easyspearfishing/0.6','Accept':'application/json'}})
      .then(async res=>{
        if(!res.ok){
          let detail='';
          try{ detail=await res.text(); }catch(_){}
          throw new Error(`HTTP ${res.status}${detail?` — ${detail.slice(0,180)}`:''}`);
        }
        return res.json();
      })
      .then(resolve)
      .catch(err=>reject(err.name==='AbortError'?new Error('Timeout da fonte externa'):err))
      .finally(()=>clearTimeout(timer));
  });
}


// Visibility model: deliberately an estimate, not a measured underwater-visibility product.
// It follows the same general logic used by coastal-clarity models: recent wave stirring,
// wind/onshore exposure, rain/runoff proxy, and recovery time. Satellite turbidity can be
// added later when authenticated Copernicus Marine credentials are configured.
function estimateVisibilityAt(i,mh,wh,spot){
  const wave=finite(mh.wave_height?.[i]), period=finite(mh.wave_period?.[i]), wind=finite(wh.wind_speed_10m?.[i]);
  if(!Number.isFinite(wave)) return {meters:null,score:null,confidence:'baixa',label:'Sem estimativa confiável',trend:'—',factors:[]};
  let stirring=0; let exposure=0; let rain=0; let recovery=0;
  const lookbackStart=Math.max(0,i-72);
  for(let j=lookbackStart;j<i;j++){
    const w=finite(mh.wave_height?.[j]), p=finite(mh.wave_period?.[j]), wd=finite(mh.wave_direction?.[j]); const decay=Math.exp(-(i-j)/24);
    if(Number.isFinite(w)){ const e=relativeEnergy(w,p||8); stirring+=Math.min(2.8,e||0)*decay; if(Number.isFinite(wd)) exposure += Math.max(0,Math.cos(angleDiff(wd,spot.exposure)*Math.PI/180))*w*decay; }
    const ws=finite(wh.wind_speed_10m?.[j]); const dir=finite(wh.wind_direction_10m?.[j]);
    if(Number.isFinite(ws)&&Number.isFinite(dir)){ const on=Math.max(0,Math.cos(angleDiff(dir,spot.exposure)*Math.PI/180)); exposure += on*ws*0.035*decay; }
    const pr=finite(wh.precipitation?.[j]); if(Number.isFinite(pr)) rain+=Math.min(1,pr/5)*decay;
  }
  // Current sea state contribution: wave energy + wave height are the strongest local proxy.
  const currentEnergy=relativeEnergy(wave,period||8)||0;
  stirring += Math.min(4,currentEnergy*0.45);
  const dir=finite(mh.wave_direction?.[i]); if(Number.isFinite(dir)) exposure += Math.max(0,Math.cos(angleDiff(dir,spot.exposure)*Math.PI/180))*wave*1.2;
  if(Number.isFinite(wind)){ const wd=finite(wh.wind_direction_10m?.[i]); if(Number.isFinite(wd)) exposure += Math.max(0,Math.cos(angleDiff(wd,spot.exposure)*Math.PI/180))*wind*0.05; }
  const pressure=Math.min(10, stirring*0.9+exposure*0.9+rain*0.8);
  // Calibrated as a conservative coastal heuristic: clean days can reach ~5-6 m, heavy suspension <1.5 m.
  const meters=Math.max(0.6,Math.min(6.5,5.8*Math.exp(-pressure/8)));
  const score=clamp(10 - pressure*0.95,0.5,10);
  const prevPressure=[];
  for(let k=Math.max(0,i-12);k<i;k++){ const ww=finite(mh.wave_height?.[k]); const pp=finite(mh.wave_period?.[k]); if(Number.isFinite(ww)) prevPressure.push(relativeEnergy(ww,pp||8)||0); }
  const recent=prevPressure.length?prevPressure.reduce((a,b)=>a+b,0)/prevPressure.length:null;
  const prior=[];
  for(let k=Math.max(0,i-36);k>=Math.max(0,i-72);k--){ const ww=finite(mh.wave_height?.[k]); const pp=finite(mh.wave_period?.[k]); if(Number.isFinite(ww)) prior.push(relativeEnergy(ww,pp||8)||0); }
  const older=prior.length?prior.reduce((a,b)=>a+b,0)/prior.length:null;
  let trend='estável'; if(Number.isFinite(recent)&&Number.isFinite(older)){ if(recent<older*0.78)trend='a melhorar'; else if(recent>older*1.22)trend='a piorar'; }
  const hasHistory=i>=24; const confidence=hasHistory?'média':'baixa';
  const factors=[];
  if(stirring>7)factors.push('mar recente com bastante energia'); else if(stirring<3)factors.push('mar recente relativamente calmo');
  if(exposure>4)factors.push('exposição à ondulação/vento');
  if(rain>2)factors.push('chuva recente como proxy de escorrência');
  if(trend==='a melhorar')factors.push('energia do mar em recuperação');
  if(trend==='a piorar')factors.push('energia do mar a aumentar');
  const band=meters<1.5?'<1,5 m':meters<2.5?'1,5–2,5 m':meters<4?'2,5–4 m':meters<5?'4–5 m':'5+ m';
  const sigma=confidence==='média'?1.0:1.5;
  const erf=x=>{const sign=x<0?-1:1; x=Math.abs(x); const t=1/(1+0.3275911*x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429; const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x); return sign*y;};
  const cdf=x=>0.5*(1+erf(x/Math.sqrt(2)));
  const probability=(threshold)=>Math.round(Math.max(0,Math.min(100,(1-cdf((threshold-meters)/sigma))*100)));
  const probabilities={atLeast2m:probability(2),atLeast3m:probability(3),atLeast5m:probability(5)};
  return {meters,score,confidence,label:band,trend,factors,pressure:Number(pressure.toFixed(2)),probabilities,source:'modelo heurístico de suspensão; não é uma medição direta'};
}

function satelliteInfo(){
  return {status:'não ligado',note:'A observação Copernicus de turbidez/SPM é diária e de 100 m na zona costeira, mas o acesso programático requer conta/credenciais Copernicus Marine. A V7 deixa a integração preparada sem inventar valores.',product:'Copernicus Marine OCEANCOLOUR_IBI_BGC_HR_L3_NRT_009_204'};
}


const SPOT_LIST = Object.entries(spots).map(([name, s]) => ({name, ...s}));
const LATITUDES = SPOT_LIST.map(s => s.lat).join(',');
const LONGITUDES = SPOT_LIST.map(s => s.lon).join(',');
const CACHE_TTL_MS = 55 * 60 * 1000;
let forecastCache = null;
let forecastInFlight = null;

function batchUrl(base, params){
  const q = new URLSearchParams(params);
  return `${base}?${q.toString()}`;
}

async function fetchAllSources(){
  const marineBase='https://marine-api.open-meteo.com/v1/marine';
  const weatherBase='https://api.open-meteo.com/v1/forecast';
  const marineHourly='wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period';
  const weatherHourly='wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,precipitation,cloud_cover';

  // Always obtain one dependable Best Match forecast first. This is the safety net:
  // optional model comparisons must never make the whole application fail.
  const primaryCalls=[
    {kind:'marine',model:'best_match',label:'Marine Best Match',weight:1,url:batchUrl(marineBase,{latitude:LATITUDES,longitude:LONGITUDES,hourly:marineHourly,current:'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period',past_days:'3',forecast_days:'7',timezone:TZ,cell_selection:'sea'})},
    {kind:'weather',model:'best_match',label:'Weather Best Match',weight:1,url:batchUrl(weatherBase,{latitude:LATITUDES,longitude:LONGITUDES,hourly:weatherHourly,current:'wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility',daily:'sunrise,sunset,precipitation_probability_max',past_days:'3',forecast_days:'7',timezone:TZ})},
    {kind:'marineAux',model:'best_match',label:'Marine SST/Tide/Current',weight:1,url:batchUrl(marineBase,{latitude:LATITUDES,longitude:LONGITUDES,hourly:'sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction',current:'sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction',past_days:'3',forecast_days:'7',timezone:TZ,cell_selection:'sea'})},
    {kind:'ipma',model:'ipma',label:'IPMA',weight:1,url:'https://api.ipma.pt/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json'}
  ];
  const primary=await Promise.all(primaryCalls.map(c=>fetchJson(c.url,c.kind==='ipma'?8000:10000).then(value=>({ok:true,...c,value})).catch(error=>({ok:false,...c,error}))));
  const marinePrimary=primary.find(x=>x.kind==='marine'&&x.ok);
  const weatherPrimary=primary.find(x=>x.kind==='weather'&&x.ok);
  if(!marinePrimary || !weatherPrimary){
    const bad=primary.filter(x=>!x.ok).map(x=>`${x.label}: ${x.error?.message||'erro'}`).join('; ');
    const err=new Error(`Fontes principais indisponíveis — ${bad}`); err.statusCode=502; throw err;
  }

  // Optional model comparison. It is deliberately non-blocking for reliability:
  // if a provider/model is slow or temporarily unavailable, Best Match still serves the site.
  const optional=[
    ['marine','dwd_ewam','DWD EWAM',0.45,4,marineBase,marineHourly],
    ['marine','ecmwf_wam','ECMWF WAM',0.35,7,marineBase,marineHourly],
    ['marine','meteofrance_wave','Météo-France MFWAM',0.20,7,marineBase,marineHourly],
    ['weather','icon_eu','DWD ICON-EU',0.60,5,weatherBase,weatherHourly],
    ['weather','ecmwf_ifs','ECMWF IFS HRES',0.40,7,weatherBase,weatherHourly]
  ];
  const optionalResults=await Promise.all(optional.map(([kind,model,label,weight,days,base,hourly])=>{
    const params={latitude:LATITUDES,longitude:LONGITUDES,hourly,past_days:'3',forecast_days:String(days),timezone:TZ,models:model};
    if(kind==='marine') params.cell_selection='sea';
    else { params.current='wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility'; params.daily='sunrise,sunset,precipitation_probability_max'; }
    return fetchJson(batchUrl(base,params),6000).then(value=>({ok:true,kind,model,label,weight,value})).catch(error=>({ok:false,kind,model,label,weight,error}));
  }));

  const marine=[marinePrimary];
  const weather=[weatherPrimary];
  for(const r of optionalResults){
    if(r.ok){
      if(r.kind==='marine') marine.push(r); else weather.push(r);
    }
  }
  const marineAux=primary.find(x=>x.kind==='marineAux'&&x.ok)?.value||null;
  const ipma=primary.find(x=>x.kind==='ipma'&&x.ok)?.value||null;
  return {
    marine,weather,marineAux,ipma,
    sourceStatus:[...primary,...optionalResults].map(x=>({label:x.label,kind:x.kind,model:x.model,ok:x.ok,error:x.ok?null:x.error?.message||'erro'}))
  };
}

function asLocationArray(value){ return Array.isArray(value)?value:[value]; }
function payloadArray(value){ return Array.isArray(value)?value:[value]; }
function findPayloadForSpot(value,spot,index){
  const arr=payloadArray(value);
  return arr.find(x=>Math.abs(Number(x.latitude)-spot.lat)<0.03 && Math.abs(Number(x.longitude)-spot.lon)<0.03) || arr[index] || null;
}
function nearestIndex(times,target,windowMinutes=90){
  if(!Array.isArray(times)||!times.length)return -1;
  const t=Date.parse(target); let best=-1,delta=Infinity;
  for(let i=0;i<times.length;i++){
    const d=Math.abs(Date.parse(times[i])-t); if(d<delta){delta=d;best=i;}
  }
  return delta<=windowMinutes*60000?best:-1;
}
function atTime(hourly,time,field){
  const idx=nearestIndex(hourly?.time,time,90); return idx<0?null:finite(hourly?.[field]?.[idx]);
}
function circularMeanWeighted(values){
  const ok=values.filter(x=>Number.isFinite(x.v)); if(!ok.length)return null;
  let sx=0,sy=0,sw=0; for(const x of ok){const r=x.v*Math.PI/180;sx+=Math.cos(r)*x.w;sy+=Math.sin(r)*x.w;sw+=x.w;}
  let d=Math.atan2(sy/sw,sx/sw)*180/Math.PI; if(d<0)d+=360; return d;
}
function weightedMean(values){
  const ok=values.filter(x=>Number.isFinite(x.v)); if(!ok.length)return null; const sw=ok.reduce((a,x)=>a+x.w,0); return ok.reduce((a,x)=>a+x.v*x.w,0)/sw;
}
function spread(values){ const a=values.filter(Number.isFinite); return a.length>=2?Math.max(...a)-Math.min(...a):0; }
function blendAt(modelPayloads, time, field){
  const vals=modelPayloads.map(m=>({v:atTime(m.payload.hourly,time,field),w:m.weight})).filter(x=>Number.isFinite(x.v));
  return {value:weightedMean(vals),spread:spread(vals.map(x=>x.v)),count:vals.length};
}
function blendDirAt(modelPayloads,time,field){
  const vals=modelPayloads.map(m=>({v:atTime(m.payload.hourly,time,field),w:m.weight}));
  return {value:circularMeanWeighted(vals),spread:directionSpread(vals.map(x=>x.v).filter(Number.isFinite)),count:vals.filter(x=>Number.isFinite(x.v)).length};
}
function directionSpread(values){
  if(values.length<2)return 0; let max=0; for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)max=Math.max(max,angleDiff(values[i],values[j])); return max;
}
function modelAtCurrent(modelPayloads,field){
  const vals=modelPayloads.map(m=>({v:finite(m.payload.current?.[field]),w:m.weight})); return weightedMean(vals);
}

function buildBlendedWeather(modelPayloads, primary){
  const times=primary?.hourly?.time||[]; const hourly=[];
  for(const time of times){
    const wind=blendAt(modelPayloads,time,'wind_speed_10m'), gust=blendAt(modelPayloads,time,'wind_gusts_10m');
    const dir=blendDirAt(modelPayloads,time,'wind_direction_10m');
    hourly.push({time,wind:wind.value,windDirection:dir.value,gust:gust.value,visibility:atTime(primary.hourly,time,'visibility'),precipitationProbability:atTime(primary.hourly,time,'precipitation_probability'),precipitation:atTime(primary.hourly,time,'precipitation'),cloudCover:atTime(primary.hourly,time,'cloud_cover'),modelSpread:{wind:wind.spread,gust:gust.spread,windDirection:dir.spread}});
  }
  return {hourly,daily:primary.daily||{},current:{time:primary.current?.time,wind:modelAtCurrent(modelPayloads,'wind_speed_10m'),windDirection:modelAtCurrent(modelPayloads,'wind_direction_10m'),gust:modelAtCurrent(modelPayloads,'wind_gusts_10m'),visibility:finite(primary.current?.visibility)}};
}

function buildBlendedMarine(modelPayloads, primary){
  const times=primary?.hourly?.time||[]; const hourly=[];
  for(const time of times){
    const wave=blendAt(modelPayloads,time,'wave_height'), period=blendAt(modelPayloads,time,'wave_period'), peak=blendAt(modelPayloads,time,'wave_peak_period');
    const swell=blendAt(modelPayloads,time,'swell_wave_height'), swellPeriod=blendAt(modelPayloads,time,'swell_wave_period');
    const dir=blendDirAt(modelPayloads,time,'wave_direction'), swellDir=blendDirAt(modelPayloads,time,'swell_wave_direction');
    hourly.push({time,wave:wave.value,waveDirection:dir.value,period:period.value,peakPeriod:peak.value,swell:swell.value,swellDirection:swellDir.value,swellPeriod:swellPeriod.value,modelSpread:{wave:wave.spread,period:period.spread,waveDirection:dir.spread,swell:swell.spread,swellDirection:swellDir.spread},modelCount:Math.min(wave.count,period.count)});
  }
  return {hourly,current:{time:primary.current?.time,wave:modelAtCurrent(modelPayloads,'wave_height'),waveDirection:circularMeanWeighted(modelPayloads.map(m=>({v:finite(m.payload.current?.wave_direction),w:m.weight}))),period:modelAtCurrent(modelPayloads,'wave_period'),swell:modelAtCurrent(modelPayloads,'swell_wave_height'),swellDirection:circularMeanWeighted(modelPayloads.map(m=>({v:finite(m.payload.current?.swell_wave_direction),w:m.weight}))),swellPeriod:modelAtCurrent(modelPayloads,'swell_wave_period')}};
}

async function getAllForecast(){
  const now=Date.now();
  if(forecastCache && now-forecastCache.time<CACHE_TTL_MS) return forecastCache.data;
  if(forecastInFlight) return forecastInFlight;
  forecastInFlight=(async()=>{
    const src=await fetchAllSources();
    const marineModelsBySpot=SPOT_LIST.map((spot,i)=>src.marine.map(m=>({label:m.label,model:m.model,weight:m.weight,payload:findPayloadForSpot(m.value,spot,i)})).filter(x=>x.payload));
    const weatherModelsBySpot=SPOT_LIST.map((spot,i)=>src.weather.map(m=>({label:m.label,model:m.model,weight:m.weight,payload:findPayloadForSpot(m.value,spot,i)})).filter(x=>x.payload));
    const spotsOut=SPOT_LIST.map((spot,i)=>{
      const mm=marineModelsBySpot[i], ww=weatherModelsBySpot[i];
      const primaryMarine=mm.find(x=>x.model==='best_match')||mm.find(x=>x.model==='dwd_ewam')||mm[0]; const primaryWeather=ww.find(x=>x.model==='best_match')||ww.find(x=>x.model==='icon_eu')||ww[0];
      const marine=buildBlendedMarine(mm,primaryMarine.payload); const weather=buildBlendedWeather(ww,primaryWeather.payload);
      const aux=findPayloadForSpot(src.marineAux,spot,i);
      return buildSpotDataFromBlended(spot.name,spot,marine,weather,src.ipma,mm,ww,aux);
    });
    const data={version:VERSION,updatedAt:new Date().toISOString(),count:spotsOut.length,modelMix:{marine:[['DWD EWAM',0.45],['ECMWF WAM',0.35],['Météo-France MFWAM',0.20]],weather:[['DWD ICON-EU',0.60],['ECMWF IFS',0.40]]},sourceStatus:src.sourceStatus,spots:spotsOut};
    forecastCache={time:Date.now(),data}; return data;
  })().finally(()=>{forecastInFlight=null;});
  return forecastInFlight;
}

function buildSpotDataFromBlended(name,s,m,w,ip,marineModels,weatherModels,auxMarine){
  const mh=Array.isArray(m.hourly)?m.hourly:[];
  const wh=Array.isArray(w.hourly)?w.hourly:[];
  const n=Math.min(mh.length,wh.length);
  const hourly=[];
  const auxTimes=auxMarine?.hourly?.time||[];
  for(let i=0;i<n;i++){
    const time=mh[i]?.time;
    const wave=finite(mh[i]?.wave), period=finite(mh[i]?.period), wind=finite(wh[i]?.wind), gust=finite(wh[i]?.gust), energy=relativeEnergy(wave,period);
    const pseudoMarine={wave_height:mh.map(x=>x.wave),wave_period:mh.map(x=>x.period),wave_direction:mh.map(x=>x.waveDirection)};
    const pseudoWeather={wind_speed_10m:wh.map(x=>x.wind),wind_direction_10m:wh.map(x=>x.windDirection),precipitation:wh.map(x=>x.precipitation)};
    const vis=estimateVisibilityAt(i,pseudoMarine,pseudoWeather,s);
    const ss=baseSpearoScore({wave,period,wind,gust,energy,swellDirection:finite(mh[i]?.swellDirection),waveDirection:finite(mh[i]?.waveDirection),spot:s,current:null,waterTemp:null,visibilityScore:vis.score});
    const auxIdx=nearestIndex(auxTimes,time,90);
    hourly.push({
      time,wave,waveDirection:finite(mh[i]?.waveDirection),period,peakPeriod:finite(mh[i]?.peakPeriod),
      swell:finite(mh[i]?.swell),swellDirection:finite(mh[i]?.swellDirection),swellPeriod:finite(mh[i]?.swellPeriod),
      wind,windDirection:finite(wh[i]?.windDirection),gust,atmosphericVisibility:finite(wh[i]?.visibility),
      precipitationProbability:finite(wh[i]?.precipitationProbability),precipitation:finite(wh[i]?.precipitation),cloudCover:finite(wh[i]?.cloudCover),
      waterTemp:auxIdx>=0?finite(auxMarine?.hourly?.sea_surface_temperature?.[auxIdx]):null,
      tideLevel:auxIdx>=0?finite(auxMarine?.hourly?.sea_level_height_msl?.[auxIdx]):null,
      current:auxIdx>=0?finite(auxMarine?.hourly?.ocean_current_velocity?.[auxIdx]):null,
      currentDirection:auxIdx>=0?finite(auxMarine?.hourly?.ocean_current_direction?.[auxIdx]):null,
      energy,visibility:vis,score:ss?.score??null,daylight:daylightForTime(time,w.daily||{}),
      modelSpread:{...(mh[i]?.modelSpread||{}),...(wh[i]?.modelSpread||{})}
    });
  }
  const currentTime=m.current?.time||hourly[0]?.time;
  const currentH=hourly.find(h=>h.time===currentTime)||hourly[0]||null;
  const auxCurrentIdx=nearestIndex(auxTimes,currentTime,90);
  const current={
    wave:finite(currentH?.wave), waveDirection:finite(currentH?.waveDirection), period:finite(currentH?.period),
    swell:finite(currentH?.swell),swellDirection:finite(currentH?.swellDirection),swellPeriod:finite(currentH?.swellPeriod),
    waterTemp:auxCurrentIdx>=0?finite(auxMarine?.hourly?.sea_surface_temperature?.[auxCurrentIdx]):null,
    tideLevel:auxCurrentIdx>=0?finite(auxMarine?.hourly?.sea_level_height_msl?.[auxCurrentIdx]):null,
    current:auxCurrentIdx>=0?finite(auxMarine?.hourly?.ocean_current_velocity?.[auxCurrentIdx]):null,
    currentDirection:auxCurrentIdx>=0?finite(auxMarine?.hourly?.ocean_current_direction?.[auxCurrentIdx]):null,
    wind:finite(currentH?.wind),windDirection:finite(currentH?.windDirection),gust:finite(currentH?.gust),atmosphericVisibility:finite(currentH?.visibility)
  };
  const currentVis=currentH?.visibility||null;
  const energy=relativeEnergy(current.wave,current.period);
  const scoreData=baseSpearoScore({...current,energy,spot:s,visibilityScore:currentVis?.score});
  const [statusEmoji,status,statusText]=classify(scoreData?.score??null);
  const today=(w.daily?.time||[])[0]||(hourly[0]?.time||'').slice(0,10);
  const future=hourly.filter(h=>h.time&&new Date(h.time)>=new Date()&&h.score!=null);
  const daylightFuture=future.filter(h=>h.daylight);
  const best=daylightFuture.slice().sort((a,b)=>b.score-a.score)[0]||null;
  const bestDayDate=best?.time?.slice(0,10)||null;
  const bestDayLabel=bestDayDate?dayLabel(bestDayDate,today):null;
  const bestWindow=best?`${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10`:'Não calculada';
  let window=null;
  if(best){
    const idx=hourly.findIndex(h=>h.time===best.time);
    const candidate=hourly.slice(Math.max(0,idx-1),idx+2).filter(h=>h.daylight&&h.score!=null);
    if(candidate.length>=2) window={start:candidate[0].time.slice(11,16),end:candidate[candidate.length-1].time.slice(11,16),score:Number((candidate.reduce((a,h)=>a+h.score,0)/candidate.length).toFixed(1))};
  }
  let ipmaRef=null,modelAgreement='Não disponível';
  const expectedMarine=3, expectedWeather=2;
  if(ip){
    const rows=Array.isArray(ip)?ip:(ip.data||[]),ref=rows.find(x=>Number(x.globalIdLocal)===1130826);
    if(ref){
      ipmaRef={waveMin:finite(ref.totalSeaMin),waveMax:finite(ref.totalSeaMax),periodMin:finite(ref.wavePeriodMin),periodMax:finite(ref.wavePeriodMax),direction:ref.predWaveDir,sstMin:finite(ref.sstMin),sstMax:finite(ref.sstMax),update:ip.dataUpdate};
      const waveOk=Number.isFinite(current.wave)&&current.wave>=ipmaRef.waveMin-.25&&current.wave<=ipmaRef.waveMax+.25;
      const periodOk=Number.isFinite(current.period)&&current.period>=ipmaRef.periodMin-1&&current.period<=ipmaRef.periodMax+1;
      modelAgreement=waveOk&&periodOk?'Boa concordância':'Concordância parcial';
    }
  }
  const modelSpread={
    wave:spread(marineModels.map(x=>atTime(x.payload?.hourly,currentH?.time||currentTime,'wave_height'))),
    wind:spread(weatherModels.map(x=>atTime(x.payload?.hourly,currentH?.time||currentTime,'wind_speed_10m'))),
    waveDirection:directionSpread(marineModels.map(x=>atTime(x.payload?.hourly,currentH?.time||currentTime,'wave_direction')).filter(Number.isFinite))
  };
  const waveSpread=Number.isFinite(modelSpread.wave)?modelSpread.wave:null;
  const windSpread=Number.isFinite(modelSpread.wind)?modelSpread.wind:null;
  let agreementConfidence='baixa';
  if(marineModels.length>=2 && weatherModels.length>=2 && Number.isFinite(waveSpread) && Number.isFinite(windSpread)){
    if(waveSpread<=0.20 && windSpread<=2.5) agreementConfidence='alta';
    else if(waveSpread<=0.40 && windSpread<=5) agreementConfidence='média';
  }
  if(modelAgreement==='Não disponível' && agreementConfidence!=='baixa') modelAgreement=agreementConfidence==='alta'?'Boa concordância entre modelos':'Concordância moderada entre modelos';
  const daily=(w.daily?.time||[]).filter(date=>date>=today).slice(0,7).map(date=>{
    const rows=hourly.filter(h=>h.time?.startsWith(date)&&h.score!=null&&h.daylight);
    if(!rows.length)return {date,label:dayLabel(date,today),bestScore:null,bestTime:null,minWave:null,maxWave:null,minWind:null,maxWind:null,minVisibility:null,maxVisibility:null,trend:null};
    const bd=rows.slice().sort((a,b)=>b.score-a.score)[0],vv=rows.map(r=>r.visibility?.meters).filter(Number.isFinite);
    const waves=rows.map(r=>r.wave).filter(Number.isFinite),winds=rows.map(r=>r.wind).filter(Number.isFinite);
    return {date,label:dayLabel(date,today),bestScore:bd.score,bestTime:bd.time.slice(11,16),minWave:waves.length?Math.min(...waves):null,maxWave:waves.length?Math.max(...waves):null,minWind:winds.length?Math.min(...winds):null,maxWind:winds.length?Math.max(...winds):null,minVisibility:vv.length?Math.min(...vv):null,maxVisibility:vv.length?Math.max(...vv):null,trend:bd.visibility?.trend||null};
  });
  const cameraLinks=[s.camera,s.camera2,s.ipmaCamera].filter(Boolean);
  const satellite=satelliteInfo();
  return {
    version:VERSION,name,lat:s.lat,lon:s.lon,exposure:s.exposure,exposureText:s.protection,localProfile:s.localProfile,
    score:scoreData?.score??null,scoreVersion:'Spearo Score 6.0 — multi-model + exposição local + confiança',scoreComponents:scoreData?.components||[],scoreReasons:scoreData?{positives:scoreData.positives,negatives:scoreData.negatives}:{positives:[],negatives:[]},
    status,statusEmoji,statusText,decision:scoreData?.score>=8.5?'SIM':scoreData?.score>=7?'TALVEZ':scoreData?.score>=5?'EXIGENTE':'NÃO',
    wave:current.wave!=null?`${fmt(current.wave)} m`:'—',period:current.period!=null?`${fmt(current.period)} s`:'—',direction:degToCompass(current.waveDirection),waterTemp:current.waterTemp!=null?`${fmt(current.waterTemp)} °C`:'—',
    wind:current.wind!=null?`${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}`:'—',gust:current.gust!=null?`${fmt(current.gust)} km/h`:'—',energy:energy!=null?`~${fmt(energy)} (indicador relativo)`:'—',
    atmosphericVisibility:current.atmosphericVisibility!=null?`${fmt(current.atmosphericVisibility/1000)} km`:'Não disponível',underwaterVisibility:currentVis?`${currentVis.label} provável`:'Não disponível',visibility:currentVis,
    swell:current.swell!=null?`${fmt(current.swell)} m`:'—',swellDirection:degToCompass(current.swellDirection),swellPeriod:current.swellPeriod!=null?`${fmt(current.swellPeriod)} s`:'—',
    tideLevel:current.tideLevel!=null?`${fmt(current.tideLevel,2)} m MSL*`:'—',currentSpeed:current.current!=null?`${fmt(current.current)} km/h`:'—',currentDirection:degToCompass(current.currentDirection),
    bestWindow,bestWindowShort:best?`${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10`:'—',bestWindowTime:best?.time||'',window,
    hourly,daily,modelCount:{marine:marineModels.length,weather:weatherModels.length},modelSpread,modelAgreement,ipmaReference:ipmaRef,cameraLinks,satellite,
    sourceStatus:{marine:marineModels.map(x=>x.label),weather:weatherModels.map(x=>x.label)},
    note:'Previsão multi-modelo com exposição local do spot. A altura de onda continua limitada pela resolução dos modelos; a visibilidade subaquática é uma estimativa heurística e não uma medição direta.'
  };
}

async function getSpotData(reqUrl){
  const name=reqUrl.searchParams.get('name')||'Spot';
  const meta=spots[name];
  if(!meta) throw Object.assign(new Error('Spot não encontrado'),{statusCode:404});
  const all=await getAllForecast();
  const found=all.spots.find(x=>x.name===name);
  if(!found) throw Object.assign(new Error('Dados do spot indisponíveis'),{statusCode:502});
  return found;
}


const DATA_DIR = path.join(__dirname, '../data');
const OBS_FILE = path.join(DATA_DIR, 'observations.json');
const VIS_LEVELS = ['Muito boa','Boa','Média','Fraca','Muito fraca'];
const WATER_STATES = ['Limpa','Ligeiramente turva','Turva','Muito turva'];
function loadObservations(){try{fs.mkdirSync(DATA_DIR,{recursive:true});if(fs.existsSync(OBS_FILE)){const v=JSON.parse(fs.readFileSync(OBS_FILE,'utf8'));return Array.isArray(v)?v:[];}}catch(e){console.error('[OBS LOAD]',e.message)}return[]}
let observations=loadObservations();
function saveObservations(){try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(OBS_FILE,JSON.stringify(observations.slice(-1000),null,2))}catch(e){console.error('[OBS SAVE]',e.message)}}
function recentObservations(spot){const cutoff=Date.now()-7*86400000;return observations.filter(o=>o.spot===spot&&Date.parse(o.createdAt)>=cutoff).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,20)}
function observationSummary(spot){const rows=recentObservations(spot),ranks={'Muito boa':5,'Boa':4,'Média':3,'Fraca':2,'Muito fraca':1};if(!rows.length)return{count:0,last:null,averageLabel:null,distribution:Object.fromEntries(VIS_LEVELS.map(x=>[x,0]))};const avg=rows.reduce((s,o)=>s+(ranks[o.visibilityLabel]||0),0)/rows.length;const averageLabel=avg>=4.5?'Muito boa':avg>=3.5?'Boa':avg>=2.5?'Média':avg>=1.5?'Fraca':'Muito fraca';return{count:rows.length,last:rows[0],averageLabel,distribution:Object.fromEntries(VIS_LEVELS.map(x=>[x,rows.filter(o=>o.visibilityLabel===x).length]))}}
function readObservationBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>20000)req.destroy()});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch(e){reject(new Error('JSON inválido'))}});req.on('error',reject)})}

function serveStatic(res,pathname){const clean=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');const filePath=path.resolve(PUBLIC_DIR,clean);if(!filePath.startsWith(path.resolve(PUBLIC_DIR)))return json(res,403,{error:'Acesso negado'});if(!fs.existsSync(filePath)||!fs.statSync(filePath).isFile())return json(res,404,{error:'Ficheiro não encontrado'});const ext=path.extname(filePath);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(filePath).pipe(res);}

const server=http.createServer(async (req,res)=>{
  const started=Date.now();
  res.setHeader('X-Easyspearfishing-Version', VERSION);
  try {
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    console.log(`[REQ] ${req.method} ${u.pathname}`);
    if(req.method==='GET' && u.pathname==='/api/health') return json(res,200,{ok:true,service:'Easyspearfishing',version:VERSION,time:new Date().toISOString(),cached:Boolean(forecastCache)});
    if(req.method==='GET' && u.pathname==='/api/ping') return json(res,200,{ok:true,pong:true,version:VERSION});
    if(req.method==='GET' && u.pathname==='/api/test-sources'){
      const lat='41.235,41.182', lon='-8.724,-8.705';
      const marineUrl=batchUrl('https://marine-api.open-meteo.com/v1/marine',{latitude:lat,longitude:lon,hourly:'wave_height',forecast_days:'1',timezone:TZ,cell_selection:'sea'});
      const weatherUrl=batchUrl('https://api.open-meteo.com/v1/forecast',{latitude:lat,longitude:lon,hourly:'wind_speed_10m',forecast_days:'1',timezone:TZ});
      const results=await Promise.allSettled([fetchJson(marineUrl,10000),fetchJson(weatherUrl,10000)]);
      return json(res,200,{ok:true,marine:results[0].status==='fulfilled'?{ok:true,locations:asLocationArray(results[0].value).length}:{ok:false,error:results[0].reason?.message},weather:results[1].status==='fulfilled'?{ok:true,locations:asLocationArray(results[1].value).length}:{ok:false,error:results[1].reason?.message},version:VERSION});
    }
    if(req.method==='GET' && u.pathname==='/api/forecast'){
      const data=await getAllForecast();
      return json(res,200,data);
    }
    if(req.method==='GET' && u.pathname==='/api/spot'){
      const data=await getSpotData(u);
      return json(res,200,data);
    }
    if(req.method==='GET' && u.pathname==='/api/observations'){
      const spotName=u.searchParams.get('spot');
      if(!spots[spotName]) return json(res,400,{error:'Spot inválido'});
      return json(res,200,{spot:spotName,observations:recentObservations(spotName),summary:observationSummary(spotName)});
    }
    if(req.method==='POST' && u.pathname==='/api/observations'){
      const body=await readObservationBody(req),spotName=String(body.spot||'');
      if(!spots[spotName]) return json(res,400,{error:'Spot inválido'});
      if(!VIS_LEVELS.includes(body.visibilityLabel)) return json(res,400,{error:'Escolhe um nível de visibilidade.'});
      let meters=null;
      if(body.meters!==undefined&&body.meters!==null&&String(body.meters).trim()!==''){meters=Number(body.meters);if(!Number.isFinite(meters)||meters<0||meters>30)return json(res,400,{error:'Visibilidade em metros inválida.'});meters=Number(meters.toFixed(1));}
      const waterState=WATER_STATES.includes(body.waterState)?body.waterState:null;
      const note=String(body.note||'').trim().slice(0,240);
      const observation={id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,spot:spotName,visibilityLabel:body.visibilityLabel,meters,waterState,note,createdAt:new Date().toISOString()};
      observations.push(observation);saveObservations();return json(res,201,{ok:true,observation,summary:observationSummary(spotName)});
    }
    if(req.method==='GET') return serveStatic(res,u.pathname);
    return json(res,405,{error:'Método não permitido'});
  } catch(e) {
    console.error('[REQUEST ERROR]',e);
    if(!res.headersSent) return json(res,e.statusCode||502,{error:e.message||'Erro interno',version:VERSION});
  } finally {
    console.log(`[REQ DONE] ${req.method} ${req.url} ${Date.now()-started}ms`);
  }
});
server.keepAliveTimeout=5000;
server.headersTimeout=10000;
server.requestTimeout=30000;
server.on('error',e=>console.error('[SERVER ERROR]',e));
server.listen(PORT,'0.0.0.0',()=>console.log(`Easyspearfishing FINAL ${VERSION} on 0.0.0.0:${PORT}`));
