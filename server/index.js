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

function score(wave, period, wind, gust, energy) {
  if (![wave, period, wind, gust].every(Number.isFinite)) return null;
  let s = 10;
  if (wave > 0.7) s -= Math.min(4, (wave - 0.7) * 3.0);
  if (wave > 1.5) s -= 1.5;
  if (wave > 2.0) s -= 2.0;
  if (period < 5) s -= 0.5;
  if (period > 12) s -= 0.3;
  if (wind > 8) s -= Math.min(2.5, (wind - 8) * 0.18);
  if (gust > 18) s -= Math.min(1.5, (gust - 18) * 0.12);
  if (gust > 28) s -= 1.0;
  if (Number.isFinite(energy)) {
    if (energy > 15) s -= Math.min(2.0, (energy - 15) * 0.10);
    if (energy > 25) s -= 1.5;
  }
  return Math.max(0, Math.min(10, Number(s.toFixed(1))));
}

function classify(s) {
  if (s == null) return ['🟡', 'Sem classificação'];
  if (s >= 8.5) return ['🟢', 'Condições favoráveis'];
  if (s >= 7) return ['🟡', 'Condições razoáveis'];
  if (s >= 5) return ['🟠', 'Exige atenção'];
  return ['🔴', 'Mar exigente'];
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
      score: score(wave, period, wind, gust, energy)
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
  const s = score(current.wave, current.period, current.wind, current.gust, energy);
  const [statusEmoji, status] = classify(s);
  const first24 = hourly.slice(0, 24);
  const best = first24.filter(h => h.score != null).sort((a, b) => b.score - a.score)[0] || null;

  return {
    name, lat, lon,
    source: 'Open-Meteo Marine + Open-Meteo Weather',
    modelNote: 'Ondulação e variáveis oceânicas por modelos marinhos; vento/rajadas por previsão meteorológica. Resolução marinha nominal ~5–8 km consoante o modelo/camada.',
    score: s,
    status, statusEmoji,
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
    note: 'Score provisório para apoio à decisão, baseado em altura/período da onda, vento, rajadas e um indicador relativo de energia. Não é uma certificação de segurança. A visibilidade atmosférica não representa visibilidade subaquática.'
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
