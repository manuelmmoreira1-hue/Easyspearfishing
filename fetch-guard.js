// Easyspearfishing — proteção Open-Meteo + cache externo persistente
// NÃO altera o motor de score nem o frontend.
//
// Estratégia:
// 1) usa cache local em memória durante 30 min;
// 2) tenta Open-Meteo normalmente;
// 3) se Open-Meteo der 429/5xx/erro, vai buscar o último snapshot
//    persistente ao branch "forecast-cache" do GitHub;
// 4) mantém esse snapshot local até 7 dias;
// 5) se existir OPEN_METEO_API_KEY, usa o endpoint customer-api.open-meteo.com.
//
// Assim, uma falha/limite do Open-Meteo não deve transformar /api/spots em 502
// depois de existir pelo menos um snapshot no branch forecast-cache.

const originalFetch = global.fetch.bind(global);

const apiCache = new Map();
const inFlight = new Map();

const FRESH_MS = 30 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;
const REMOTE_CACHE_TIMEOUT_MS = 12000;

const REPO_RAW_BASE =
  process.env.FORECAST_CACHE_RAW_BASE ||
  'https://raw.githubusercontent.com/manuelmmoreira1-hue/Easyspearfishing/forecast-cache/data';

function isOpenMeteo(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'api.open-meteo.com' ||
           host === 'marine-api.open-meteo.com' ||
           host === 'customer-api.open-meteo.com';
  } catch {
    return false;
  }
}

function cacheName(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'marine-api.open-meteo.com'
      ? 'marine.json'
      : 'weather.json';
  } catch {
    return 'unknown.json';
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function responseFrom(entry) {
  return new Response(entry.body, {
    status: entry.status || 200,
    headers: {
      'content-type': entry.contentType || 'application/json',
      'x-easyspearfishing-source': entry.source || 'cache'
    }
  });
}

function customerUrl(url) {
  const key = process.env.OPEN_METEO_API_KEY;
  if (!key) return url;

  try {
    const u = new URL(url);
    if (u.hostname === 'api.open-meteo.com' ||
        u.hostname === 'marine-api.open-meteo.com') {
      u.hostname = 'customer-api.open-meteo.com';
      u.searchParams.set('apikey', key);
      return u.toString();
    }
  } catch {}
  return url;
}

async function fetchRemoteCache(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_CACHE_TIMEOUT_MS);

  try {
    const url = `${REPO_RAW_BASE}/${name}?v=${Date.now()}`;
    const r = await originalFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Easyspearfishing-cache/1.0' }
    });

    if (!r.ok) throw new Error(`GitHub cache HTTP ${r.status}`);

    const body = await r.text();
    JSON.parse(body); // valida antes de guardar

    const entry = {
      body,
      status: 200,
      contentType: 'application/json',
      savedAt: Date.now(),
      source: 'github-cache'
    };

    apiCache.set(name, entry);
    console.log(`Easyspearfishing: fallback persistente carregado (${name}).`);
    return entry;
  } finally {
    clearTimeout(timer);
  }
}

async function protectedFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();

  if (method !== 'GET' || !isOpenMeteo(url)) {
    return originalFetch(url, options);
  }

  const key = url;
  const localKey = cacheName(url);
  const now = Date.now();
  const cached = apiCache.get(key) || apiCache.get(localKey);

  if (cached && now - cached.savedAt < FRESH_MS) {
    return responseFrom(cached);
  }

  if (inFlight.has(key)) {
    return responseFrom(await inFlight.get(key));
  }

  const promise = (async () => {
    let lastError = null;

    // Primeiro tenta a fonte principal.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const upstreamUrl = customerUrl(url);
        const response = await originalFetch(upstreamUrl, options);

        if (response.ok) {
          const body = await response.text();
          const entry = {
            body,
            status: response.status,
            contentType: response.headers.get('content-type') || 'application/json',
            savedAt: Date.now(),
            source: process.env.OPEN_METEO_API_KEY ? 'open-meteo-paid' : 'open-meteo'
          };

          apiCache.set(key, entry);
          apiCache.set(localKey, entry);
          return entry;
        }

        lastError = new Error(`HTTP ${response.status}`);

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;

        if (attempt < MAX_RETRIES) {
          await wait(RETRY_DELAY_MS);
        }
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) await wait(RETRY_DELAY_MS);
      }
    }

    // Se o fornecedor falhou, usa snapshot persistente.
    try {
      const remote = await fetchRemoteCache(localKey);
      return remote;
    } catch (remoteError) {
      console.warn(
        `Easyspearfishing: Open-Meteo falhou (${lastError?.message || 'erro'}); ` +
        `GitHub cache também falhou (${remoteError.message}).`
      );
    }

    // Último recurso: cache local até 7 dias.
    const local = apiCache.get(key) || apiCache.get(localKey);
    if (local && Date.now() - local.savedAt < STALE_MS) {
      console.warn('Easyspearfishing: a servir cache local antigo.');
      return local;
    }

    throw lastError || new Error('Open-Meteo indisponível e sem cache');
  })();

  inFlight.set(key, promise);

  try {
    const entry = await promise;
    return responseFrom(entry);
  } finally {
    inFlight.delete(key);
  }
}

global.fetch = protectedFetch;

console.log(
  'Easyspearfishing: proteção ativa — Open-Meteo + cache GitHub persistente + fallback 7 dias.'
);
