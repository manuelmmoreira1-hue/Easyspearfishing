// Easyspearfishing — proteção robusta de acesso às APIs Open-Meteo
// Cache persistente + deduplicação + retry controlado + fallback.
// Não altera o motor de score nem o frontend.

const originalFetch = global.fetch.bind(global);
const apiCache = new Map();
const inFlight = new Map();

const FRESH_MS = 30 * 60 * 1000;       // 30 min entre pedidos reais ao fornecedor
const STALE_MS = 24 * 60 * 60 * 1000;  // 24 h de fallback se o fornecedor falhar
const MAX_RETRIES = 1;
const RETRY_CAP_MS = 60000;

const fs = require('fs');
const path = require('path');
const CACHE_FILE = path.join(process.cwd(), 'data', 'open-meteo-cache.json');

function loadPersistentCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      for (const [key, entry] of Object.entries(saved)) {
        if (entry && typeof entry.body === 'string' && Number.isFinite(entry.savedAt)) {
          apiCache.set(key, entry);
        }
      }
      console.log(`Open-Meteo: ${apiCache.size} entradas carregadas do cache persistente.`);
    }
  } catch {}
}

function persistCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(Object.fromEntries(apiCache.entries())),
      'utf8'
    );
  } catch (err) {
    console.warn('Open-Meteo: não foi possível persistir cache:', err.message);
  }
}

loadPersistentCache();

function isOpenMeteo(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'api.open-meteo.com' ||
           host === 'marine-api.open-meteo.com';
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function responseFrom(entry) {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      'content-type': entry.contentType || 'application/json'
    }
  });
}

async function protectedFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();

  if (method !== 'GET' || !isOpenMeteo(url)) {
    return originalFetch(url, options);
  }

  const key = url;
  const now = Date.now();
  const cached = apiCache.get(key);

  // Nunca fazemos pedidos repetidos desnecessários.
  if (cached && now - cached.savedAt < FRESH_MS) {
    return responseFrom(cached);
  }

  // Se já houver exatamente o mesmo pedido em curso, partilha o resultado.
  if (inFlight.has(key)) {
    const entry = await inFlight.get(key);
    return responseFrom(entry);
  }

  const promise = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await originalFetch(url, options);

        if (response.ok) {
          const body = await response.text();
          const entry = {
            body,
            status: response.status,
            contentType: response.headers.get('content-type') || 'application/json',
            savedAt: Date.now()
          };
          apiCache.set(key, entry);
          persistCache();
          return entry;
        }

        lastError = new Error(`HTTP ${response.status}`);
        const retryable = response.status === 429 || response.status >= 500;

        if (!retryable) {
          return {
            body: JSON.stringify({ error: lastError.message }),
            status: response.status,
            contentType: 'application/json',
            savedAt: Date.now()
          };
        }

        // Em 429 não fazemos vários pedidos seguidos: isso só agrava o rate limit.
        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(RETRY_CAP_MS, retryAfter * 1000)
            : 15000;

          console.warn(
            `Open-Meteo ${response.status}; nova tentativa em ${delay} ms.`
          );
          await wait(delay);
        }
      } catch (err) {
        lastError = err;

        if (attempt < MAX_RETRIES) {
          await wait(5000);
        }
      }
    }

    // Se já houver dados válidos recentes, o site continua a funcionar.
    if (cached && Date.now() - cached.savedAt < STALE_MS) {
      console.warn(
        'Open-Meteo indisponível; a servir os últimos dados válidos do cache.'
      );
      return cached;
    }

    throw lastError || new Error('Open-Meteo indisponível');
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
  'Easyspearfishing: proteção Open-Meteo ativa ' +
  '(cache persistente + deduplicação + retry controlado + fallback 24h).'
);
