const WORKER_URL = 'https://stocks-widget.kathirmey.workers.dev';

const BAR_TICKERS = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'SPY', 'QQQ', 'BRK-B'];

const SVG_W = 600;
const SVG_H = 160;
const PAD  = { top: 10, right: 8, bottom: 10, left: 8 };

const $ = id => document.getElementById(id);

const els = {
  widget:         $('widget'),
  searchBar:      $('searchBar'),
  searchInput:    $('searchInput'),
  tickerTrack:    $('tickerTrack'),
  focusSymbol:    $('focusSymbol'),
  focusName:      $('focusName'),
  focusPrice:     $('focusPrice'),
  focusChange:    $('focusChange'),
  chartWrap:      document.querySelector('.chart-wrap'),
  chartArea:      $('chartArea'),
  chartLine:      $('chartLine'),
  chartDot:       $('chartDot'),
  chartEmpty:     $('chartEmpty'),
  rangeSelector:  $('rangeSelector'),
  statOpen:       $('statOpen'),
  statHigh:       $('statHigh'),
  statLow:        $('statLow'),
  statPrev:       $('statPrev'),
};

const RANGES = ['1H', '1D', '1W', '1M', '1Y', '5Y', 'ALL'];

const params      = new URLSearchParams(location.search);
let focusTicker   = (params.get('ticker') || 'AAPL').toUpperCase();
let currentRange  = '1D';
let quotesCache   = {};

function fmt(n) {
  return n != null ? n.toFixed(2) : '——';
}

// ── Ticker bar ───────────────────────────────────────────

function buildTickerItem(q) {
  const isUp   = q.change >= 0;
  const arrow  = isUp ? '▲' : '▼';
  const pct    = Math.abs(q.changePct).toFixed(2);
  const active = q.symbol === focusTicker ? ' active' : '';

  const el = document.createElement('div');
  el.className  = `ticker-item${active}`;
  el.dataset.symbol = q.symbol;
  el.innerHTML = `
    <span class="ticker-symbol">${q.symbol}</span>
    <span class="ticker-price">$${fmt(q.price)}</span>
    <span class="ticker-change ${isUp ? 'up' : 'down'}">${arrow}${pct}%</span>
  `;
  el.addEventListener('click', () => switchFocus(q.symbol));
  return el;
}

function renderTickerBar(quotes) {
  els.tickerTrack.innerHTML = '';

  // Duplicate for seamless infinite scroll
  const all = [...quotes, ...quotes];
  all.forEach(q => els.tickerTrack.appendChild(buildTickerItem(q)));

  // Speed: ~3s per ticker item
  els.tickerTrack.style.animationDuration = `${quotes.length * 3}s`;
}

function markActiveInBar(symbol) {
  els.tickerTrack.querySelectorAll('.ticker-item').forEach(el => {
    el.classList.toggle('active', el.dataset.symbol === symbol);
  });
}

// ── Focus panel ──────────────────────────────────────────

function renderFocus(q) {
  if (!q) return;
  const isUp = q.change >= 0;
  const arrow = isUp ? '▲' : '▼';
  const sign  = isUp ? '+' : '';

  els.focusSymbol.textContent = q.symbol;
  els.focusName.textContent   = q.name || '';
  els.focusPrice.textContent  = `$${fmt(q.price)}`;

  els.focusChange.textContent = `${arrow} ${sign}$${fmt(Math.abs(q.change))}  (${sign}${fmt(q.changePct)}%)`;
  els.focusChange.className   = `focus-change ${isUp ? 'up' : 'down'}`;

  els.statOpen.textContent = `$${fmt(q.open)}`;
  els.statHigh.textContent = `$${fmt(q.high)}`;
  els.statLow.textContent  = `$${fmt(q.low)}`;
  els.statPrev.textContent = `$${fmt(q.prevClose)}`;

  els.widget.dataset.state = 'loaded';
}

// ── Chart ────────────────────────────────────────────────

function renderChart(points, isUp) {
  if (!points || points.length < 2) {
    els.chartWrap.classList.add('empty');
    return;
  }
  els.chartWrap.classList.remove('empty');

  const prices = points.map(p => p.price);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const range  = maxP - minP || 0.01;

  const toX = i => PAD.left + (i / (points.length - 1)) * (SVG_W - PAD.left - PAD.right);
  const toY = p => PAD.top  + (1 - (p - minP) / range)  * (SVG_H - PAD.top  - PAD.bottom);

  const linePts = points.map((p, i) => `${toX(i)},${toY(p.price)}`).join(' ');
  els.chartLine.setAttribute('points', linePts);
  els.chartLine.className = `chart-line${isUp ? '' : ' down'}`;

  // Filled area under the line — close path along the bottom
  const lastX = toX(points.length - 1);
  const baseY = toY(minP) + 0.5;
  const areaPts = `${toX(0)},${baseY} ` + linePts + ` ${lastX},${baseY}`;
  els.chartArea.setAttribute('points', areaPts);
  els.chartArea.className = `chart-area${isUp ? '' : ' down'}`;

  // Pulsing dot at latest point
  const last = points[points.length - 1];
  els.chartDot.setAttribute('cx', toX(points.length - 1));
  els.chartDot.setAttribute('cy', toY(last.price));
  els.chartDot.className = `chart-dot${isUp ? '' : ' down'}`;
}

// ── Range selector ───────────────────────────────────────

function markActiveRange(range) {
  els.rangeSelector.querySelectorAll('.range-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });
}

els.rangeSelector.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.range === currentRange) return;
    currentRange = btn.dataset.range;
    markActiveRange(currentRange);
    els.chartWrap.classList.add('empty');
    await fetchChart();
  });
});

// ── Search ────────────────────────────────────────────────

let searchErrorTimer = null;

function showSearchError() {
  clearTimeout(searchErrorTimer);
  els.searchBar.dataset.state = 'error';
  searchErrorTimer = setTimeout(() => {
    delete els.searchBar.dataset.state;
  }, 1800);
}

async function commitSearch() {
  const raw = els.searchInput.value.trim().toUpperCase();
  els.searchInput.value = '';
  if (!raw) return;
  if (raw === focusTicker) return;

  // Optimistically switch; fetch quote + chart for the new ticker
  try {
    const res = await fetch(`${WORKER_URL}/quotes?tickers=${raw}`);
    if (!res.ok) { showSearchError(); return; }
    const quotes = await res.json();
    if (!quotes.length || quotes[0].price == null) { showSearchError(); return; }

    quotes.forEach(q => { quotesCache[q.symbol] = q; });
    focusTicker = raw;
    markActiveInBar(raw);
    renderFocus(quotesCache[raw]);
    els.chartWrap.classList.add('empty');
    await fetchChart();
  } catch {
    showSearchError();
  }
}

els.searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitSearch(); }
  if (e.key === 'Escape') { els.searchInput.value = ''; els.searchInput.blur(); }
});

// Force uppercase as user types
els.searchInput.addEventListener('input', () => {
  const sel = els.searchInput.selectionStart;
  els.searchInput.value = els.searchInput.value.toUpperCase();
  els.searchInput.setSelectionRange(sel, sel);
});

// ── Data fetching ─────────────────────────────────────────

async function fetchQuotes() {
  try {
    const tickers = [...new Set([focusTicker, ...BAR_TICKERS])].join(',');
    const res = await fetch(`${WORKER_URL}/quotes?tickers=${tickers}`);
    if (!res.ok) return;
    const quotes = await res.json();

    quotes.forEach(q => { quotesCache[q.symbol] = q; });
    renderTickerBar(quotes.filter(q => BAR_TICKERS.includes(q.symbol)));
    markActiveInBar(focusTicker);
    renderFocus(quotesCache[focusTicker]);
  } catch (e) {
    console.error('quotes fetch failed', e);
  }
}

async function fetchChart() {
  try {
    const res = await fetch(`${WORKER_URL}/chart?ticker=${focusTicker}&range=${currentRange}`);
    if (!res.ok) return;
    const data   = await res.json();
    const points = data.points || [];

    // For intraday ranges use daily quote change; for multi-day use first→last
    let isUp;
    if (currentRange === '1H' || currentRange === '1D') {
      const q = quotesCache[focusTicker];
      isUp = q ? q.change >= 0 : points.length >= 2 && points[points.length - 1].price >= points[0].price;
    } else {
      isUp = points.length < 2 || points[points.length - 1].price >= points[0].price;
    }

    renderChart(points, isUp);
  } catch (e) {
    console.error('chart fetch failed', e);
  }
}

async function switchFocus(symbol) {
  if (symbol === focusTicker) return;
  focusTicker = symbol;
  markActiveInBar(symbol);
  renderFocus(quotesCache[symbol]);
  els.chartWrap.classList.add('empty'); // clear while loading
  await fetchChart();
}

// ── Init + polling ────────────────────────────────────────

markActiveRange(currentRange);
fetchQuotes();
fetchChart();

setInterval(fetchQuotes, 30_000);
setInterval(fetchChart,  120_000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { fetchQuotes(); fetchChart(); }
});
