const PROD_ORIGIN = 'https://kathirm.com';

function isAllowedOrigin(origin) {
  if (origin === PROD_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch { return false; }
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin) ? origin : PROD_ORIGIN;
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

// range key -> { yfRange, interval, ttl, filterMs? }
const RANGE_CFG = {
  '1H':  { yfRange: '1d',  interval: '1m',  ttl:          30_000, filterMs: 60 * 60 * 1000 },
  '1D':  { yfRange: '1d',  interval: '5m',  ttl:          60_000 },
  '1W':  { yfRange: '5d',  interval: '30m', ttl:     2 * 60_000 },
  '1M':  { yfRange: '1mo', interval: '1d',  ttl:     5 * 60_000 },
  '1Y':  { yfRange: '1y',  interval: '1wk', ttl:    10 * 60_000 },
  '5Y':  { yfRange: '5y',  interval: '1mo', ttl:    30 * 60_000 },
  'ALL': { yfRange: 'max', interval: '3mo', ttl: 60 * 60_000 },
};

async function yfChart(ticker, cfg) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${cfg.interval}&range=${cfg.yfRange}`;
  const res  = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo chart ${ticker}: ${res.status}`);

  const body   = await res.json();
  const result = body.chart?.result?.[0];
  if (!result) return { ticker, points: [] };

  const timestamps = result.timestamp ?? [];
  const closes     = result.indicators.quote[0].close ?? [];

  let points = timestamps
    .map((ts, i) => ({ ts: ts * 1000, price: closes[i] }))
    .filter(p => p.price != null);

  // For 1H, keep only the last 60 minutes of data
  if (cfg.filterMs && points.length) {
    const cutoff = points[points.length - 1].ts - cfg.filterMs;
    points = points.filter(p => p.ts >= cutoff);
  }

  return { ticker, points };
}

// ── In-memory cache ───────────────────────────────────────

const quoteCache = new Map(); // symbol -> { data, exp }
const chartCache = new Map(); // `${symbol}:${range}` -> { data, exp }
const QUOTE_TTL  = 30_000;

async function cachedQuote(ticker, now) {
  const hit = quoteCache.get(ticker);
  if (hit && hit.exp > now) return hit.data;
  const data = await yfQuote(ticker);
  quoteCache.set(ticker, { data, exp: now + QUOTE_TTL });
  return data;
}

async function cachedChart(ticker, rangeKey, now) {
  const cfg = RANGE_CFG[rangeKey] ?? RANGE_CFG['1D'];
  const key = `${ticker}:${rangeKey}`;
  const hit = chartCache.get(key);
  if (hit && hit.exp > now) return hit.data;
  const data = await yfChart(ticker, cfg);
  chartCache.set(key, { data, exp: now + cfg.ttl });
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

      // GET /chart?ticker=AAPL&range=1D
      if (url.pathname === '/chart') {
        const ticker   = (url.searchParams.get('ticker') ?? 'AAPL').toUpperCase();
        const rangeKey = (url.searchParams.get('range') ?? '1D').toUpperCase();
        const data     = await cachedChart(ticker, rangeKey, now);
        return json(data, cors);
      }

      return new Response('Not found', { status: 404, headers: cors });
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, cors, 500);
    }
  },
};
