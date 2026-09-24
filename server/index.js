const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const TZ = 'Europe/Lisbon';

const spots = {
  'Foz do Douro': { lat: 41.148, lon: -8.675, exposure: 285, protection: 'aberta a W/NW' },
  'Castelo do Queijo': { lat: 41.169, lon: -8.689, exposure: 285, protection: 'aberta a W/NW' },
  'Matosinhos': { lat: 41.182, lon: -8.705, exposure: 290, protection: 'aberta a W/NW' },
  'Leça da Palmeira': { lat: 41.190, lon: -8.704, exposure: 295, protection: 'aberta a W/NW' },
  'Marreco': { lat: 41.235, lon: -8.724, exposure: 300, protection: 'aberta a W/NW' },
  'Perafita': { lat: 41.225, lon: -8.716, exposure: 300, protection: 'aberta a W/NW' },
  'Angeiras': { lat: 41.265, lon: -8.722, exposure: 300, protection: 'aberta a W/NW' },
  'Labruge': { lat: 41.280, lon: -8.716, exposure: 305, protection: 'aberta a W/NW' },
  'Mindelo': { lat: 41.316, lon: -8.724, exposure: 305, protection: 'aberta a W/NW' },
  'Azurara': { lat: 41.337, lon: -8.741, exposure: 300, protection: 'aberta a W/NW' },
  'Vila do Conde': { lat: 41.353, lon: -8.744, exposure: 300, protection: 'aberta a W/NW' },
  'Póvoa de Varzim': { lat: 41.381, lon: -8.765, exposure: 290, protection: 'aberta a W/NW' }
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function degToCompass(deg) {
  if (!Number.isFinite(Number(deg))) return '—';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(Number(deg) / 45) % 8];
}
function fmt(value, decimals = 1) { return Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '—'; }
function finite(x) { return Number.isFinite(Number(x)) ? Number(x) : null; }
function clamp(v, min=0, max=10) { return Math.max(min, Math.min(max, v)); }
function angleDiff(a,b) { return Math.abs(((a - b + 540) % 360) - 180); }

function relativeEnergy(wave, period) {
  if (!Number.isFinite(wave) || !Number.isFinite(period)) return null;
  // UI/score indicator only; not a physical measured kW/m value.
  return 0.49 * wave * wave * period;
}

function scoreComponent(name, score, weight, good, bad) {
  return { name, score: Number(score.toFixed(1)), weight, reason: score >= 8 ? good : bad };
}

function spearoScore({ wave, period, wind, gust, energy, swellDirection, waveDirection, spot, current, waterTemp }) {
  const c = [];
  const add = (name, score, weight, good, bad) => { if (Number.isFinite(score)) c.push(scoreComponent(name, clamp(score), weight, good, bad)); };

  if (Number.isFinite(wave)) {
    const s = wave <= 0.55 ? 8 : wave <= 0.85 ? 10 : wave <= 1.10 ? 9 : wave <= 1.35 ? 7.5 : wave <= 1.60 ? 5.5 : wave <= 2.0 ? 3 : 1;
    add('Onda', s, 25, 'altura de onda favorável', 'altura de onda aumenta a exigência');
  }
  if (Number.isFinite(period)) {
    const s = period < 5 ? 4 : period < 6.5 ? 7 : period <= 10.5 ? 10 : period <= 12 ? 8 : period <= 14 ? 6 : 4;
    add('Período', s, 10, 'período moderado/favorável', 'período elevado pode trazer sets mais potentes');
  }
  if (Number.isFinite(wind)) {
    const s = wind <= 5 ? 10 : wind <= 10 ? 9 : wind <= 15 ? 7 : wind <= 20 ? 5 : wind <= 28 ? 3 : 1;
    add('Vento', s, 15, 'vento fraco/moderado', 'vento aumenta a perturbação da superfície');
  }
  if (Number.isFinite(gust)) {
    const s = gust <= 10 ? 10 : gust <= 18 ? 9 : gust <= 25 ? 7 : gust <= 32 ? 5 : 2;
    add('Rajadas', s, 10, 'rajadas controladas', 'rajadas podem piorar a superfície');
  }
  if (Number.isFinite(energy)) {
    const s = energy <= 5 ? 10 : energy <= 8 ? 9 : energy <= 12 ? 7 : energy <= 16 ? 5 : energy <= 22 ? 3 : 1;
    add('Energia', s, 15, 'energia relativa baixa/moderada', 'energia relativa elevada');
  }
  const dir = Number.isFinite(swellDirection) ? swellDirection : waveDirection;
  if (Number.isFinite(dir) && spot) {
    const diff = angleDiff(dir, spot.exposure);
    const s = diff <= 25 ? 3.5 : diff <= 50 ? 5.5 : diff <= 80 ? 7.5 : diff <= 120 ? 9 : 10;
    add('Exposição ao swell', s, 10, 'swell chega mais oblíquo/protegido pelo ângulo', 'swell mais alinhado com a exposição costeira');
  }
  if (Number.isFinite(current)) {
    const s = current <= 0.15 ? 10 : current <= 0.30 ? 8 : current <= 0.50 ? 6 : current <= 0.80 ? 4 : 2;
    add('Corrente', s, 5, 'corrente modelada baixa', 'corrente modelada mais elevada');
  }
  if (Number.isFinite(waterTemp)) {
    const s = waterTemp >= 15 && waterTemp <= 19 ? 10 : waterTemp >= 13 && waterTemp < 15 ? 8 : waterTemp > 19 && waterTemp <= 21 ? 8 : 6;
    add('Água', s, 5, 'temperatura compatível com a época/equipamento', 'temperatura menos confortável');
  }
  if (!c.length) return null;
  const totalW = c.reduce((a,x)=>a+x.weight,0);
  const score = Number((c.reduce((a,x)=>a+x.score*x.weight,0)/totalW).toFixed(1));
  const sorted = c.slice().sort((a,b)=>a.score-b.score);
  const negatives = sorted.filter(x=>x.score<7).slice(0,3).map(x=>x.name);
  const positives = sorted.filter(x=>x.score>=8.5).slice(-3).map(x=>x.name);
  return { score, components:c, positives, negatives };
}

function classify(s) {
  if (s == null) return ['🟡','Dados insuficientes','Dados insuficientes para classificar.'];
  if (s >= 8.5) return ['🟢','Muito favorável','Condições modeladas favoráveis. Confirma sempre o estado real do mar antes de entrar.'];
  if (s >= 7) return ['🟡','Razoável','Há condições utilizáveis no modelo, mas podem existir limitações locais.'];
  if (s >= 5) return ['🟠','Exigente','Há fatores que podem dificultar a pesca; avalia localmente antes de entrar.'];
  return ['🔴','Desfavorável','O modelo indica condições exigentes; não uses este indicador isoladamente para decidir uma entrada.'];
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: {'User-Agent':'Easyspearfishing/0.3'} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function daylightForTime(time, daily) {
  const date = time.slice(0,10);
  const i = (daily.time||[]).indexOf(date);
  if (i < 0) return false;
  const sunrise = daily.sunrise?.[i];
  const sunset = daily.sunset?.[i];
  if (!sunrise || !sunset) return false;
  // Avoid the first/last 30 minutes of civil daylight in the automated window.
  const sr = new Date(`${sunrise}:00`).getTime() + 30*60000;
  const ss = new Date(`${sunset}:00`).getTime() - 30*60000;
  const t = new Date(`${time}:00`).getTime();
  return t >= sr && t <= ss;
}

function dayLabel(dateStr, todayStr) {
  if (dateStr === todayStr) return 'Hoje';
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat('pt-PT',{weekday:'short',day:'2-digit',month:'2-digit'}).format(d);
}

async function getSpotData(reqUrl) {
  const name = reqUrl.searchParams.get('name') || 'Spot';
  const incomingLat = finite(reqUrl.searchParams.get('lat'));
  const incomingLon = finite(reqUrl.searchParams.get('lon'));
  const meta = spots[name] || {lat:incomingLat, lon:incomingLon, exposure:300, protection:'exposição aproximada'};
  const {lat,lon} = meta;
  if (!Number.isFinite(lat)||!Number.isFinite(lon)) throw Object.assign(new Error('Coordenadas inválidas'),{statusCode:400});

  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&forecast_days=3&timezone=Europe%2FLisbon&cell_selection=sea`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,cloud_cover&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&daily=sunrise,sunset,precipitation_probability_max&forecast_days=3&timezone=Europe%2FLisbon`;
  const ipmaUrl = 'https://api.ipma.pt/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json';

  const [marine,weather,ipma] = await Promise.allSettled([fetchJson(marineUrl),fetchJson(weatherUrl),fetchJson(ipmaUrl)]);
  if (marine.status !== 'fulfilled') throw new Error(`Marine API: ${marine.reason?.message||'indisponível'}`);
  if (weather.status !== 'fulfilled') throw new Error(`Weather API: ${weather.reason?.message||'indisponível'}`);
  const m=marine.value,w=weather.value,ip=ipma.status==='fulfilled'?ipma.value:null;
  const mh=m.hourly||{}, wh=w.hourly||{};
  const n=Math.min((mh.time||[]).length,(wh.time||[]).length);
  const hourly=[];
  for(let i=0;i<n;i++){
    const wave=finite(mh.wave_height?.[i]), period=finite(mh.wave_period?.[i]), wind=finite(wh.wind_speed_10m?.[i]), gust=finite(wh.wind_gusts_10m?.[i]);
    const energy=relativeEnergy(wave,period);
    const ss=spearoScore({wave,period,wind,gust,energy,swellDirection:finite(mh.swell_wave_direction?.[i]),waveDirection:finite(mh.wave_direction?.[i]),spot:meta,current:finite(mh.ocean_current_velocity?.[i]),waterTemp:finite(mh.sea_surface_temperature?.[i])});
    const time=mh.time[i];
    hourly.push({time,wave,waveDirection:finite(mh.wave_direction?.[i]),period,peakPeriod:finite(mh.wave_peak_period?.[i]),swell:finite(mh.swell_wave_height?.[i]),swellDirection:finite(mh.swell_wave_direction?.[i]),swellPeriod:finite(mh.swell_wave_period?.[i]),wind,windDirection:finite(wh.wind_direction_10m?.[i]),gust,atmosphericVisibility:finite(wh.visibility?.[i]),precipitationProbability:finite(wh.precipitation_probability?.[i]),cloudCover:finite(wh.cloud_cover?.[i]),waterTemp:finite(mh.sea_surface_temperature?.[i]),tideLevel:finite(mh.sea_level_height_msl?.[i]),current:finite(mh.ocean_current_velocity?.[i]),currentDirection:finite(mh.ocean_current_direction?.[i]),energy,score:ss?.score??null,scoreReasons:ss?{positives:ss.positives,negatives:ss.negatives}:null,daylight:daylightForTime(time,w.daily||{})});
  }

  const current={wave:finite(m.current?.wave_height),waveDirection:finite(m.current?.wave_direction),period:finite(m.current?.wave_period),swell:finite(m.current?.swell_wave_height),swellDirection:finite(m.current?.swell_wave_direction),swellPeriod:finite(m.current?.swell_wave_period),waterTemp:finite(m.current?.sea_surface_temperature),tideLevel:finite(m.current?.sea_level_height_msl),current:finite(m.current?.ocean_current_velocity),currentDirection:finite(m.current?.ocean_current_direction),wind:finite(w.current?.wind_speed_10m),windDirection:finite(w.current?.wind_direction_10m),gust:finite(w.current?.wind_gusts_10m),atmosphericVisibility:finite(w.current?.visibility)};
  const energy=relativeEnergy(current.wave,current.period);
  const scoreData=spearoScore({...current,energy,spot:meta});
  const [statusEmoji,status,statusText]=classify(scoreData?.score??null);

  const today = (w.daily?.time||[])[0] || (hourly[0]?.time||'').slice(0,10);
  const daylightHours=hourly.filter(h=>h.daylight && h.score!=null);
  const best=daylightHours.slice().sort((a,b)=>b.score-a.score)[0]||null;
  const bestDayDate=best?.time?.slice(0,10)||null;
  const bestDayLabel=bestDayDate?dayLabel(bestDayDate,today):null;
  const sameDay=best && bestDayDate===today;
  const bestWindow = best ? `${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10` : 'Não calculada';

  // Find a simple 2-hour daylight window average around the best hour.
  let window=null;
  if(best){
    const idx=hourly.findIndex(h=>h.time===best.time);
    const candidate=hourly.slice(Math.max(0,idx-1),idx+2).filter(h=>h.daylight&&h.score!=null);
    if(candidate.length>=2){
      const avg=Number((candidate.reduce((a,h)=>a+h.score,0)/candidate.length).toFixed(1));
      window={start:candidate[0].time.slice(11,16),end:candidate[candidate.length-1].time.slice(11,16),score:avg};
    }
  }

  let ipmaRef=null, modelAgreement='Não disponível';
  if(ip){
    const ref=ip.data?.find(x=>Number(x.globalIdLocal)===1130826);
    if(ref){
      ipmaRef={waveMin:finite(ref.totalSeaMin),waveMax:finite(ref.totalSeaMax),periodMin:finite(ref.wavePeriodMin),periodMax:finite(ref.wavePeriodMax),direction:ref.predWaveDir,sstMin:finite(ref.sstMin),sstMax:finite(ref.sstMax),update:ip.dataUpdate};
      const waveOk=Number.isFinite(current.wave)&&current.wave>=ipmaRef.waveMin-0.25&&current.wave<=ipmaRef.waveMax+0.25;
      const dirOk=degToCompass(current.waveDirection)===ipmaRef.direction;
      const periodOk=Number.isFinite(current.period)&&current.period>=ipmaRef.periodMin-1&&current.period<=ipmaRef.periodMax+1;
      modelAgreement=(waveOk&&dirOk&&periodOk)?'Boa concordância':'Concordância parcial';
    }
  }

  const currentDay={sunrise:w.daily?.sunrise?.[0]||null,sunset:w.daily?.sunset?.[0]||null,rainMax:finite(w.daily?.precipitation_probability_max?.[0])};
  return {
    name,lat,lon,exposure:meta.exposure,exposureText:meta.protection,
    source:'Open-Meteo Marine + Open-Meteo Weather',sourceModel:'Open-Meteo marine forecast + weather forecast',
    score:scoreData?.score??null,scoreVersion:'Spearo Score 3.0',scoreComponents:scoreData?.components||[],scoreReasons:scoreData?{positives:scoreData.positives,negatives:scoreData.negatives}:{positives:[],negatives:[]},
    status,statusEmoji,statusText,
    decision:scoreData?.score>=8.5?'SIM':scoreData?.score>=7?'TALVEZ':scoreData?.score>=5?'EXIGENTE':'NÃO',
    wave:finite(current.wave)!=null?`${fmt(current.wave)} m`:'—',period:finite(current.period)!=null?`${fmt(current.period)} s`:'—',direction:degToCompass(current.waveDirection),waterTemp:finite(current.waterTemp)!=null?`${fmt(current.waterTemp)} °C`:'—',
    wind:finite(current.wind)!=null?`${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}`:'—',gust:finite(current.gust)!=null?`${fmt(current.gust)} km/h`:'—',energy:energy!=null?`~${fmt(energy)} (indicador relativo)`:'—',
    atmosphericVisibility:finite(current.atmosphericVisibility)!=null?`${(current.atmosphericVisibility/1000).toFixed(1)} km`:'Não disponível',underwaterVisibility:'Não disponível / não confirmada',
    swell:finite(current.swell)!=null?`${fmt(current.swell)} m`:'—',swellDirection:degToCompass(current.swellDirection),swellPeriod:finite(current.swellPeriod)!=null?`${fmt(current.swellPeriod)} s`:'—',
    tideLevel:finite(current.tideLevel)!=null?`${current.tideLevel.toFixed(2)} m MSL*`:'—',currentSpeed:finite(current.current)!=null?`${fmt(current.current)} km/h`:'—',currentDirection:degToCompass(current.currentDirection),
    daylight:{sunrise:currentDay.sunrise,sunset:currentDay.sunset,rainMax:currentDay.rainMax},bestWindow,bestWindowTime:best?.time||'',bestWindowShort:best?`${bestDayLabel} ${best.time.slice(11,16)} — ${best.score}/10`:'—',bestWindowAverage:window,
    modelAgreement,ipmaReference:ipmaRef,
    hourly:hourly.slice(0,72),
    note:'Spearo Score 3.0 é um indicador heurístico para pesca submarina de costa. O melhor horário é limitado a uma janela de luz diurna útil e exclui a noite. A exposição de cada spot é aproximada e transparente. A visibilidade subaquática não é estimada quando não existe medição fiável. Marés/correntes em modelos costeiros têm limitações; confirma sempre as condições observadas no local.'
  };
}

function serveStatic(res,pathname){
  const clean=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
  const filePath=path.resolve(PUBLIC_DIR,clean);
  if(!filePath.startsWith(path.resolve(PUBLIC_DIR))) return json(res,403,{error:'Acesso negado'});
  if(!fs.existsSync(filePath)||!fs.statSync(filePath).isFile()) return json(res,404,{error:'Ficheiro não encontrado'});
  const ext=path.extname(filePath); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'}); fs.createReadStream(filePath).pipe(res);
}

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,service:'Easyspearfishing',version:'0.3'});if(req.method==='GET'&&u.pathname==='/api/spot')return json(res,200,await getSpotData(u));if(req.method==='GET')return serveStatic(res,u.pathname);return json(res,405,{error:'Método não permitido'});}catch(e){console.error('Request error:',e);return json(res,e.statusCode||502,{error:e.message||'Erro interno'});}});
server.on('error',e=>{console.error('Server error:',e);process.exitCode=1;});
server.listen(PORT,'0.0.0.0',()=>console.log(`Easyspearfishing LIVE on 0.0.0.0:${PORT}`));
