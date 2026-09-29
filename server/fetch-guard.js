// Easyspearfishing — proteção de acesso às APIs Open-Meteo
// Correção: cache, deduplicação, retry de 429/5xx e fallback para dados
// válidos recentes. Não altera o motor de score nem o frontend.

const originalFetch = global.fetch.bind(global);
const apiCache = new Map();
const inFlight = new Map();

const FRESH_MS = 12 * 60 * 1000;       // 12 min
const STALE_MS = 2 * 60 * 60 * 1000;   // 2 h
const MAX_RETRIES = 2;

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

  // Só protege GETs da Open-Meteo. Supabase e restantes pedidos ficam iguais.
  if (method !== 'GET' || !isOpenMeteo(url)) {
    return originalFetch(url, options);
  }

  const key = url;
  const now = Date.now();
  const cached = apiCache.get(key);

  // Dados recentes: não fazemos novo pedido.
  if (cached && now - cached.savedAt < FRESH_MS) {
    return responseFrom(cached);
  }

  // Se já houver outro pedido exatamente igual em andamento, reutiliza-o.
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
          return entry;
        }

        lastError = new Error(`HTTP ${response.status}`);

        // 429 = rate limit; 5xx = falha temporária do fornecedor.
        const retryable = response.status === 429 || response.status >= 500;

        if (!retryable) {
          return {
            body: JSON.stringify({ error: lastError.message }),
            status: response.status,
            contentType: 'application/json',
            savedAt: Date.now()
          };
        }

        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const fallbackWait = [2500, 6000][attempt] || 6000;
          const delay = Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(15000, retryAfter * 1000)
            : fallbackWait;

          console.warn(
            `Open-Meteo ${response.status}; nova tentativa em ${delay} ms.`
          );
          await wait(delay);
        }
      } catch (err) {
        lastError = err;

        if (attempt < MAX_RETRIES) {
          const delay = [2500, 6000][attempt] || 6000;
          console.warn(
            `Open-Meteo erro; nova tentativa em ${delay} ms: ${err.message}`
          );
          await wait(delay);
        }
      }
    }

    // Se a API falhar depois de já termos dados bons, NÃO derrubamos o site.
    if (cached && Date.now() - cached.savedAt < STALE_MS) {
      console.warn(
        'Open-Meteo indisponível; a servir os últimos dados válidos em cache.'
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
  '(cache + deduplicação + retry + fallback).'
);
