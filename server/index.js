const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

function score(wave, period, wind, visibility) {
  if (![wave, period, wind].every(Number.isFinite)) return null;
  let s = 10;
  // Transparent, provisional heuristic for spearfishing; not a safety certification.
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
  const r = await fetch(url, { headers: { 'User-Agent': 'Easyspearfishing/0.2' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

app.get('/api/spot', async (req, res) => {
  try {
    const name = req.query.name || 'Spot';
    const coords = spots[name] || [Number(req.query.lat), Number(req.query.lon)];
    const [lat, lon] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Coordenadas inválidas' });
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
      const vis = Number(wh.visibility?.[i]);
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
        visibility: Number.isFinite(vis) ? vis : null,
        waterTemp: Number(mh.sea_surface_temperature?.[i]),
        tideLevel: Number(mh.sea_level_height_msl?.[i]),
        current: Number(mh.ocean_current_velocity?.[i]),
        currentDirection: Number(mh.ocean_current_direction?.[i]),
        energy
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
      visibility: Number(weather.current?.visibility)
    };

    const s = score(current.wave, current.period, current.wind, current.visibility);
    const [statusEmoji, status] = classify(s);
    const energy = calcEnergy(current.wave, current.period);

    const first24 = hourly.slice(0, 24);
    const scored = first24.map(h => ({ ...h, score: score(h.wave, h.period, h.wind, h.visibility) })).filter(h => h.score != null);
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0] || null;

    res.json({
      name,
      lat,
      lon,
      source: 'Open-Meteo Marine + Open-Meteo Weather',
      modelNote: 'Ondulação e variáveis oceânicas por modelos marinhos; vento/rajadas por previsão meteorológica. Resolução marinha nominal ~5–8 km consoante o modelo/camada.',
      score: s,
      status,
      statusEmoji,
      wave: Number.isFinite(current.wave) ? `${fmt(current.wave)} m` : '—',
      period: Number.isFinite(current.period) ? `${fmt(current.period)} s` : '—',
      direction: degToCompass(current.waveDirection),
      waterTemp: Number.isFinite(current.waterTemp) ? `${fmt(current.waterTemp)} °C` : '—',
      wind: Number.isFinite(current.wind) ? `${fmt(current.wind)} km/h ${degToCompass(current.windDirection)}` : '—',
      gust: Number.isFinite(current.gust) ? `${fmt(current.gust)} km/h` : '—',
      energy: Number.isFinite(energy) ? `~${fmt(energy)} kW/m (estimada)` : '—',
      visibility: Number.isFinite(current.visibility) ? `${Math.round(current.visibility / 100) / 10} km` : 'Não disponível',
      swell: Number.isFinite(current.swell) ? `${fmt(current.swell)} m` : '—',
      swellDirection: degToCompass(current.swellDirection),
      swellPeriod: Number.isFinite(current.swellPeriod) ? `${fmt(current.swellPeriod)} s` : '—',
      tideLevel: Number.isFinite(current.tideLevel) ? `${current.tideLevel.toFixed(2)} m MSL*` : '—',
      currentSpeed: Number.isFinite(current.current) ? `${fmt(current.current)} km/h` : '—',
      currentDirection: degToCompass(current.currentDirection),
      bestWindow: best ? `${best.time.slice(11,16)} — score ${best.score}/10` : 'Não calculado',
      hourly: first24,
      note: 'Score provisório da app, baseado em mar, período, vento e visibilidade; não substitui avaliação local. A visibilidade subaquática real não é fornecida por esta API e não deve ser confundida com visibilidade atmosférica.'
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Easyspearfishing' }));

app.listen(PORT, '0.0.0.0', () => console.log(`Easyspearfishing em http://0.0.0.0:${PORT}`));
