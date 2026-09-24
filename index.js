const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const DATA_DIR = path.join(__dirname, '../data');
const OBS_FILE = path.join(DATA_DIR, 'observations.json');


const spots = {
  'Foz do Douro': { coords:[41.148,-8.675], exposure:285 },
  'Castelo do Queijo': { coords:[41.169,-8.689], exposure:285 },
  'Matosinhos': { coords:[41.182,-8.705], exposure:290 },
  'Leça da Palmeira': { coords:[41.190,-8.704], exposure:295 },
  'Marreco': { coords:[41.235,-8.724], exposure:300 },
  'Perafita': { coords:[41.225,-8.716], exposure:300 },
  'Angeiras': { coords:[41.265,-8.722], exposure:300 },
  'Labruge': { coords:[41.280,-8.716], exposure:305 },
  'Mindelo': { coords:[41.316,-8.724], exposure:305 },
  'Azurara': { coords:[41.337,-8.741], exposure:300 },
  'Vila do Conde': { coords:[41.353,-8.744], exposure:300 },
  'Póvoa de Varzim': { coords:[41.381,-8.765], exposure:290 }
};

const VIS_LABELS = {
  'muito-boa': { label:'Muito boa', min:5, max:8, mid:6.5 },
  'boa': { label:'Boa', min:3, max:5, mid:4 },
  'media': { label:'Média', min:2, max:3, mid:2.5 },
  'fraca': { label:'Fraca', min:1, max:2, mid:1.5 },
  'muito-fraca': { label:'Muito fraca', min:0, max:1, mid:0.5 }
};

function ensureStore(){
  fs.mkdirSync(DATA_DIR, { recursive:true });
  if(!fs.existsSync(OBS_FILE)) fs.writeFileSync(OBS_FILE, '[]', 'utf8');
}
function readObservations(){
  ensureStore();
  try { const x=JSON.parse(fs.readFileSync(OBS_FILE,'utf8')); return Array.isArray(x)?x:[]; }
  catch { return []; }
}
function writeObservations(list){ ensureStore(); fs.writeFileSync(OBS_FILE, JSON.stringify(list.slice(-2000), null, 2), 'utf8'); }

function degToCompass(deg) {
  if (!Number.isFinite(Number(deg))) return '—';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(Number(deg) / 45) % 8];
}
function angleDiff(a,b){ let d=Math.abs(((a-b+180)%360)-180); return d; }
function fmt(value, decimals = 1) { return Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '—'; }
function calcEnergy(wave, period) { if (!Number.isFinite(wave)||!Number.isFinite(period)) return null; return 0.49*wave*wave*period; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function baseSeaScore(wave, period, wind, gust, energy){
  if (![wave,period,wind,gust].every(Number.isFinite)) return null;
  let s=10;
  if(wave>0.7) s-=Math.min(4,(wave-0.7)*3);
  if(wave>1.5) s-=1.5;
  if(wave>2) s-=2;
  if(period<5) s-=0.5;
  if(period>12) s-=0.3;
  if(wind>8) s-=Math.min(2.5,(wind-8)*0.18);
  if(gust>18) s-=Math.min(1.5,(gust-18)*0.12);
  if(gust>28) s-=1;
  if(Number.isFinite(energy)){
    if(energy>15) s-=Math.min(2,(energy-15)*0.10);
    if(energy>25) s-=1.5;
  }
  return clamp(Number(s.toFixed(1)),0,10);
}
function classify(s){
  if(s==null) return ['🟡','Sem classificação'];
  if(s>=8.5) return ['🟢','Muito favorável'];
  if(s>=7) return ['🟢','Favorável'];
  if(s>=5) return ['🟡','Razoável / variável'];
  if(s>=3.5) return ['🟠','Exige atenção'];
  return ['🔴','Evitar / mar exigente'];
}
function confidenceLabel(c){ return c>=0.75?'Alta':c>=0.5?'Média':'Baixa'; }
function directionExposureFactor(dir, exposure){
  if(!Number.isFinite(dir)) return 0.5;
  const d=angleDiff(dir,exposure);
  if(d<=30) return 1;
  if(d<=60) return 0.75;
  if(d<=90) return 0.45;
  return 0.2;
}
function daylight(t){ return t?.isDay === 1 || t?.isDay === true; }
function hoursDiff(a,b){ return Math.abs(new Date(a)-new Date(b))/3600000; }

function visibilityEstimate(hour, history, obs, exposure){
  const wave=hour.wave, period=hour.period, wind=hour.wind, gust=hour.gust;
  let base=4.2;
  const energy=calcEnergy(wave,period)||0;
  const exp=directionExposureFactor(hour.waveDirection,exposure);
  base -= Math.min(2.2, energy*0.055*exp);
  base -= Math.min(1.1, Math.max(0,wind-8)*0.08);
  base -= Math.min(0.8, Math.max(0,gust-18)*0.035);

  const recent=history.filter(x=>x.past && x.time < hour.time);
  const last72=recent.slice(-72);
  const avgEnergy=last72.length?last72.reduce((a,x)=>a+(x.energy||0),0)/last72.length:energy;
  const maxEnergy=last72.length?Math.max(...last72.map(x=>x.energy||0)):energy;
  const recentRain=last72.reduce((a,x)=>a+(x.rain||0)+(x.showers||0),0);
  const runoff=last72.reduce((a,x)=>a+(x.runoff||0),0);
  base -= Math.min(1.5, avgEnergy*0.035);
  base -= Math.min(1.0, Math.max(0,maxEnergy-10)*0.035);
  base -= Math.min(1.2, recentRain*0.08 + runoff*0.12);

  const recovery=Math.max(0, 12 - hoursDiff(hour.time, recent[recent.length-1]?.time || hour.time));
  if(avgEnergy < 8 && energy < 10) base += Math.min(0.8,recovery*0.04);

  const localObs=obs.filter(o=>o.spot===hour.name).map(o=>({o,age:hoursDiff(hour.time,o.timestamp)})).filter(x=>x.age>=0 && x.age<=96);
  let obsWeight=0, obsValue=0;
  for(const x of localObs){
    const w=Math.exp(-x.age/18);
    const v=Number.isFinite(x.meters)?x.meters:(VIS_LABELS[x.visibility]?.mid);
    if(Number.isFinite(v)){obsWeight+=w;obsValue+=w*v;}
  }
  if(obsWeight>0){
    const observed=obsValue/obsWeight;
    const blend=Math.min(0.72,obsWeight/(obsWeight+1.5));
    base=base*(1-blend)+observed*blend;
  }

  const trendRaw = (energy <= avgEnergy*0.9 && wind <= 8) ? 1 : (energy >= avgEnergy*1.12 || wind >= 12 ? -1 : 0);
  const trend=trendRaw>0?'a melhorar':trendRaw<0?'a piorar':'estável';
  const low=clamp(base-0.8,0.3,8), high=clamp(base+0.8,0.8,8);
  const confidence=clamp(0.38 + (last72.length/72)*0.25 + Math.min(0.3,obsWeight*0.12) + (Number.isFinite(wave)?0.08:0),0.2,0.95);
  return { min:Number(low.toFixed(1)), max:Number(high.toFixed(1)), mid:Number(clamp(base,0.3,8).toFixed(1)), trend, confidence:Number(confidence.toFixed(2)), confidenceLabel:confidenceLabel(confidence), observations:localObs.length };
}

function buildReasons(hour, vis, exposure){
  const reasons=[];
  if(hour.wave<=0.8) reasons.push('onda baixa'); else if(hour.wave>=1.4) reasons.push('ondulação elevada');
  if(hour.wind<=7) reasons.push('vento fraco'); else if(hour.wind>=12) reasons.push('vento a prejudicar');
  if(vis.mid>=4) reasons.push('visibilidade provável boa'); else if(vis.mid<2) reasons.push('visibilidade provável fraca');
  if(vis.trend==='a melhorar') reasons.push('água com tendência de melhoria');
  if(vis.trend==='a piorar') reasons.push('água com tendência de deterioração');
  if(directionExposureFactor(hour.waveDirection,exposure)<0.5) reasons.push('spot relativamente abrigado da direção dominante');
  return reasons.slice(0,4);
}

async function fetchJson(url){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
  try{ const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'Easyspearfishing/1.0'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
  finally{ clearTimeout(timer); }
}


async function modelFetch(url, label){
  try{
    const data=await fetchJson(url);
    const h=data.hourly||{};
    const i=0;
    return {label,wave:Number(h.wave_height?.[i]),period:Number(h.wave_period?.[i]),waveDirection:Number(h.wave_direction?.[i]),wind:Number(h.wind_speed_10m?.[i]),windDirection:Number(h.wind_direction_10m?.[i])};
  }catch(e){ return {label,error:e.message}; }
}
function agreementFrom(values,key,tolerance){
  const xs=values.map(x=>x[key]).filter(Number.isFinite);
  if(xs.length<2)return {label:'Indisponível',score:null,count:xs.length,spread:null};
  const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
  const spread=Math.max(...xs)-Math.min(...xs);
  const score=clamp(1-spread/tolerance,0,1);
  return {label:score>=0.75?'Alta':score>=0.5?'Média':'Baixa',score:Number(score.toFixed(2)),count:xs.length,spread:Number(spread.toFixed(2)),mean:Number(mean.toFixed(2))};
}
async function getModelAgreement(lat,lon){
  const marineModels=[['DWD EWAM','dwd_ewam'],['ECMWF WAM','ecmwf_wam'],['Météo-France MFWAM','meteofrance_wave'],['GFS Wave','gfs_wave']];
  const weatherModels=[['ECMWF IFS','ecmwf_ifs025'],['DWD ICON EU','dwd_icon_eu'],['Météo-France ARPEGE','meteofrance_arpege_europe']];
  const common=`latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction&forecast_days=2&timezone=Europe%2FLisbon&cell_selection=sea`;
  const marine=await Promise.all(marineModels.map(([label,model])=>modelFetch(`https://marine-api.open-meteo.com/v1/marine?${common}&models=${model}`,label)));
  const weather=await Promise.all(weatherModels.map(([label,model])=>modelFetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&forecast_days=2&timezone=Europe%2FLisbon&models=${model}`,label)));
  const validMarine=marine.filter(x=>Number.isFinite(x.wave));
  const validWeather=weather.filter(x=>Number.isFinite(x.wind));
  return {
    waves:agreementFrom(validMarine,'wave',0.45),
    periods:agreementFrom(validMarine,'period',2.5),
    winds:agreementFrom(validWeather,'wind',5),
    marine:marine.map(x=>({label:x.label,wave:x.wave,period:x.period,direction:degToCompass(x.waveDirection),error:x.error||null})),
    weather:weather.map(x=>({label:x.label,wind:x.wind,direction:degToCompass(x.windDirection),error:x.error||null}))
  };
}

async function getSpotData(reqUrl){
  const name=reqUrl.searchParams.get('name')||'Spot';
  const spot=spots[name];
  const coords=spot?.coords || [Number(reqUrl.searchParams.get('lat')),Number(reqUrl.searchParams.get('lon'))];
  const [lat,lon]=coords;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) throw Object.assign(new Error('Coordenadas inválidas'),{statusCode:400});

  const marineUrl=`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&forecast_days=7&past_days=3&timezone=Europe%2FLisbon&cell_selection=sea`;
  const weatherUrl=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,precipitation,rain,showers,surface_runoff,is_day&daily=sunrise,sunset&forecast_days=7&past_days=3&timezone=Europe%2FLisbon`;
  const wantModels=reqUrl.searchParams.get('details')==='1';
  const [marine,weather,modelAgreement]=await Promise.all([fetchJson(marineUrl),fetchJson(weatherUrl),wantModels?getModelAgreement(lat,lon):Promise.resolve(null)]);
  const mh=marine.hourly||{}, wh=weather.hourly||{}; const n=Math.min((mh.time||[]).length,(wh.time||[]).length);
  const obs=readObservations(); const all=[];
  for(let i=0;i<n;i++){
    const wave=Number(mh.wave_height?.[i]), period=Number(mh.wave_period?.[i]), wind=Number(wh.wind_speed_10m?.[i]), gust=Number(wh.wind_gusts_10m?.[i]);
    const energy=calcEnergy(wave,period); const t=mh.time[i]; const isPast=new Date(t)<new Date();
    all.push({name,time:t,past:isPast,wave,period,waveDirection:Number(mh.wave_direction?.[i]),peakPeriod:Number(mh.wave_peak_period?.[i]),swell:Number(mh.swell_wave_height?.[i]),swellDirection:Number(mh.swell_wave_direction?.[i]),swellPeriod:Number(mh.swell_wave_period?.[i]),wind,windDirection:Number(wh.wind_direction_10m?.[i]),gust,atmosphericVisibility:Number(wh.visibility?.[i]),rain:Number(wh.rain?.[i])||0,showers:Number(wh.showers?.[i])||0,runoff:Number(wh.surface_runoff?.[i])||0,precipitationProbability:Number(wh.precipitation_probability?.[i]),isDay:Number(wh.is_day?.[i]),waterTemp:Number(mh.sea_surface_temperature?.[i]),tideLevel:Number(mh.sea_level_height_msl?.[i]),current:Number(mh.ocean_current_velocity?.[i]),currentDirection:Number(mh.ocean_current_direction?.[i]),energy});
  }
  const future=all.filter(x=>new Date(x.time)>=new Date()).slice(0,168);
  const current={...future[0]};
  const scored=future.filter(h=>h.isDay===1 && [h.wave,h.period,h.wind,h.gust].every(Number.isFinite)).map(h=>{const v=visibilityEstimate(h,all,obs,spot?.exposure??300); const sea=baseSeaScore(h.wave,h.period,h.wind,h.gust,h.energy); const visibilityBonus=clamp((v.mid-2)*0.45,-1.2,1.2); const s=sea==null?null:Number(clamp(sea+visibilityBonus,0,10).toFixed(1)); return {...h,visibility:v,score:s,reasons:buildReasons(h,v,spot?.exposure??300)};});
  const now=scored[0]||null; const daylight=scored.filter(x=>x.isDay===1); const best=daylight.slice().sort((a,b)=>(b.score??-1)-(a.score??-1))[0]||null;
  const currentVis=now?.visibility || visibilityEstimate(current,all,obs,spot?.exposure??300); const currentScore=now?.score ?? baseSeaScore(current.wave,current.period,current.wind,current.gust,current.energy);
  const [statusEmoji,status]=classify(currentScore);
  const dayIndex={}; for(const x of daylight){ const d=x.time.slice(0,10); if(!dayIndex[d]||x.score>dayIndex[d].score) dayIndex[d]=x; }
  const daily=Object.values(dayIndex).slice(0,7).map(x=>({date:x.time.slice(0,10),score:x.score,bestTime:x.time.slice(11,16),visibility:x.visibility,status:classify(x.score)[1]}));
  const sun=weather.daily||{};
  const recentObs=obs.filter(o=>o.spot===name).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,8);
  return {name,lat,lon,exposure:spot?.exposure,source:'Open-Meteo Marine + Weather',modelNote:'Base meteorológica/marinha mantida; 7 dias e histórico recente usados para a camada de inteligência. Maré/correntes têm limitações costeiras segundo a documentação da API.',modelAgreement,score:currentScore,status,statusEmoji,wave:fmt(current.wave)+' m',period:fmt(current.period)+' s',direction:degToCompass(current.waveDirection),waterTemp:fmt(current.waterTemp)+' °C',wind:fmt(current.wind)+' km/h '+degToCompass(current.windDirection),gust:fmt(current.gust)+' km/h',energy:fmt(current.energy)+' (indicador relativo)',atmosphericVisibility:Number.isFinite(current.atmosphericVisibility)?fmt(current.atmosphericVisibility/1000)+' km':'—',swell:fmt(current.swell)+' m',swellDirection:degToCompass(current.swellDirection),swellPeriod:fmt(current.swellPeriod)+' s',tideLevel:Number.isFinite(current.tideLevel)?current.tideLevel.toFixed(2)+' m MSL*':'—',currentSpeed:fmt(current.current)+' km/h',currentDirection:degToCompass(current.currentDirection),underwaterVisibility:currentVis,confidence:currentVis.confidenceLabel,bestWindow:best?`${best.time.slice(11,16)} — ${best.score}/10`:'Não calculado',bestReasons:best?.reasons||[],daily,sunrise:sun.sunrise?.slice(0,7)||[],sunset:sun.sunset?.slice(0,7)||[],observations:recentObs,hourly:scored.map(h=>({...h,atmosphericVisibility:h.atmosphericVisibility})).slice(0,168),note:'A visibilidade submarina é uma estimativa heurística que combina estado do mar, energia, vento, histórico recente e observações reais. Não é medição direta e deve ser confirmada no local.'};
}

function sendJson(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body);}
function serveStatic(res,pathname){let rel=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');if(rel.includes('..'))return sendJson(res,403,{error:'Acesso negado'});const file=path.join(PUBLIC_DIR,rel);if(!fs.existsSync(file)||!fs.statSync(file).isFile())return sendJson(res,404,{error:'Ficheiro não encontrado'});const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);}
function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>32768){reject(new Error('Payload demasiado grande'));req.destroy();}});req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch{reject(new Error('JSON inválido'));}});req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&url.pathname==='/api/health')return sendJson(res,200,{ok:true,service:'Easyspearfishing',version:'1.0-intelligence'});if(req.method==='GET'&&url.pathname==='/api/spot')return sendJson(res,200,await getSpotData(url));if(req.method==='GET'&&url.pathname==='/api/observations'){const spot=url.searchParams.get('spot');let x=readObservations().filter(o=>!spot||o.spot===spot);x.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));return sendJson(res,200,x.slice(0,100));}if(req.method==='POST'&&url.pathname==='/api/observations'){const {spot,visibility,meters,state,depth,note}=await readBody(req);if(!spots[spot])return sendJson(res,400,{error:'Spot inválido'});if(!visibility&&!Number.isFinite(Number(meters)))return sendJson(res,400,{error:'Indica a visibilidade'});if(visibility&&!VIS_LABELS[visibility])return sendJson(res,400,{error:'Categoria de visibilidade inválida'});const m=meters===''||meters==null?null:Number(meters);if(m!=null&&(!Number.isFinite(m)||m<0||m>30))return sendJson(res,400,{error:'Metros inválidos'});const d=depth===''||depth==null?null:Number(depth);const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),spot,visibility:visibility||null,meters:m,state:state||null,depth:Number.isFinite(d)?d:null,note:String(note||'').slice(0,240),timestamp:new Date().toISOString()};const list=readObservations();list.push(item);writeObservations(list);return sendJson(res,201,item);}if(req.method==='GET')return serveStatic(res,url.pathname);return sendJson(res,405,{error:'Método não permitido'});}catch(e){console.error(e);return sendJson(res,e.statusCode||502,{error:e.message||'Erro interno'});}});

server.listen(PORT,'0.0.0.0',()=>console.log(`Easyspearfishing em http://0.0.0.0:${PORT}`));
