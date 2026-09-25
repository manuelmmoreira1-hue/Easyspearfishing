const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '1.0-completo';

app.use(express.static(path.join(__dirname, '../public')));

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

const names = Object.keys(spots);
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

function degToCompass(deg) {
  if (!Number.isFinite(deg)) return '—';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function fmt(value, decimals = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '—';
}

function calcEnergy(wave, period) {
  if (!Number.isFinite(wave) || !Number.isFinite(period)) return null;
  return 0.49 * wave * wave * period;
}

/* Mantém a lógica que já tínhamos: indicador de apoio, não certificação de segurança. */
function score(wave, period, wind, visibility) {
  if (![wave, period, wind].every(Number.isFinite)) return null;
  let s = 10;
  if (wave > 0.7) s -= Math.min(4, (wave - 0.7) * 3.0);
  if (wave > 1.5) s -= 1.5;
  if (wave > 2.0) s -= 2.0;
  if (period < 5) s -= 0.5;
  if (period > 12) s -= 0.3;
  if (wind > 8) s -= Math.min(2.5, (wind - 8) * 0.18);
  if (wind > 18) s -= 1.5;
  if (Number.isFinite(visibility) && visibility < 3000) s -= 0.5;
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
      headers: { 'User-Agent': 'Easyspearfishing/1.0' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildUrls() {
  const latitudes = names.map(n => spots[n][0]).join(',');
  const longitudes = names.map(n => spots[n][1]).join(',');
  const common = `latitude=${latitudes}&longitude=${longitudes}&forecast_days=3&timezone=Europe%2FLisbon&cell_selection=sea`;

  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?${common}` +
    `&hourly=wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction` +
    `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction`;

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?${common}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,cloud_cover` +
    `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility`;

  return { marineUrl, weatherUrl };
}

function oneNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function makeSpot(name, marine, weather) {
  const mh = marine?.hourly || {};
  const wh = weather?.hourly || {};
  const current = {
    wave: oneNumber(marine?.current?.wave_height),
    waveDirection: oneNumber(marine?.current?.wave_direction),
    period: oneNumber(marine?.current?.wave_period),
    swell: oneNumber(marine?.current?.swell_wave_height),
    swellDirection: oneNumber(marine?.current?.swell_wave_direction),
    swellPeriod: oneNumber(marine?.current?.swell_wave_period),
    waterTemp: oneNumber(marine?.current?.sea_surface_temperature),
    tideLevel: oneNumber(marine?.current?.sea_level_height_msl),
    current: oneNumber(marine?.current?.ocean_current_velocity),
    currentDirection: oneNumber(marine?.current?.ocean_current_direction),
    wind: oneNumber(weather?.current?.wind_speed_10m),
    windDirection: oneNumber(weather?.current?.wind_direction_10m),
    gust: oneNumber(weather?.current?.wind_gusts_10m),
    visibility: oneNumber(weather?.current?.visibility)
  };

  const times = mh.time || [];
  const hourly = [];
  const n = Math.min(times.length, (wh.time || []).length);

  for (let i = 0; i < n; i++) {
    const wave = oneNumber(mh.wave_height?.[i]);
    const period = oneNumber(mh.wave_period?.[i]);
    const wind = oneNumber(wh.wind_speed_10m?.[i]);
    const gust = oneNumber(wh.wind_gusts_10m?.[i]);
    const visibility = oneNumber(wh.visibility?.[i]);
    const e = calcEnergy(wave, period);
    const hScore = score(wave, period, wind, visibility);

    hourly.push({
      time: times[i],
      wave,
      waveDirection: oneNumber(mh.wave_direction?.[i]),
      period,
      peakPeriod: oneNumber(mh.wave_peak_period?.[i]),
      swell: oneNumber(mh.swell_wave_height?.[i]),
      swellDirection: oneNumber(mh.swell_wave_direction?.[i]),
      swellPeriod: oneNumber(mh.swell_wave_period?.[i]),
      wind,
      windDirection: oneNumber(wh.wind_direction_10m?.[i]),
      gust,
      visibility,
      atmosphericVisibility: visibility,
      waterTemp: oneNumber(mh.sea_surface_temperature?.[i]),
      tideLevel: oneNumber(mh.sea_level_height_msl?.[i]),
      current: oneNumber(mh.ocean_current_velocity?.[i]),
      currentDirection: oneNumber(mh.ocean_current_direction?.[i]),
      energy: e,
      score: hScore
    });
  }

  const currentScore = score(current.wave, current.period, current.wind, current.visibility);
  const [statusEmoji, status] = classify(currentScore);
  const next24 = hourly.slice(0, 24).filter(h => h.score != null);
  const best = next24.reduce((a, b) => (!a || b.score > a.score ? b : a), null);

  return {
    name,
    lat: spots[name][0],
    lon: spots[name][1],
    source: 'Open-Meteo Marine + Open-Meteo Weather',
    modelNote: 'Ondulação e variáveis oceânicas por modelos marinhos; vento/rajadas por previsão meteorológica.',
    score: currentScore,
    status,
    statusEmoji,
    wave: current.wave == null ? '—' : `${fmt(current.wave)} m`,
    period: current.period == null ? '—' : `${fmt(current.period)} s`,
    direction: degToCompass(current.waveDirection),
    waterTemp: current.waterTemp == null ? '—' : `${fmt(current.waterTemp)} °C`,
    wind: current.wind == null ? '—' : `${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}`,
    gust: current.gust == null ? '—' : `${fmt(current.gust)} km/h`,
    energy: calcEnergy(current.wave, current.period) == null ? '—' : `~${fmt(calcEnergy(current.wave, current.period))} kW/m (estimada)`,
    atmosphericVisibility: current.visibility == null ? 'Não disponível' : `${(current.visibility / 1000).toFixed(1)} km`,
    visibility: current.visibility == null ? 'Não disponível' : `${(current.visibility / 1000).toFixed(1)} km`,
    underwaterVisibility: 'Não disponível / não confirmada',
    swell: current.swell == null ? '—' : `${fmt(current.swell)} m`,
    swellDirection: degToCompass(current.swellDirection),
    swellPeriod: current.swellPeriod == null ? '—' : `${fmt(current.swellPeriod)} s`,
    tideLevel: current.tideLevel == null ? '—' : `${current.tideLevel.toFixed(2)} m MSL*`,
    currentSpeed: current.current == null ? '—' : `${fmt(current.current)} km/h`,
    currentDirection: degToCompass(current.currentDirection),
    bestWindow: best ? `${best.time.slice(11,16)} — score ${best.score}/10` : 'Não calculado',
    bestWindowTime: best ? best.time : '',
    hourly: hourly.slice(0, 24),
    note: 'Score provisório para apoio à decisão, baseado em altura/período da onda, vento, rajadas e indicador relativo de energia. A visibilidade atmosférica não representa visibilidade subaquática. Confirma sempre a rebentação, corrente e visibilidade real no local.'
  };
}

async function getAllSpots(force = false) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const { marineUrl, weatherUrl } = buildUrls();
  const [marineRaw, weatherRaw] = await Promise.all([
    fetchJson(marineUrl),
    fetchJson(weatherUrl)
  ]);

  const marine = Array.isArray(marineRaw) ? marineRaw : [marineRaw];
  const weather = Array.isArray(weatherRaw) ? weatherRaw : [weatherRaw];

  const data = names.map((name, i) => makeSpot(name, marine[i], weather[i]));

  cache = { at: Date.now(), data };
  return data;
}

app.get('/api/spots', async (req, res) => {
  try {
    const data = await getAllSpots(req.query.refresh === '1');
    res.json({ updatedAt: new Date(cache.at).toISOString(), version: VERSION, spots: data });
  } catch (e) {
    console.error('spots error', e);
    res.status(502).json({ error: e.message || 'Falha ao obter dados', version: VERSION });
  }
});

app.get('/api/spot', async (req, res) => {
  try {
    const name = req.query.name || 'Spot';
    const data = await getAllSpots(false);
    const found = data.find(x => x.name === name);
    if (found) return res.json(found);
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({error:'Coordenadas inválidas'});
    return res.status(404).json({error:'Spot não encontrado'});
  } catch (e) {
    console.error('spot error', e);
    res.status(502).json({ error: e.message || 'Falha ao obter dados', version: VERSION });
  }
});

app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'Easyspearfishing',
  version: VERSION,
  cached: Boolean(cache.data),
  spots: names.length
}));

app.listen(PORT, '0.0.0.0', () => console.log(`Easyspearfishing ${VERSION} em http://0.0.0.0:${PORT}`));
