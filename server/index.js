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
const VERSION = '1.0.0';

const spots = {
  'Foz do Douro': { lat: 41.148, lon: -8.675, exposure: 285, protection: 'aberta a W/NW', camera: { label: 'Beachcam Foz / Porto', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Castelo do Queijo': { lat: 41.169, lon: -8.689, exposure: 285, protection: 'aberta a W/NW', camera: { label: 'Beachcam Matosinhos', url: 'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/' } },
  'Matosinhos': { lat: 41.182, lon: -8.705, exposure: 290, protection: 'aberta a W/NW', camera: { label: 'Beachcam Matosinhos', url: 'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/' } },
  'Leça da Palmeira': { lat: 41.190, lon: -8.704, exposure: 295, protection: 'aberta a W/NW', camera: { label: 'Beachcam Leça da Palmeira', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira/' }, camera2: { label: 'Beachcam Leça panorâmica / Aterro', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira-panoraminca-aterro/' }, ipmaCamera: { label: 'IPMA Livecam Leça', url: 'https://www.ipma.pt/pt/maritima/costeira/index.jsp?idLocal=2&selLocal=2' } },
  'Marreco': { lat: 41.235, lon: -8.724, exposure: 300, protection: 'aberta a W/NW', camera: { label: 'Beachcam Leça / Matosinhos', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Perafita': { lat: 41.225, lon: -8.716, exposure: 300, protection: 'aberta a W/NW', camera: { label: 'Beachcam Leça da Palmeira', url: 'https://back-office.beachcam.pt/livecams/leca-da-palmeira/' } },
  'Angeiras': { lat: 41.265, lon: -8.722, exposure: 300, protection: 'aberta a W/NW', camera: { label: 'Beachcam Leça / Matosinhos', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Labruge': { lat: 41.280, lon: -8.716, exposure: 305, protection: 'aberta a W/NW', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Mindelo': { lat: 41.316, lon: -8.724, exposure: 305, protection: 'aberta a W/NW', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Azurara': { lat: 41.337, lon: -8.741, exposure: 300, protection: 'aberta a W/NW', camera: { label: 'Beachcam Caxinas', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Vila do Conde': { lat: 41.353, lon: -8.744, exposure: 300, protection: 'aberta a W/NW', camera: { label: 'Beachcam Caxinas', url: 'https://back-office.beachcam.pt/livecams/' } },
  'Póvoa de Varzim': { lat: 41.381, lon: -8.765, exposure: 290, protection: 'aberta a W/NW', camera: { label: 'Beachcam Caxinas / Vila do Conde', url: 'https://back-office.beachcam.pt/livecams/' } }
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
  const marineUrl=batchUrl('https://marine-api.open-meteo.com/v1/marine',{
    latitude:LATITUDES, longitude:LONGITUDES,
    hourly:'wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction',
    current:'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction',
    past_days:'3', forecast_days:'7', timezone:TZ, cell_selection:'sea'
  });
  const weatherUrl=batchUrl('https://api.open-meteo.com/v1/forecast',{
    latitude:LATITUDES, longitude:LONGITUDES,
    hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,precipitation,cloud_cover',
    current:'wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility',
    daily:'sunrise,sunset,precipitation_probability_max',
    past_days:'3', forecast_days:'7', timezone:TZ
  });
  const ipmaUrl='https://api.ipma.pt/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json';
  const results=await Promise.allSettled([
    fetchJson(marineUrl,18000),
    fetchJson(weatherUrl,18000),
    fetchJson(ipmaUrl,12000)
  ]);
  const marine=results[0], weather=results[1], ipma=results[2];
  if(marine.status!=='fulfilled' || weather.status!=='fulfilled'){
    const err=new Error(`Fontes externas indisponíveis — Marine: ${marine.status==='fulfilled'?'OK':marine.reason?.message||'erro'}; Weather: ${weather.status==='fulfilled'?'OK':weather.reason?.message||'erro'}`);
    err.statusCode=502; throw err;
  }
  return {marine:marine.value, weather:weather.value, ipma:ipma.status==='fulfilled'?ipma.value:null};
}

function asLocationArray(payload){
  if(Array.isArray(payload)) return payload;
  return [payload];
}

function findLocationPayload(arr, spot, index){
  return arr.find(x => Math.abs(Number(x.latitude)-spot.lat)<0.02 && Math.abs(Number(x.longitude)-spot.lon)<0.02) || arr[index] || null;
}

async function getAllForecast(){
  const now=Date.now();
  if(forecastCache && now-forecastCache.time<CACHE_TTL_MS) return forecastCache.data;
  if(forecastInFlight) return forecastInFlight;
  forecastInFlight=(async()=>{
    const src=await fetchAllSources();
    const marineArr=asLocationArray(src.marine);
    const weatherArr=asLocationArray(src.weather);
    const spotsOut=SPOT_LIST.map((spot,i)=>{
      const m=findLocationPayload(marineArr,spot,i);
      const w=findLocationPayload(weatherArr,spot,i);
      if(!m || !w) throw Object.assign(new Error(`Não foi possível associar os dados ao spot ${spot.name}`),{statusCode:502});
      return buildSpotDataFromPayload(spot.name,spot,m,w,src.ipma);
    });
    const data={version:VERSION,updatedAt:new Date().toISOString(),count:spotsOut.length,spots:spotsOut};
    forecastCache={time:Date.now(),data};
    return data;
  })().finally(()=>{forecastInFlight=null;});
  return forecastInFlight;
}

function buildSpotDataFromPayload(name,s,m,w,ip){
  const {lat,lon}=s;
  const mh=m?.hourly||{}; const wh=w?.hourly||{}; if(!m || !w) throw Object.assign(new Error('Dados completos de Marine + Weather não disponíveis'),{statusCode:502}); const n=Math.min((mh.time||[]).length,(wh.time||[]).length); const hourly=[];
  for(let i=0;i<n;i++){
    const wave=finite(mh.wave_height?.[i]),period=finite(mh.wave_period?.[i]),wind=finite(wh.wind_speed_10m?.[i]),gust=finite(wh.wind_gusts_10m?.[i]),energy=relativeEnergy(wave,period); const vis=estimateVisibilityAt(i,mh,wh,s); const ss=baseSpearoScore({wave,period,wind,gust,energy,swellDirection:finite(mh.swell_wave_direction?.[i]),waveDirection:finite(mh.wave_direction?.[i]),spot:s,current:finite(mh.ocean_current_velocity?.[i]),waterTemp:finite(mh.sea_surface_temperature?.[i]),visibilityScore:vis.score}); const time=mh.time[i];
    hourly.push({time,wave,waveDirection:finite(mh.wave_direction?.[i]),period,peakPeriod:finite(mh.wave_peak_period?.[i]),swell:finite(mh.swell_wave_height?.[i]),swellDirection:finite(mh.swell_wave_direction?.[i]),swellPeriod:finite(mh.swell_wave_period?.[i]),wind,windDirection:finite(wh.wind_direction_10m?.[i]),gust,atmosphericVisibility:finite(wh.visibility?.[i]),precipitationProbability:finite(wh.precipitation_probability?.[i]),precipitation:finite(wh.precipitation?.[i]),cloudCover:finite(wh.cloud_cover?.[i]),waterTemp:finite(mh.sea_surface_temperature?.[i]),tideLevel:finite(mh.sea_level_height_msl?.[i]),current:finite(mh.ocean_current_velocity?.[i]),currentDirection:finite(mh.ocean_current_direction?.[i]),energy,visibility:vis,score:ss?.score??null,daylight:daylightForTime(time,w.daily||{})});
  }
  const future=hourly.filter(h=>new Date(h.time)>=new Date() && h.score!=null); const currentIndex=Math.max(0,hourly.findIndex(h=>h.time>=(m.current?.time||hourly.find(h=>h.time)?.time))); const ci=currentIndex>=0?currentIndex:Math.min(72,hourly.length-1); const currentH=hourly[ci]||hourly.find(h=>h.daylight)||hourly[0];
  const current={wave:finite(m.current?.wave_height),waveDirection:finite(m.current?.wave_direction),period:finite(m.current?.wave_period),swell:finite(m.current?.swell_wave_height),swellDirection:finite(m.current?.swell_wave_direction),swellPeriod:finite(m.current?.swell_wave_period),waterTemp:finite(m.current?.sea_surface_temperature),tideLevel:finite(m.current?.sea_level_height_msl),current:finite(m.current?.ocean_current_velocity),currentDirection:finite(m.current?.ocean_current_direction),wind:finite(w.current?.wind_speed_10m),windDirection:finite(w.current?.wind_direction_10m),gust:finite(w.current?.wind_gusts_10m),atmosphericVisibility:finite(w.current?.visibility)};
  const currentVis=currentH?.visibility||estimateVisibilityAt(ci,mh,wh,s); const energy=relativeEnergy(current.wave,current.period); const scoreData=baseSpearoScore({...current,energy,spot:s,visibilityScore:currentVis.score}); const [statusEmoji,status,statusText]=classify(scoreData?.score??null);
  const today=(w.daily?.time||[])[0]||(hourly[0]?.time||'').slice(0,10); const daylightFuture=future.filter(h=>h.daylight&&h.score!=null); const best=daylightFuture.slice().sort((a,b)=>b.score-a.score)[0]||null; const bestDayDate=best?.time?.slice(0,10)||null; const bestDayLabel=bestDayDate?dayLabel(bestDayDate,today):null; const bestWindow=best?`${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10`:'Não calculada';
  let window=null;if(best){const idx=hourly.findIndex(h=>h.time===best.time);const candidate=hourly.slice(Math.max(0,idx-1),idx+2).filter(h=>h.daylight&&h.score!=null);if(candidate.length>=2){window={start:candidate[0].time.slice(11,16),end:candidate[candidate.length-1].time.slice(11,16),score:Number((candidate.reduce((a,h)=>a+h.score,0)/candidate.length).toFixed(1))};}}
  let ipmaRef=null,modelAgreement='Não disponível'; if(ip){const ipRows=Array.isArray(ip)?ip:(ip.data||[]); const ref=ipRows.find(x=>Number(x.globalIdLocal)===1130826);if(ref){ipmaRef={waveMin:finite(ref.totalSeaMin),waveMax:finite(ref.totalSeaMax),periodMin:finite(ref.wavePeriodMin),periodMax:finite(ref.wavePeriodMax),direction:ref.predWaveDir,sstMin:finite(ref.sstMin),sstMax:finite(ref.sstMax),update:ip.dataUpdate};const waveOk=Number.isFinite(current.wave)&&current.wave>=ipmaRef.waveMin-.25&&current.wave<=ipmaRef.waveMax+.25;const dirOk=degToCompass(current.waveDirection)===ipmaRef.direction;const periodOk=Number.isFinite(current.period)&&current.period>=ipmaRef.periodMin-1&&current.period<=ipmaRef.periodMax+1;modelAgreement=waveOk&&dirOk&&periodOk?'Boa concordância':'Concordância parcial';}}
  const daily=(w.daily?.time||[]).filter(date=>date>=today).slice(0,7).map((date,i)=>{const rows=hourly.filter(h=>h.time.startsWith(date)&&h.score!=null&&h.daylight);if(!rows.length)return {date,label:dayLabel(date,today),bestScore:null,bestTime:null,minWave:null,maxWave:null,minWind:null,maxWind:null,minVisibility:null,maxVisibility:null,trend:null};const bestDay=rows.slice().sort((a,b)=>b.score-a.score)[0];const vv=rows.map(r=>r.visibility?.meters).filter(Number.isFinite);return {date,label:dayLabel(date,today),bestScore:bestDay.score,bestTime:bestDay.time.slice(11,16),minWave:Math.min(...rows.map(r=>r.wave).filter(Number.isFinite)),maxWave:Math.max(...rows.map(r=>r.wave).filter(Number.isFinite)),minWind:Math.min(...rows.map(r=>r.wind).filter(Number.isFinite)),maxWind:Math.max(...rows.map(r=>r.wind).filter(Number.isFinite)),minVisibility:vv.length?Math.min(...vv):null,maxVisibility:vv.length?Math.max(...vv):null,trend:bestDay.visibility?.trend||null};});
  const cameraLinks=[s.camera,s.camera2,s.ipmaCamera].filter(Boolean); const satellite=satelliteInfo();
  return {version:VERSION,name,lat,lon,exposure:s.exposure,exposureText:s.protection,score:scoreData?.score??null,scoreVersion:'Spearo Score 4.0',scoreComponents:scoreData?.components||[],scoreReasons:scoreData?{positives:scoreData.positives,negatives:scoreData.negatives}:{positives:[],negatives:[]},status,statusEmoji,statusText,decision:scoreData?.score>=8.5?'SIM':scoreData?.score>=7?'TALVEZ':scoreData?.score>=5?'EXIGENTE':'NÃO',wave:finite(current.wave)!=null?`${fmt(current.wave)} m`:'—',period:finite(current.period)!=null?`${fmt(current.period)} s`:'—',direction:degToCompass(current.waveDirection),waterTemp:finite(current.waterTemp)!=null?`${fmt(current.waterTemp)} °C`:'—',wind:finite(current.wind)!=null?`${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}`:'—',gust:finite(current.gust)!=null?`${fmt(current.gust)} km/h`:'—',energy:energy!=null?`~${fmt(energy)} (indicador relativo)`:'—',atmosphericVisibility:finite(current.atmosphericVisibility)!=null?`${(current.atmosphericVisibility/1000).toFixed(1)} km`:'Não disponível',underwaterVisibility:currentVis.meters!=null?`${currentVis.label} provável`:'Sem estimativa confiável',visibility:currentVis,swell:finite(current.swell)!=null?`${fmt(current.swell)} m`:'—',swellDirection:degToCompass(current.swellDirection),swellPeriod:finite(current.swellPeriod)!=null?`${fmt(current.swellPeriod)} s`:'—',tideLevel:finite(current.tideLevel)!=null?`${current.tideLevel.toFixed(2)} m MSL*`:'—',currentSpeed:finite(current.current)!=null?`${fmt(current.current)} km/h`:'—',currentDirection:degToCompass(current.currentDirection),daylight:{sunrise:w.daily?.sunrise?.[0]||null,sunset:w.daily?.sunset?.[0]||null,rainMax:finite(w.daily?.precipitation_probability_max?.[0])},bestWindow,bestWindowTime:best?.time||'',bestWindowShort:best?`${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10`:'—',bestWindowAverage:window,modelAgreement,ipmaReference:ipmaRef,cameras:cameraLinks,satellite,daily,hourly:hourly.filter(h=>new Date(h.time)>=new Date()).slice(0,168),updatedAt:new Date().toISOString(),note:'A visibilidade subaquática é uma estimativa heurística baseada na energia recente do mar, exposição à ondulação/vento e chuva como proxy de suspensão. Não é uma medição direta. A integração Copernicus de turbidez/SPM é a próxima camada quando forem configuradas credenciais; não são inventados valores de satélite.'};
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
