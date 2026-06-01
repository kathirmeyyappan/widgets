// ============================================================================
// Config
// ============================================================================

const USERNAME = 'Uji_Gintoki_Bowl';
const LIMIT = 3;

// Jikan v4 history endpoints. We hit anime and manga separately and merge.
// /history scrapes MAL's history.php — more reliable than /userupdates (which
// scrapes the profile page) and not capped at 3 per type.
const HISTORY_URL = type => `https://api.jikan.moe/v4/users/${USERNAME}/history/${type}`;

// Bounded retry with exponential backoff for transient upstream failures.
// Jikan returns 500/UpstreamException when MAL throttles its scraper.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 600;

// ============================================================================
// DOM references
// ============================================================================

const card = document.getElementById('card');
const entriesEl = document.getElementById('entries');
const messageEl = document.getElementById('message');

// ============================================================================
// Fetching
// ============================================================================

// Retry on transient failures (429 + 5xx). Returns the Response on success,
// throws on terminal failure.
async function fetchWithRetry(url) {
	let lastErr;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(url);
			if (res.ok) return res;
			if (!RETRY_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
				throw new Error(`HTTP ${res.status}`);
			}
			lastErr = new Error(`HTTP ${res.status}`);
		} catch (err) {
			lastErr = err;
			if (attempt === MAX_RETRIES) throw err;
		}
		const delay = RETRY_BASE_MS * Math.pow(2, attempt);
		console.warn(`[anime-activity] fetch failed (${lastErr.message}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
		await new Promise(r => setTimeout(r, delay));
	}
	throw lastErr;
}

// Fetch one type's history page and return its raw `data` array.
async function fetchHistoryRaw(type) {
	const res = await fetchWithRetry(HISTORY_URL(type));
	const json = await res.json();
	return json.data ?? [];
}

// ============================================================================
// Data processing
// ============================================================================

// Flatten a history event into our internal shape. History events look like:
//   { entry: { mal_id, url, title, images }, increment, date }
function normalize(raw, type) {
	return {
		type,
		malId: raw.entry?.mal_id,
		title: raw.entry?.title ?? 'Unknown',
		url: raw.entry?.url ?? '#',
		image: raw.entry?.images?.jpg?.image_url ?? '',
		increment: raw.increment,
		unit: type === 'anime' ? 'Episode' : 'Chapter',
		date: raw.date,
	};
}

// Keep one event per series — the most recent one. History returns every
// episode/chapter increment as its own entry, so a single anime can appear
// many times; we want the latest update per series.
function dedupeLatestPerSeries(entries) {
	const byId = new Map();
	for (const e of entries) {
		if (e.malId == null) continue;
		const existing = byId.get(e.malId);
		if (!existing || new Date(e.date) > new Date(existing.date)) {
			byId.set(e.malId, e);
		}
	}
	return [...byId.values()];
}

// ============================================================================
// Rendering
// ============================================================================

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relativeTime(iso) {
	const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
	const abs = Math.abs(diffSec);
	if (abs < 60) return rtf.format(diffSec, 'second');
	if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
	if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
	if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
	return rtf.format(Math.round(diffSec / 31536000), 'year');
}

function renderEntry(e) {
	const li = document.createElement('li');

	const cover = document.createElement('img');
	cover.className = 'cover';
	cover.src = e.image;
	cover.alt = '';
	li.appendChild(cover);

	const meta = document.createElement('div');
	meta.className = 'entry-meta';

	const titleRow = document.createElement('div');
	titleRow.className = 'title-row';

	const title = document.createElement('a');
	title.className = 'entry-title';
	title.href = e.url;
	title.target = '_blank';
	title.rel = 'noopener';
	title.textContent = e.title;
	titleRow.appendChild(title);

	const badge = document.createElement('span');
	badge.className = `type-badge ${e.type}`;
	badge.textContent = e.type;
	titleRow.appendChild(badge);

	meta.appendChild(titleRow);

	const detail = document.createElement('div');
	detail.className = 'entry-detail';
	detail.textContent = `${e.unit} ${e.increment ?? '?'}`;
	meta.appendChild(detail);

	li.appendChild(meta);

	const ts = document.createElement('div');
	ts.className = 'timestamp';
	ts.textContent = relativeTime(e.date);
	li.appendChild(ts);

	return li;
}

// ============================================================================
// Main flow
// ============================================================================

async function load() {
	card.dataset.state = 'loading';
	messageEl.textContent = 'Loading…';

	try {
		// 1. Fetch both histories in parallel.
		const [animeRaw, mangaRaw] = await Promise.all([
			fetchHistoryRaw('anime'),
			fetchHistoryRaw('manga'),
		]);

		// 2. Normalize, then dedupe within each type to one entry per series
		//    (latest update wins).
		const anime = dedupeLatestPerSeries(animeRaw.map(r => normalize(r, 'anime')));
		const manga = dedupeLatestPerSeries(mangaRaw.map(r => normalize(r, 'manga')));

		// 3. Merge and sort by date desc — this is the full pool we'd consider.
		const pool = [...anime, ...manga].sort((a, b) => new Date(b.date) - new Date(a.date));

		console.log(`[anime-activity] history: ${animeRaw.length} anime events + ${mangaRaw.length} manga events -> ${anime.length} + ${manga.length} unique series -> pool of ${pool.length}`, pool);

		// 4. Take top LIMIT for display.
		const top = pool.slice(0, LIMIT);

		if (top.length === 0) {
			card.dataset.state = 'empty';
			messageEl.textContent = 'No recent activity.';
			return;
		}

		entriesEl.replaceChildren(...top.map(renderEntry));
		card.dataset.state = 'ready';
	} catch (err) {
		console.error('[anime-activity] failed to load activity', err);
		card.dataset.state = 'error';
		messageEl.textContent = 'Could not load activity.';
	}
}

load();
