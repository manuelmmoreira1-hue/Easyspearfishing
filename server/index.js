const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '2.2-7dias-memoria';

app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  next();
});

const PUBLIC_DIR = path.join(__dirname,'../public');
const DATA_DIR = path.join(__dirname,'../data');
const OBS_FILE = path.join(DATA_DIR,'observations.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(OBS_FILE)) fs.writeFileSync(OBS_FILE,'[]','utf8');

const SPOTS = {
  'Foz do Douro':[41.148,-8.675],
  'Castelo do Queijo':[41.169,-8.689],
  'Matosinhos':[41.182,-8.705],
  'Leça da Palmeira':[41.190,-8.704],
  'Marreco':[41.235,-8.724],
  'Perafita':[41.225,-8.716],
  'Angeiras':[41.265,-8.722],
  'Labruge':[41.280,-8.716],
  'Mindelo':[41.316,-8.724],
  'Azurara':[41.337,-8.741],
  'Vila do Conde':[41.353,-8.744],
  'Póvoa de Varzim':[41.381,-8.765]
};

function finite(v){ return Number.isFinite(Number(v)); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function fmt(v,d=1){ return finite(v)?Number(v).toFixed(d):'—'; }
function compass(v){
  if(!finite(v)) return '—';
  const dirs=['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(Number(v)/45)%8];
}
function energy(wave,period){
  if(!finite(wave)||!finite(period)) return null;
  // Relative UI indicator; not a physical measurement.
  return 0.49*Number(wave)*Number(wave)*Number(period);
}
function modelScore(wave,period,wind,gust){
  if(![wave,period,wind,gust].every(finite)) return null;
  let s=10;
  if(wave>0.7) s-=Math.min(4,(wave-0.7)*3);
  if(wave>1.5) s-=1.5;
  if(wave>2) s-=2;
  if(period<5) s-=0.5;
  if(period>12) s-=0.3;
  if(wind>8) s-=Math.min(2.5,(wind-8)*0.18);
  if(gust>18) s-=Math.min(1.5,(gust-18)*0.12);
  if(gust>28) s-=1;
  const e=energy(wave,period);
  if(finite(e)&&e>15) s-=Math.min(2,(e-15)*0.10);
  if(finite(e)&&e>25) s-=1.5;
  return Math.max(0,Math.min(10,Number(s.toFixed(1))));
}
function classify(s){
  if(s==null) return ['⚪','Sem classificação'];
  if(s>=8.5) return ['🟢','Condições favoráveis'];
  if(s>=7) return ['🟡','Condições razoáveis'];
  if(s>=5) return ['🟠','Exige atenção'];
  return ['🔴','Mar exigente'];
}
async function fetchJson(url){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'Easyspearfishing/2.0'}});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{ clearTimeout(t); }
}

let cache={at:0,data:null};
const CACHE_MS=5*60*1000;

async function getAllSpots(force=false){
  if(!force && cache.data && Date.now()-cache.at<CACHE_MS) return cache.data;

  const names=Object.keys(SPOTS);
  const lats=names.map(n=>SPOTS[n][0]).join(',');
  const lons=names.map(n=>SPOTS[n][1]).join(',');

  const marineUrl=`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&past_days=2&forecast_days=8&timezone=Europe%2FLisbon&cell_selection=sea`;
  const weatherUrl=`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,precipitation,rain,cloud_cover&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation&past_days=2&forecast_days=8&timezone=Europe%2FLisbon`;

  const [mr,wr]=await Promise.all([fetchJson(marineUrl),fetchJson(weatherUrl)]);
  const ma=Array.isArray(mr)?mr:[mr], wa=Array.isArray(wr)?wr:[wr];

  const spots=names.map((name,i)=>buildSpot(name,ma[i]||{},wa[i]||{}));
  cache={at:Date.now(),data:{updatedAt:new Date().toISOString(),version:VERSION,spots}};
  return cache.data;
}


// Estimated underwater visibility model. This is a derived indicator, not a measured forecast.
// It combines sea state, swell period/direction, wind direction/speed, recent wave trend,
// recent precipitation, current, tide range and local exposure. Recent community observations
// are used as a calibration signal, never as a replacement for the physical-condition model.
const SPOT_VIS_PROFILE = {
  'Foz do Douro': {exposure:1.00}, 'Castelo do Queijo': {exposure:0.95},
  'Matosinhos': {exposure:0.92}, 'Leça da Palmeira': {exposure:0.95},
  'Marreco': {exposure:0.88}, 'Perafita': {exposure:0.90},
  'Angeiras': {exposure:0.88}, 'Labruge': {exposure:0.92},
  'Mindelo': {exposure:0.78}, 'Azurara': {exposure:0.82},
  'Vila do Conde': {exposure:0.84}, 'Póvoa de Varzim': {exposure:0.88}
};
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function angleDiff(a,b){
  if(!finite(a)||!finite(b)) return 180;
  const d=Math.abs(((Number(a)-Number(b)+180)%360)-180); return d;
}
function visibilityDirectionFactor(deg){
  if(!finite(deg)) return 0;
  // For this north Portuguese coast, easterly/SE flow is generally cleaner/offshore;
  // W/SW/NW tends to push more energy toward the coast. N/NE is intermediate.
  const d=Number(deg);
  if(d>=70&&d<=150) return 1.0;
  if(d>=20&&d<70) return 0.45;
  if(d>150&&d<=220) return -0.15;
  if(d>220&&d<=320) return -1.0;
  return -0.35;
}
function meanLast(arr, times, hours, nowMs=Date.now()){
  if(!Array.isArray(arr)||!Array.isArray(times)) return null;
  const vals=[];
  for(let i=0;i<arr.length;i++){
    const t=Date.parse(times[i]); if(!Number.isFinite(t)||nowMs-t>hours*3600e3||nowMs-t<0) continue;
    const v=Number(arr[i]); if(Number.isFinite(v)) vals.push(v);
  }
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function rangeLast(arr,times,hours){
  if(!Array.isArray(arr)||!Array.isArray(times)) return null;
  const vals=[]; const now=Date.now();
  for(let i=0;i<arr.length;i++){
    const t=Date.parse(times[i]); if(!Number.isFinite(t)||now-t>hours*3600e3||now-t<0) continue;
    const v=Number(arr[i]); if(Number.isFinite(v)) vals.push(v);
  }
  return vals.length?Math.max(...vals)-Math.min(...vals):null;
}
function trend(arr,times,hours=12){
  if(!Array.isArray(arr)||!Array.isArray(times)) return null;
  const now=Date.now(), recent=[], older=[];
  for(let i=0;i<arr.length;i++){
    const t=Date.parse(times[i]); if(!Number.isFinite(t)) continue;
    const age=(now-t)/3600e3, v=Number(arr[i]); if(!Number.isFinite(v)) continue;
    if(age>=0&&age<=hours/2) recent.push(v);
    else if(age>hours/2&&age<=hours) older.push(v);
  }
  if(!recent.length||!older.length) return null;
  return recent.reduce((a,b)=>a+b,0)/recent.length - older.reduce((a,b)=>a+b,0)/older.length;
}
function estimateUnderwaterVisibility(name,marine,weather){
  const mh=marine.hourly||{}, wh=weather.hourly||{};
  const mt=mh.time||[], wt=wh.time||[];
  const now=Date.now();
  const currentWave=num(marine.current?.wave_height), currentPeriod=num(marine.current?.wave_period);
  const swell=num(marine.current?.swell_wave_height), swellPeriod=num(marine.current?.swell_wave_period);
  const wind=num(weather.current?.wind_speed_10m), windDir=num(weather.current?.wind_direction_10m);
  const gust=num(weather.current?.wind_gusts_10m);
  const current=num(marine.current?.ocean_current_velocity);
  const tideNow=num(marine.current?.sea_level_height_msl);
  const waveTrend=trend(mh.wave_height,mt,12);
  const windTrend=trend(wh.wind_speed_10m,wt,12);
  const recentWave=meanLast(mh.wave_height,mt,24);
  const recentWind=meanLast(wh.wind_speed_10m,wt,24);
  const rain24=meanLast(wh.precipitation,wt,24);
  const rain48=meanLast(wh.precipitation,wt,48);
  const tideRange=rangeLast(mh.sea_level_height_msl,mt,24);
  const exposure=SPOT_VIS_PROFILE[name]?.exposure??0.9;

  if(![currentWave,currentPeriod,wind].every(finite)) return {available:false};

  // Start from a coastal-water baseline and apply evidence-based directional penalties.
  let v=3.2;
  let confidence=0.52;
  const reasons=[];
  const factors={};

  // Current sea state: the strongest driver of near-shore resuspension.
  let waveAdj = currentWave<=0.6 ? 0.65 : currentWave<=1.0 ? 0.35 : currentWave<=1.3 ? 0 : currentWave<=1.7 ? -0.55 : currentWave<=2.1 ? -1.15 : -1.9;
  waveAdj *= (0.8+0.4*exposure);
  v+=waveAdj; factors.wave=Number(waveAdj.toFixed(2));
  if(currentWave<=1.0) reasons.push('onda baixa'); else if(currentWave>=1.7) reasons.push('onda elevada');

  // Short chop tends to keep sediment suspended; longer swell can be cleaner at the same height.
  let periodAdj=currentPeriod<5 ? -0.8 : currentPeriod<7 ? -0.35 : currentPeriod<=11 ? 0.35 : currentPeriod<=13 ? 0.15 : -0.1;
  v+=periodAdj; factors.period=Number(periodAdj.toFixed(2));
  if(currentPeriod<6) reasons.push('período curto'); else if(currentPeriod>=8) reasons.push('swell mais organizado');

  // Swell component and its period.
  if(finite(swell)){
    const swellAdj=swell<=0.5?0.25:swell<=0.9?0:swell<=1.3?-0.35:swell<=1.8?-0.8:-1.25;
    v+=swellAdj; factors.swell=Number(swellAdj.toFixed(2));
  }
  if(finite(swellPeriod)&&swellPeriod>=8&&swell<=1.3){ v+=0.2; }

  // Wind direction and speed: offshore/easterly helps; onshore W/SW/NW hurts.
  const dirF=visibilityDirectionFactor(windDir);
  const windAdj=dirF*(wind<=8?0.65:wind<=14?0.35:wind<=20?0.05:-0.35);
  v+=windAdj; factors.wind=Number(windAdj.toFixed(2));
  if(dirF< -0.5) reasons.push('vento marítimo'); else if(dirF>0.5) reasons.push('vento E/SE');
  if(wind>18) reasons.push('vento forte');

  // Gusts amplify surface mixing.
  if(finite(gust)&&gust>18){ const a=-Math.min(0.8,(gust-18)*0.08); v+=a; factors.gust=Number(a.toFixed(2)); }

  // Recent trend: falling wave is a positive signal; rising wave is negative.
  if(finite(waveTrend)){
    const a=clamp(-waveTrend*1.1,-0.8,0.8); v+=a; factors.waveTrend=Number(a.toFixed(2));
    if(waveTrend<-0.15) reasons.push('onda a baixar');
    if(waveTrend>0.2) reasons.push('onda a subir');
  }
  if(finite(windTrend)) v+=clamp(-windTrend*0.06,-0.35,0.35);

  // Recent rain is a runoff/turbidity proxy; confidence is lower because local runoff varies.
  if(finite(rain24)&&rain24>1){ const a=-Math.min(0.8,rain24*0.12); v+=a; factors.rain=Number(a.toFixed(2)); reasons.push('chuva recente'); confidence-=0.04; }
  else if(finite(rain48)&&rain48>4){ v-=0.35; reasons.push('chuva acumulada'); confidence-=0.06; }

  // Current and tidal range can increase mixing in exposed spots.
  if(finite(current)&&current>0.5){ const a=-Math.min(0.6,(current-0.5)*0.9); v+=a; factors.current=Number(a.toFixed(2)); reasons.push('corrente forte'); }
  if(finite(tideRange)&&tideRange>1.2){ const a=-Math.min(0.45,(tideRange-1.2)*0.45)*exposure; v+=a; factors.tide=Number(a.toFixed(2)); }

  // Protected spots receive a modest positive local-exposure adjustment.
  const protection=(1-exposure)*0.9; v+=protection; factors.protection=Number(protection.toFixed(2));

  // Calibrate with recent real observations from this spot when available.
  const obs=obsSummary(name);
  let observationWeight=0;
  if(obs.visibilityAvg!=null&&obs.count){
    const latestAge=obs.latest?.createdAt?(Date.now()-Date.parse(obs.latest.createdAt))/86400000:99;
    observationWeight=latestAge<=1?0.40:latestAge<=3?0.25:latestAge<=7?0.12:0;
    if(observationWeight>0){
      v=v*(1-observationWeight)+Number(obs.visibilityAvg)*observationWeight;
      confidence+=0.18*observationWeight/0.40;
      reasons.push('calibrada por observações recentes');
    }
  }

  v=clamp(v,0.5,7.0);
  confidence=clamp(confidence+(currentWave!=null?0.08:0)+(swell!=null?0.05:0)+(current!=null?0.04:0),0.25,0.90);
  const low=clamp(v-0.7,0.3,6.5), high=clamp(v+0.7,1.0,8.0);
  let label=v>=4.5?'Muito boa':v>=3.2?'Boa':v>=2.2?'Razoável':v>=1.3?'Fraca':'Muito fraca';
  return {available:true,estimatedMeters:Number(v.toFixed(1)),range:[Number(low.toFixed(1)),Number(high.toFixed(1))],label,confidence:Math.round(confidence*100),reasons:reasons.slice(0,4),factors,observationWeight:Number(observationWeight.toFixed(2)),model:'derived-coastal-visibility-v1'};
}


function historicalContext(mh,wh,targetTime){
  const mt=mh.time||[], wt=wh.time||[];
  const target=Date.parse(targetTime);
  if(!Number.isFinite(target)) return {avg24:null,avg72:null,max24:null,max72:null,highWaveFrac72:null,rain24:null,rain72:null,currentWave:null,trend12:null};
  const vals=(arr,times,hours,mapper)=>{
    const out=[]; const start=target-hours*3600e3;
    for(let i=0;i<arr.length;i++){
      const t=Date.parse(times[i]); if(!Number.isFinite(t)||t>=target||t<start) continue;
      const v=mapper(arr[i],i); if(Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  const wave24=vals(mh.wave_height,mt,24,v=>Number(v));
  const wave72=vals(mh.wave_height,mt,72,v=>Number(v));
  const rain24=vals(wh.precipitation,wt,24,v=>Number(v));
  const rain72=vals(wh.precipitation,wt,72,v=>Number(v));
  const wind12=vals(wh.wind_speed_10m,wt,12,v=>Number(v));
  const prev12=vals(mh.wave_height,mt,12,v=>Number(v));
  const high=wave72.length?wave72.filter(v=>v>=1.5).length/wave72.length:null;
  const recentWave=wave24.length?wave24.reduce((a,b)=>a+b,0)/wave24.length:null;
  const earlier=vals(mh.wave_height,mt,72,v=>Number(v)).filter((_,i)=>false);
  let trend12=null;
  if(prev12.length>=4){
    const mid=Math.floor(prev12.length/2), a=prev12.slice(0,mid), b=prev12.slice(mid);
    const avgA=a.reduce((x,y)=>x+y,0)/a.length, avgB=b.reduce((x,y)=>x+y,0)/b.length;
    trend12=avgB-avgA;
  }
  return {
    avg24:wave24.length?wave24.reduce((a,b)=>a+b,0)/wave24.length:null,
    avg72:wave72.length?wave72.reduce((a,b)=>a+b,0)/wave72.length:null,
    max24:wave24.length?Math.max(...wave24):null,
    max72:wave72.length?Math.max(...wave72):null,
    highWaveFrac72:high,
    rain24:rain24.length?rain24.reduce((a,b)=>a+b,0):null,
    rain72:rain72.length?rain72.reduce((a,b)=>a+b,0):null,
    wind12:wind12.length?wind12.reduce((a,b)=>a+b,0)/wind12.length:null,
    currentWave:recentWave,
    trend12
  };
}
function seaMemory(targetTime,mh,wh){
  const h=historicalContext(mh,wh,targetTime);
  let penalty=0; let recovery=0; const reasons=[];
  if(finite(h.avg72)) penalty+=clamp((h.avg72-0.65)*0.95,0,1.15);
  if(finite(h.max24)) penalty+=clamp((h.max24-1.4)*0.30,0,0.75);
  if(finite(h.highWaveFrac72)) penalty+=h.highWaveFrac72*0.55;
  if(finite(h.rain72)&&h.rain72>8) penalty+=Math.min(0.45,(h.rain72-8)*0.035);
  if(finite(h.avg24)&&finite(h.avg72)&&h.avg24<h.avg72-0.15){ recovery+=0.30; reasons.push('mar a recuperar'); }
  if(finite(h.trend12)&&h.trend12<-0.15){ recovery+=0.22; reasons.push('onda a baixar'); }
  if(penalty>0.75) reasons.push('efeito residual da agitação');
  const net=clamp(penalty-recovery,-0.25,1.8);
  return {penalty:Number(net.toFixed(2)),recovery:Number(recovery.toFixed(2)),reasons,history:h};
}
function scoreWithMemory(base,mem){
  if(base==null) return null;
  const adjusted=Number(clamp(base-(mem.penalty*0.85),0,10).toFixed(1));
  return adjusted;
}
function estimateHourlyVisibilityAt(x, memory){
  if(![x.wave,x.period,x.wind].every(finite)) return null;
  let v=3.2;
  v += x.wave<=0.6?0.65:x.wave<=1?0.35:x.wave<=1.3?0:x.wave<=1.7?-0.55:x.wave<=2.1?-1.15:-1.9;
  v += x.period<5?-0.8:x.period<7?-0.35:x.period<=11?0.35:x.period<=13?0.15:-0.1;
  if(finite(x.swell)) v += x.swell<=0.5?0.25:x.swell<=0.9?0:x.swell<=1.3?-0.35:x.swell<=1.8?-0.8:-1.25;
  const df=visibilityDirectionFactor(x.windDirection);
  v += df*(x.wind<=8?0.65:x.wind<=14?0.35:x.wind<=20?0.05:-0.35);
  if(finite(x.gust)&&x.gust>18) v-=Math.min(0.8,(x.gust-18)*0.08);
  if(finite(x.current)&&x.current>0.5) v-=Math.min(0.6,(x.current-0.5)*0.9);
  if(finite(x.tide)&&Math.abs(x.tide)>1.2) v-=0.15;
  if(finite(x.rainChance)&&x.rainChance>70) v-=0.1;
  if(memory?.penalty!=null) v-=Math.min(1.35,memory.penalty*0.75);
  return Number(clamp(v,0.5,7).toFixed(1));
}
function buildDailyForecast(hourly){
  const days={};
  hourly.filter(x=>x.time).forEach(x=>{
    const d=x.time.slice(0,10); if(!days[d]) days[d]=[]; days[d].push(x);
  });
  const keys=Object.keys(days).sort();
  const out=[];
  for(const d of keys.slice(0,7)){
    const day=days[d].filter(x=>x.score!=null);
    if(!day.length) continue;
    const daylight=day.filter(x=>{const h=Number(x.time.slice(11,13));return h>=8&&h<=20;});
    const pool=daylight.length?daylight:day;
    const top=[...pool].sort((a,b)=>(b.score??-1)-(a.score??-1)).slice(0,6);
    const avg=(arr,key)=>{const v=arr.map(x=>Number(x[key])).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
    const best=top[0]||pool[0];
    const avgScore=top.length?top.reduce((a,x)=>a+x.score,0)/top.length:best.score;
    const avgVis=avg(top,'underwaterVisibility');
    const waves=avg(pool,'wave'), winds=avg(pool,'wind');
    const memoryAvg=avg(pool,'memoryPenalty');
    const trend=memoryAvg!=null?(memoryAvg<=0.35?'a recuperar':memoryAvg>=1.0?'mar ainda mexido':'estável'):'—';
    out.push({date:d,score:Number(avgScore.toFixed(1)),visibility:avgVis!=null?Number(avgVis.toFixed(1)):null,bestTime:best.time,bestScore:best.score,waveAvg:waves!=null?Number(waves.toFixed(1)):null,windAvg:winds!=null?Number(winds.toFixed(1)):null,memoryPenalty:memoryAvg!=null?Number(memoryAvg.toFixed(2)):null,memoryTrend:trend});
  }
  return out;
}
function estimateHourlyVisibility(x){ return estimateHourlyVisibilityAt(x,null); }
function buildSpot(name,marine,weather){
  const mc=marine.current||{}, wc=weather.current||{};
  const wave=num(mc.wave_height), period=num(mc.wave_period), wind=num(wc.wind_speed_10m), gust=num(wc.wind_gusts_10m);
  const baseScore=modelScore(wave,period,wind,gust);

  const e=energy(wave,period);

  const mh=marine.hourly||{}, wh=weather.hourly||{};
  const n=Math.min((mh.time||[]).length,(wh.time||[]).length);
  const hourly=[];
  for(let i=0;i<n;i++){
    const time=mh.time[i];
    const w=num(mh.wave_height?.[i]), p=num(mh.wave_period?.[i]), wi=num(wh.wind_speed_10m?.[i]), g=num(wh.wind_gusts_10m?.[i]);
    const mem=seaMemory(time,mh,wh);
    const base=modelScore(w,p,wi,g);
    hourly.push({
      time, wave:w, waveDirection:num(mh.wave_direction?.[i]), period:p,
      peakPeriod:num(mh.wave_peak_period?.[i]), swell:num(mh.swell_wave_height?.[i]),
      swellDirection:num(mh.swell_wave_direction?.[i]), swellPeriod:num(mh.swell_wave_period?.[i]),
      wind:wi, windDirection:num(wh.wind_direction_10m?.[i]), gust:g,
      visibility:num(wh.visibility?.[i]), rainChance:num(wh.precipitation_probability?.[i]),
      cloud:num(wh.cloud_cover?.[i]), baseScore:base, memoryPenalty:mem.penalty, memoryRecovery:mem.recovery,
      memoryReasons:mem.reasons, score:scoreWithMemory(base,mem),
      underwaterVisibility:estimateHourlyVisibilityAt({wave:w,period:p,wind:wi,gust:g,waveDirection:num(mh.wave_direction?.[i]),swell:num(mh.swell_wave_height?.[i]),swellPeriod:num(mh.swell_wave_period?.[i]),windDirection:num(wh.wind_direction_10m?.[i]),current:num(mh.ocean_current_velocity?.[i]),tide:num(mh.sea_level_height_msl?.[i]),rainChance:num(wh.precipitation_probability?.[i])},mem)
    });
  }
  const today=new Date().toISOString().slice(0,10);
  const futureHourly=hourly.filter(x=>x.time.slice(0,10)>=today);
  const next24=futureHourly.slice(0,24).filter(x=>x.score!=null);
  const best=next24.reduce((a,b)=>!a||b.score>a.score?b:a,null);
  const dailyForecast=buildDailyForecast(futureHourly);
  const nowLocal=new Date().toLocaleString('sv-SE',{timeZone:'Europe/Lisbon',hour12:false}).replace(' ','T');
  const currentMem=seaMemory(nowLocal,mh,wh).penalty;
  const adjustedCurrentScore=scoreWithMemory(baseScore,{penalty:currentMem||0});
  const [emoji,status]=classify(adjustedCurrentScore);
  const underwaterVisibility=estimateUnderwaterVisibility(name,marine,weather);
  if(underwaterVisibility.available && currentMem!=null){
    underwaterVisibility.estimatedMeters=Number(clamp(underwaterVisibility.estimatedMeters-currentMem*0.45,0.5,7).toFixed(1));
    underwaterVisibility.range=[Number(clamp(underwaterVisibility.range[0]-currentMem*0.3,0.3,6.5).toFixed(1)),Number(clamp(underwaterVisibility.range[1]-currentMem*0.15,1.0,8.0).toFixed(1))];
    underwaterVisibility.historyPenalty=currentMem;
    underwaterVisibility.reasons=[...(underwaterVisibility.reasons||[]),'efeito acumulado dos últimos dias'].slice(0,4);
  }
  const dailyBest=dailyForecast.slice().sort((a,b)=>b.score-a.score)[0]||null;

  return {
    name,lat:SPOTS[name][0],lon:SPOTS[name][1],score:adjustedCurrentScore,baseScore,status,statusEmoji:emoji,
    wave:wave!=null?`${fmt(wave)} m`:'—', period:period!=null?`${fmt(period)} s`:'—', direction:compass(mc.wave_direction),
    waterTemp:finite(mc.sea_surface_temperature)?`${fmt(mc.sea_surface_temperature)} °C`:'—',
    wind:wind!=null?`${fmt(wind)} km/h ${compass(wc.wind_direction_10m)}`:'—', gust:gust!=null?`${fmt(gust)} km/h`:'—',
    energy:e!=null?`~${fmt(e)} (indicador relativo)`:'—', atmosphericVisibility:finite(wc.visibility)?`${(Number(wc.visibility)/1000).toFixed(1)} km`:'—',
    underwaterVisibility: underwaterVisibility.available ? `${underwaterVisibility.estimatedMeters.toFixed(1)} m (estimativa)` : 'Indisponível',
    underwaterVisibilityPrediction: underwaterVisibility,
    swell:finite(mc.swell_wave_height)?`${fmt(mc.swell_wave_height)} m`:'—', swellDirection:compass(mc.swell_wave_direction),
    swellPeriod:finite(mc.swell_wave_period)?`${fmt(mc.swell_wave_period)} s`:'—',
    tideLevel:finite(mc.sea_level_height_msl)?`${Number(mc.sea_level_height_msl).toFixed(2)} m MSL*`:'—',
    currentSpeed:finite(mc.ocean_current_velocity)?`${fmt(mc.ocean_current_velocity)} km/h`:'—', currentDirection:compass(mc.ocean_current_direction),
    bestWindow:best?`${best.time.slice(11,16)} — ${best.score}/10`:'Não calculado', bestWindowTime:best?.time||null,
    dailyForecast, dailyBest, forecastDays:dailyForecast.length,
    historyModel:{hours:72,description:'O score e a visibilidade futura incluem um ajuste de memória das condições marinhas das 72 horas anteriores a cada hora prevista. O efeito diminui quando o mar recupera.',currentPenalty:Number((currentMem||0).toFixed(2))},
    hourly:hourly.filter(x=>x.time.slice(0,10)>=today).slice(0,168),
    note:'A visibilidade subaquática e o ajuste de memória são estimativas heurísticas, não medições. A previsão usa condições atuais e previstas de onda, período, swell, vento, rajadas, chuva, corrente e maré, e considera as 72 horas anteriores para representar o efeito residual da agitação. Observações reais recentes podem calibrar a visibilidade.'
  };
}

function readObs(){
  try{
    const raw=fs.readFileSync(OBS_FILE,'utf8');
    const x=JSON.parse(raw);
    return Array.isArray(x)?x:[];
  }catch(e){ return []; }
}
function writeObs(list){
  fs.writeFileSync(OBS_FILE,JSON.stringify(list,null,2),'utf8');
}
function obsSummary(spot){
  const list=readObs().filter(o=>o.spot===spot).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const avg=(key)=>{
    const vals=list.map(o=>Number(o[key])).filter(Number.isFinite);
    return vals.length?Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1)):null;
  };
  return {
    count:list.length,
    visibilityAvg:avg('visibility'),
    conditionsAvg:avg('conditions'),
    clarityAvg:avg('clarity'),
    fishActivityAvg:avg('fishActivity'),
    latest:list[0]||null,
    recent:list.slice(0,10)
  };
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Easyspearfishing',version:VERSION,cached:Boolean(cache.data),spots:Object.keys(SPOTS).length}));

app.get('/api/spots',async(req,res)=>{
  try{
    const force=req.query.force==='1';
    const data=await getAllSpots(force);
    const withCommunity=data.spots.map(s=>({...s,community:obsSummary(s.name)}));
    res.json({...data,spots:withCommunity});
  }catch(e){
    console.error(e);
    res.status(502).json({error:e.message});
  }
});

app.get('/api/spot',async(req,res)=>{
  try{
    const name=req.query.name;
    if(!SPOTS[name]) return res.status(404).json({error:'Spot não encontrado'});
    const data=await getAllSpots(false);
    const spot=data.spots.find(s=>s.name===name);
    res.json({...spot,community:obsSummary(name)});
  }catch(e){res.status(502).json({error:e.message});}
});

app.get('/api/observations',(req,res)=>{
  const spot=req.query.spot;
  if(!spot) return res.json({observations:readObs()});
  res.json(obsSummary(spot));
});

app.post('/api/observations',(req,res)=>{
  const body=req.body||{};
  const spot=String(body.spot||'').trim();
  if(!SPOTS[spot]) return res.status(400).json({error:'Spot inválido'});
  const visibility=num(body.visibility);
  const conditions=num(body.conditions);
  const clarity=num(body.clarity);
  const fishActivity=num(body.fishActivity);
  if(visibility==null || visibility<0 || visibility>30) return res.status(400).json({error:'Visibilidade inválida (0–30 m)'});
  if(![conditions,clarity,fishActivity].every(v=>v!=null&&v>=1&&v<=5)) return res.status(400).json({error:'Avaliações devem estar entre 1 e 5'});
  const note=String(body.note||'').trim().slice(0,500);
  const author=String(body.author||'Anónimo').trim().slice(0,40)||'Anónimo';
  const now=new Date().toISOString();
  const list=readObs();
  const item={id:crypto.randomUUID(),spot,visibility,conditions,clarity,fishActivity,note,author,createdAt:now};
  list.push(item);
  writeObs(list.slice(-1000));
  res.status(201).json({ok:true,observation:item,summary:obsSummary(spot)});
});

app.get('/api/data-info',(req,res)=>res.json({observationsFile:'data/observations.json',count:readObs().length}));

app.use(express.static(PUBLIC_DIR,{etag:false,lastModified:false,setHeaders:(res)=>res.setHeader('Cache-Control','no-store')}));
app.use((req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'Endpoint não encontrado'});
  res.sendFile(path.join(PUBLIC_DIR,'index.html'));
});

app.listen(PORT,'0.0.0.0',()=>console.log(`Easyspearfishing ${VERSION} on ${PORT}`));
