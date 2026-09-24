const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, '../public');

const spots = {
  'Foz do Douro': [41.148, -8.675],
  'Castelo do Queijo': [41.169, -8.689],
  'Matosinhos': [41.182, -8.705],
  'Leça da Palmeira': [41.190, -8.704],
  'Marreco': [41.235, -8.724],
  'Perafita': [41.225, -8.716],
  'Angeiras': [41.265, -8.722],
  'Labruge': [41.280, -8.716],
  'Mindelo': [41.316, -8.724],
  'Azurara': [41.337, -8.741],
  'Vila do Conde': [41.353, -8.744],
  'Póvoa de Varzim': [41.381, -8.765]
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

function fmt(value, decimals = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '—';
}

function calcEnergy(wave, period) {
  if (!Number.isFinite(wave) || !Number.isFinite(period)) return null;
  // Provisional relative energy indicator for UI/score only. Not a physical kW/m measurement.
  return 0.49 * wave * wave * period;
}

function clamp(v, min=0, max=10) { return Math.max(min, Math.min(max, v)); }

// Spearo Score 2.0 — heuristic specifically for shore-based spearfishing conditions.
// It is an indicator, not a safety certification. Underwater visibility is NOT scored
// because the available APIs do not provide a trustworthy in-water visibility value.
function spearoScore({wave, period, wind, gust, energy, swellDirection, spot, current, waterTemp}) {
  const parts = [];
  let total = 0;
  let weight = 0;
  const add = (name, value, w, reasonGood, reasonBad) => {
    if (!Number.isFinite(value)) return;
    total += value * w; weight += w;
    parts.push({name, value, weight:w, reason: value >= 7 ? reasonGood : reasonBad});
  };

  // Wave height: moderate shore conditions score higher than large surf.
  let waveScore = 10;
  if (wave == null) waveScore = null;
  else if (wave <= 0.55) waveScore = 8.0;
  else if (wave <= 0.85) waveScore = 10;
  else if (wave <= 1.10) waveScore = 9.0;
  else if (wave <= 1.35) waveScore = 7.5;
  else if (wave <= 1.60) waveScore = 5.5;
  else if (wave <= 2.00) waveScore = 3.0;
  else waveScore = 1.0;
  add('Onda', waveScore, 25, 'altura de onda dentro de uma faixa favorável', 'altura de onda aumenta a exigência');

  // Period: moderate period is preferred; very long periods can carry more power to shore.
  let periodScore = period == null ? null : period < 5 ? 4 : period < 6.5 ? 7 : period <= 10.5 ? 10 : period <= 12 ? 8 : period <= 14 ? 6 : 4;
  add('Período', periodScore, 10, 'período moderado/favorável', 'período elevado pode trazer sets mais potentes');

  // Wind: lighter wind generally means cleaner surface conditions.
  let windScore = wind == null ? null : wind <= 5 ? 10 : wind <= 10 ? 9 : wind <= 15 ? 7 : wind <= 20 ? 5 : wind <= 28 ? 3 : 1;
  add('Vento', windScore, 15, 'vento fraco/moderado', 'vento aumenta a perturbação da superfície');

  let gustScore = gust == null ? null : gust <= 10 ? 10 : gust <= 18 ? 9 : gust <= 25 ? 7 : gust <= 32 ? 5 : 2;
  add('Rajadas', gustScore, 10, 'rajadas controladas', 'rajadas podem piorar rapidamente a superfície');

  let energyScore = energy == null ? null : energy <= 5 ? 10 : energy <= 8 ? 9 : energy <= 12 ? 7 : energy <= 16 ? 5 : energy <= 22 ? 3 : 1;
  add('Energia', energyScore, 15, 'energia relativa baixa/moderada', 'energia relativa elevada');

  // Spot-specific exposure is deliberately explicit and approximate.
  if (Number.isFinite(swellDirection) && spot?.exposure != null) {
    const diff = Math.abs(((swellDirection - spot.exposure + 540) % 360) - 180);
    let dirScore = diff <= 35 ? 5 : diff <= 70 ? 7.5 : diff <= 110 ? 9 : 6.5;
    // For shore spearfishing, a swell arriving close to the beach normal is generally more exposed;
    // the model therefore rewards oblique/off-axis swell rather than directly-onshore swell.
    add('Direção do swell', dirScore, 10, 'swell relativamente oblíquo à exposição do spot', 'swell mais alinhado com a exposição do spot');
  }

  if (Number.isFinite(current)) {
    let currentScore = current <= 0.15 ? 10 : current <= 0.30 ? 8 : current <= 0.50 ? 6 : current <= 0.80 ? 4 : 2;
    add('Corrente', currentScore, 10, 'corrente modelada baixa/moderada', 'corrente modelada elevada');
  }

  if (Number.isFinite(waterTemp)) {
    // Water temperature has a small weight: comfort/equipment relevance, not safety.
    let tempScore = waterTemp >= 15 && waterTemp <= 19 ? 10 : waterTemp >= 13 && waterTemp < 15 ? 8 : waterTemp > 19 && waterTemp <= 21 ? 8 : 6;
    add('Água', tempScore, 5, 'temperatura dentro da faixa habitual do spot', 'temperatura menos confortável para a época');
  }

  if (!weight) return null;
  const score = Number((total / weight).toFixed(1));
  const sorted = parts.slice().sort((a,b)=>a.value-b.value);
  const negatives = sorted.filter(p=>p.value < 7).slice(0,3).map(p=>p.name);
  const positives = sorted.filter(p=>p.value >= 8.5).slice(-3).map(p=>p.name);
  return {score, negatives, positives, components:parts};
}

function classify(s) {
  if (s == null) return ['🟡', 'Dados insuficientes', 'Não há dados suficientes para classificar.'];
  if (s >= 8.5) return ['🟢', 'Condições favoráveis', 'Condições modeladas favoráveis; confirma sempre o estado real do mar antes de entrar.'];
  if (s >= 7) return ['🟡', 'Condições razoáveis', 'Pode existir uma janela melhor; confirma o mar e a visibilidade local.'];
  if (s >= 5) return ['🟠', 'Condições exigentes', 'O modelo indica fatores que podem dificultar a pesca; avalia localmente antes de entrar.'];
  return ['🔴', 'Condições muito exigentes', 'O modelo indica mar/vento/corrente exigentes; não uses este indicador sozinho para decidir uma entrada.'];
}


async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Easyspearfishing/0.2.1' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function spotExposure(name) {
  // Approximate shoreline/exposure bearings used only as a transparent heuristic.
  // They should be refined later with mapped coastline orientation for each exact entry point.
  const map = {
    'Foz do Douro': 285, 'Castelo do Queijo': 285, 'Matosinhos': 290, 'Leça da Palmeira': 295,
    'Marreco': 300, 'Perafita': 300, 'Angeiras': 300, 'Labruge': 305,
    'Mindelo': 305, 'Azurara': 300, 'Vila do Conde': 300, 'Póvoa de Varzim': 295
  };
  return map[name] ?? 300;
}

async function getSpotData(reqUrl) {
  const name = reqUrl.searchParams.get('name') || 'Spot';
  const latParam = Number(reqUrl.searchParams.get('lat'));
  const lonParam = Number(reqUrl.searchParams.get('lon'));
  const coords = spots[name] || [latParam, lonParam];
  const [lat, lon] = coords;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw Object.assign(new Error('Coordenadas inválidas'), { statusCode: 400 });
  }

  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction&forecast_days=3&timezone=Europe%2FLisbon&cell_selection=sea`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,cloud_cover&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&forecast_days=3&timezone=Europe%2FLisbon`;

  const [marine, weather] = await Promise.all([fetchJson(marineUrl), fetchJson(weatherUrl)]);
  const mh = marine.hourly || {};
  const wh = weather.hourly || {};
  const n = Math.min((mh.time || []).length, (wh.time || []).length);
  const hourly = [];

  for (let i = 0; i < n; i++) {
    const wave = Number(mh.wave_height?.[i]);
    const period = Number(mh.wave_period?.[i]);
    const wind = Number(wh.wind_speed_10m?.[i]);
    const gust = Number(wh.wind_gusts_10m?.[i]);
    const atmosphericVisibility = Number(wh.visibility?.[i]);
    const energy = calcEnergy(wave, period);
    const ss = spearoScore({wave, period, wind, gust, energy, swellDirection: Number(mh.swell_wave_direction?.[i]), spot: {exposure: spotExposure(name)}, current: Number(mh.ocean_current_velocity?.[i]), waterTemp: Number(mh.sea_surface_temperature?.[i])});
    hourly.push({
      time: mh.time[i],
      wave: Number.isFinite(wave) ? wave : null,
      waveDirection: Number(mh.wave_direction?.[i]),
      period: Number.isFinite(period) ? period : null,
      peakPeriod: Number(mh.wave_peak_period?.[i]),
      swell: Number(mh.swell_wave_height?.[i]),
      swellDirection: Number(mh.swell_wave_direction?.[i]),
      swellPeriod: Number(mh.swell_wave_period?.[i]),
      wind: Number.isFinite(wind) ? wind : null,
      windDirection: Number(wh.wind_direction_10m?.[i]),
      gust: Number.isFinite(gust) ? gust : null,
      atmosphericVisibility: Number.isFinite(atmosphericVisibility) ? atmosphericVisibility : null,
      waterTemp: Number(mh.sea_surface_temperature?.[i]),
      tideLevel: Number(mh.sea_level_height_msl?.[i]),
      current: Number(mh.ocean_current_velocity?.[i]),
      currentDirection: Number(mh.ocean_current_direction?.[i]),
      energy,
      score: ss ? ss.score : null, scoreReasons: ss ? {positives:ss.positives, negatives:ss.negatives} : null
    });
  }

  const current = {
    wave: Number(marine.current?.wave_height),
    waveDirection: Number(marine.current?.wave_direction),
    period: Number(marine.current?.wave_period),
    swell: Number(marine.current?.swell_wave_height),
    swellDirection: Number(marine.current?.swell_wave_direction),
    swellPeriod: Number(marine.current?.swell_wave_period),
    waterTemp: Number(marine.current?.sea_surface_temperature),
    tideLevel: Number(marine.current?.sea_level_height_msl),
    current: Number(marine.current?.ocean_current_velocity),
    currentDirection: Number(marine.current?.ocean_current_direction),
    wind: Number(weather.current?.wind_speed_10m),
    windDirection: Number(weather.current?.wind_direction_10m),
    gust: Number(weather.current?.wind_gusts_10m),
    atmosphericVisibility: Number(weather.current?.visibility)
  };

  const energy = calcEnergy(current.wave, current.period);
  const scoreData = spearoScore({ wave: current.wave, period: current.period, wind: current.wind, gust: current.gust, energy, swellDirection: current.swellDirection, spot: {exposure: spotExposure(name)}, current: current.current, waterTemp: current.waterTemp });
  const s = scoreData ? scoreData.score : null;
  const [statusEmoji, status, statusText] = classify(s);
  const first24 = hourly.slice(0, 24);
  const best = first24.filter(h => h.score != null).sort((a, b) => b.score - a.score)[0] || null;

  return {
    name, lat, lon,
    source: 'Open-Meteo Marine + Open-Meteo Weather',
    modelNote: 'Ondulação e variáveis oceânicas por modelos marinhos; vento/rajadas por previsão meteorológica. Resolução marinha nominal ~5–8 km consoante o modelo/camada.',
    score: s,
    scoreVersion: 'Spearo Score 2.0',
    scoreComponents: scoreData ? scoreData.components : [],
    scoreReasons: scoreData ? { positives: scoreData.positives, negatives: scoreData.negatives } : {positives:[], negatives:[]},
    status, statusEmoji, statusText,
    wave: Number.isFinite(current.wave) ? `${fmt(current.wave)} m` : '—',
    period: Number.isFinite(current.period) ? `${fmt(current.period)} s` : '—',
    direction: degToCompass(current.waveDirection),
    waterTemp: Number.isFinite(current.waterTemp) ? `${fmt(current.waterTemp)} °C` : '—',
    wind: Number.isFinite(current.wind) ? `${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}` : '—',
    gust: Number.isFinite(current.gust) ? `${fmt(current.gust)} km/h` : '—',
    energy: Number.isFinite(energy) ? `~${fmt(energy)} (indicador relativo)` : '—',
    atmosphericVisibility: Number.isFinite(current.atmosphericVisibility) ? `${(current.atmosphericVisibility / 1000).toFixed(1)} km` : 'Não disponível',
    underwaterVisibility: 'Não disponível / não confirmada',
    swell: Number.isFinite(current.swell) ? `${fmt(current.swell)} m` : '—',
    swellDirection: degToCompass(current.swellDirection),
    swellPeriod: Number.isFinite(current.swellPeriod) ? `${fmt(current.swellPeriod)} s` : '—',
    tideLevel: Number.isFinite(current.tideLevel) ? `${current.tideLevel.toFixed(2)} m MSL*` : '—',
    currentSpeed: Number.isFinite(current.current) ? `${fmt(current.current)} km/h` : '—',
    currentDirection: degToCompass(current.currentDirection),
    bestWindow: best ? `${best.time.slice(11,16)} — score ${best.score}/10` : 'Não calculado',
    bestWindowTime: best ? best.time : '',
    bestWindowShort: best ? `${best.time.slice(11,16)} — ${best.score}/10` : '—',
    hourly: first24,
    note: 'Spearo Score 2.0: indicador heurístico para pesca submarina de costa, combinando onda, período, vento, rajadas, energia relativa, direção do swell, corrente e temperatura. A exposição de cada spot é aproximada e deve ser refinada. A visibilidade subaquática não é pontuada porque não há medição fiável disponível nesta API. Não é uma certificação de segurança.'
  };
}

function serveStatic(res, pathname) {
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Acesso negado' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(res, 404, { error: 'Ficheiro não encontrado' });
  const ext = path.extname(filePath);
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'Easyspearfishing' });
    if (req.method === 'GET' && url.pathname === '/api/spot') {
      const data = await getSpotData(url);
      return json(res, 200, data);
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    return json(res, 405, { error: 'Método não permitido' });
  } catch (e) {
    console.error('Request error:', e);
    return json(res, e.statusCode || 502, { error: e.message || 'Erro interno' });
  }
});

server.on('error', err => {
  console.error('Server error:', err);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Easyspearfishing LIVE on 0.0.0.0:${PORT}`);
});
