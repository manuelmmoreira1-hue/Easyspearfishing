const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '2.0-completo';

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

  const marineUrl=`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&forecast_days=3&timezone=Europe%2FLisbon&cell_selection=sea`;
  const weatherUrl=`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,cloud_cover&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&forecast_days=3&timezone=Europe%2FLisbon`;

  const [mr,wr]=await Promise.all([fetchJson(marineUrl),fetchJson(weatherUrl)]);
  const ma=Array.isArray(mr)?mr:[mr], wa=Array.isArray(wr)?wr:[wr];

  const spots=names.map((name,i)=>buildSpot(name,ma[i]||{},wa[i]||{}));
  cache={at:Date.now(),data:{updatedAt:new Date().toISOString(),version:VERSION,spots}};
  return cache.data;
}

function buildSpot(name,marine,weather){
  const mc=marine.current||{}, wc=weather.current||{};
  const wave=num(mc.wave_height), period=num(mc.wave_period), wind=num(wc.wind_speed_10m), gust=num(wc.wind_gusts_10m);
  const score=modelScore(wave,period,wind,gust);
  const [emoji,status]=classify(score);
  const e=energy(wave,period);

  const mh=marine.hourly||{}, wh=weather.hourly||{};
  const n=Math.min((mh.time||[]).length,(wh.time||[]).length);
  const hourly=[];
  for(let i=0;i<n;i++){
    const w=num(mh.wave_height?.[i]), p=num(mh.wave_period?.[i]), wi=num(wh.wind_speed_10m?.[i]), g=num(wh.wind_gusts_10m?.[i]);
    hourly.push({
      time:mh.time[i], wave:w, waveDirection:num(mh.wave_direction?.[i]), period:p,
      peakPeriod:num(mh.wave_peak_period?.[i]), swell:num(mh.swell_wave_height?.[i]),
      swellDirection:num(mh.swell_wave_direction?.[i]), swellPeriod:num(mh.swell_wave_period?.[i]),
      wind:wi, windDirection:num(wh.wind_direction_10m?.[i]), gust:g,
      visibility:num(wh.visibility?.[i]), rainChance:num(wh.precipitation_probability?.[i]),
      cloud:num(wh.cloud_cover?.[i]), score:modelScore(w,p,wi,g)
    });
  }
  const next24=hourly.slice(0,24).filter(x=>x.score!=null);
  const best=next24.reduce((a,b)=>!a||b.score>a.score?b:a,null);

  return {
    name,lat:SPOTS[name][0],lon:SPOTS[name][1],score,status,statusEmoji:emoji,
    wave:wave!=null?`${fmt(wave)} m`:'—',
    period:period!=null?`${fmt(period)} s`:'—',
    direction:compass(mc.wave_direction),
    waterTemp:finite(mc.sea_surface_temperature)?`${fmt(mc.sea_surface_temperature)} °C`:'—',
    wind:wind!=null?`${fmt(wind)} km/h ${compass(wc.wind_direction_10m)}`:'—',
    gust:gust!=null?`${fmt(gust)} km/h`:'—',
    energy:e!=null?`~${fmt(e)} (indicador relativo)`:'—',
    atmosphericVisibility:finite(wc.visibility)?`${(Number(wc.visibility)/1000).toFixed(1)} km`:'—',
    underwaterVisibility:'Não disponível por modelo — usar observações reais',
    swell:finite(mc.swell_wave_height)?`${fmt(mc.swell_wave_height)} m`:'—',
    swellDirection:compass(mc.swell_wave_direction),
    swellPeriod:finite(mc.swell_wave_period)?`${fmt(mc.swell_wave_period)} s`:'—',
    tideLevel:finite(mc.sea_level_height_msl)?`${Number(mc.sea_level_height_msl).toFixed(2)} m MSL*`:'—',
    currentSpeed:finite(mc.ocean_current_velocity)?`${fmt(mc.ocean_current_velocity)} km/h`:'—',
    currentDirection:compass(mc.ocean_current_direction),
    bestWindow:best?`${best.time.slice(11,16)} — ${best.score}/10`:'Não calculado',
    bestWindowTime:best?.time||null,
    hourly:hourly.slice(0,48),
    note:'O score do modelo é um indicador técnico da app, não uma certificação de segurança. A visibilidade atmosférica não é visibilidade subaquática. A visibilidade subaquática deve ser confirmada no local ou por observações recentes.'
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
