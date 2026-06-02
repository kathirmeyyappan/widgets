const ALLOWED_ORIGINS = ['https://kathirm.com', 'http://127.0.0.1:5500', 'http://localhost:5500'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ── Yahoo Finance helpers ─────────────────────────────────

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function yfQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res  = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: ${res.status}`);

  const body   = await res.json();
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta      = result.meta;
  const price     = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change    = price - prevClose;

  return {
    symbol:     ticker,
    name:       meta.longName ?? meta.shortName ?? ticker,
    price,
    change,
    changePct:  prevClose !== 0 ? (change / prevClose) * 100 : 0,
    open:       meta.regularMarketOpen,
    high:       meta.regularMarketDayHigh,
    low:        meta.regularMarketDayLow,
    prevClose,
    marketState: meta.marketState,
  };
}

async function yfChart(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`;
  const res  = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo chart ${ticker}: ${res.status}`);

  const body   = await res.json();
  const result = body.chart?.result?.[0];
  if (!result) return { ticker, points: [] };

  const timestamps = result.timestamp ?? [];
  const closes     = result.indicators.quote[0].close ?? [];

  const points = timestamps
    .map((ts, i) => ({ ts: ts * 1000, price: closes[i] }))
    .filter(p => p.price != null);

  return { ticker, points };
}

// ── In-memory cache ───────────────────────────────────────

const quoteCache = new Map(); // symbol -> { data, exp }
const chartCache = new Map();
const QUOTE_TTL  = 30_000;   // 30 s
const CHART_TTL  = 120_000;  // 2 min

async function cachedQuote(ticker, now) {
  const hit = quoteCache.get(ticker);
  if (hit && hit.exp > now) return hit.data;
  const data = await yfQuote(ticker);
  quoteCache.set(ticker, { data, exp: now + QUOTE_TTL });
  return data;
}

async function cachedChart(ticker, now) {
  const hit = chartCache.get(ticker);
  if (hit && hit.exp > now) return hit.data;
  const data = await yfChart(ticker);
  chartCache.set(ticker, { data, exp: now + CHART_TTL });
  return data;
}

// ── Request handler ───────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? '';
    const cors   = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const now = Date.now();

    try {
      // GET /quotes?tickers=AAPL,GOOGL,...
      if (url.pathname === '/quotes') {
        const raw     = url.searchParams.get('tickers') ?? 'AAPL';
        const tickers = raw.split(',').map(t => t.trim().toUpperCase()).slice(0, 20);

        const results = await Promise.allSettled(tickers.map(t => cachedQuote(t, now)));
        const quotes  = results
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value);

        return json(quotes, cors);
      }

      // GET /chart?ticker=AAPL
      if (url.pathname === '/chart') {
        const ticker = (url.searchParams.get('ticker') ?? 'AAPL').toUpperCase();
        const data   = await cachedChart(ticker, now);
        return json(data, cors);
      }

      return new Response('Not found', { status: 404, headers: cors });
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, cors, 500);
    }
  },
};
