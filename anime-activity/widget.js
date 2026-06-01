// ============================================================================
// Config
// ============================================================================

const USERNAME = 'Uji_Gintoki_Bowl';
const LIMIT = 3;
const ENDPOINT = `https://api.jikan.moe/v4/users/${USERNAME}/userupdates`;
const LIST_URL = medium => `https://api.jikan.moe/v4/users/${USERNAME}/${medium}list`;

// Jikan's /userupdates scrapes MAL's HTML profile page, which can fail
// (UpstreamException 500) when MAL throttles Jikan's scraper. Retry a few
// times with backoff before giving up.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 300;

const SKIP_STATUSES = new Set(['Plan to Watch', 'Plan to Read']);

const card = document.getElementById('card');
const messageEl = document.getElementById('message');

// ============================================================================
// Utilities
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

function normalize(raw, type) {
	const isAnime = type === 'anime';
	return {
		type,
		malId: raw.entry?.mal_id,
		title: raw.entry?.title ?? 'Unknown',
		url: raw.entry?.url ?? '#',
		image: raw.entry?.images?.jpg?.image_url ?? '',
		status: raw.status ?? '',
		score: raw.score,
		progress: isAnime ? raw.episodes_seen : raw.chapters_read,
		total: isAnime ? raw.episodes_total : raw.chapters_total,
		unit: isAnime ? 'ep' : 'ch',
		date: raw.date,
	};
}

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

// Shared formatter so initial render and post-enrichment updates produce
// identical markup.
function formatDetail(e) {
	const progressStr = `${e.progress ?? 0}/${e.total && e.total > 0 ? e.total : '?'} ${e.unit}`;
	const scoreStr = e.score && e.score > 0 ? `Scored ${e.score}` : 'Scored –';
	return `${e.status}<span class="sep">·</span>${progressStr}<span class="sep">·</span>${scoreStr}`;
}

// ============================================================================
// Rendering
// ============================================================================

function renderEntry(e) {
	const li = document.createElement('li');
	li.dataset.malId = e.malId;

	const cover = document.createElement('img');
	cover.className = 'cover';
	cover.src = e.image;
	cover.alt = '';
	li.appendChild(cover);

	const meta = document.createElement('div');
	meta.className = 'entry-meta';

	const title = document.createElement('a');
	title.className = 'entry-title';
	title.href = e.url;
	title.target = '_blank';
	title.rel = 'noopener';
	title.textContent = e.title;
	meta.appendChild(title);

	const detail = document.createElement('div');
	detail.className = 'entry-detail';
	detail.innerHTML = formatDetail(e);
	meta.appendChild(detail);

	li.appendChild(meta);

	const ts = document.createElement('div');
	ts.className = 'timestamp';
	ts.textContent = relativeTime(e.date);
	li.appendChild(ts);

	return li;
}

function renderSection(medium, entries) {
	const listEl = document.querySelector(`.entries[data-medium="${medium}"]`);
	const emptyEl = document.querySelector(`.empty-hint[data-medium="${medium}"]`);
	if (entries.length === 0) {
		listEl.replaceChildren();
		emptyEl.classList.add('visible');
	} else {
		listEl.replaceChildren(...entries.map(renderEntry));
		emptyEl.classList.remove('visible');
	}
}

// ============================================================================
// Main flow — fetch, filter, render
// ============================================================================

async function load() {
	card.dataset.state = 'loading';
	messageEl.textContent = 'Loading…';

	try {
		const res = await fetchWithRetry(ENDPOINT);
		const json = await res.json();

		// /userupdates returns at most 3 anime + 3 manga (MAL profile-page cap).
		// Process each medium independently — no merging — so an abandoned medium
		// still gets its own section and doesn't get buried under the other.
		const anime = (json.data?.anime ?? [])
			.map(r => normalize(r, 'anime'))
			.filter(e => !SKIP_STATUSES.has(e.status))
			.sort((a, b) => new Date(b.date) - new Date(a.date))
			.slice(0, LIMIT);
		const manga = (json.data?.manga ?? [])
			.map(r => normalize(r, 'manga'))
			.filter(e => !SKIP_STATUSES.has(e.status))
			.sort((a, b) => new Date(b.date) - new Date(a.date))
			.slice(0, LIMIT);

		console.log(`[anime-activity] fetched ${anime.length} anime + ${manga.length} manga`, { anime, manga });

		renderSection('anime', anime);
		renderSection('manga', manga);
		card.dataset.state = 'ready';

		// Initial render is on screen — kick off background enrichment to fill
		// in any null progress/total values without blocking the user.
		enrichInBackground({ anime, manga });
	} catch (err) {
		console.error('[anime-activity] failed to load activity', err);
		card.dataset.state = 'error';
		messageEl.textContent = 'Could not load activity.';
	}
}

load();

// ============================================================================
// Enrichment (runs AFTER initial render — non-blocking)
//
// /userupdates returns episodes_seen / chapters_read as null whenever the
// total is unknown ("X/?") — Jikan's HTML scraper bails on the pair. The
// list endpoints (/users/{user}/animelist + /mangalist) hit MAL's structured
// load.json and have the real numbers. We only fetch them if there's a gap
// to fill, and we patch the DOM in place when results arrive.
// ============================================================================

function extractListEntry(item) {
	// Jikan's user-list shape across versions: try the common field names.
	return {
		malId: item.mal_id ?? item.anime?.mal_id ?? item.manga?.mal_id,
		progress: item.watched_episodes ?? item.chapters_read ?? null,
		total:
			item.total_episodes ??
			item.total_chapters ??
			item.anime?.episodes ??
			item.manga?.chapters ??
			null,
	};
}

async function buildListLookup(medium) {
	const res = await fetchWithRetry(LIST_URL(medium));
	const json = await res.json();
	const byId = new Map();
	for (const item of json.data ?? []) {
		const norm = extractListEntry(item);
		if (norm.malId != null) byId.set(norm.malId, norm);
	}
	return byId;
}

function patchEntryDom(medium, entry) {
	const li = document.querySelector(
		`.entries[data-medium="${medium}"] li[data-mal-id="${entry.malId}"]`,
	);
	const detail = li?.querySelector('.entry-detail');
	if (detail) detail.innerHTML = formatDetail(entry);
}

async function enrichMedium(entries, medium) {
	const gaps = entries.filter(e => e.progress == null || e.total == null);
	if (gaps.length === 0) return;
	try {
		const lookup = await buildListLookup(medium);
		for (const e of gaps) {
			const match = lookup.get(e.malId);
			if (!match) continue;
			if (e.progress == null && match.progress != null) e.progress = match.progress;
			if (e.total == null && match.total != null) e.total = match.total;
			patchEntryDom(medium, e);
		}
		console.log(`[anime-activity] enriched ${gaps.length} ${medium} gap(s)`);
	} catch (err) {
		console.warn(`[anime-activity] ${medium} enrichment failed`, err);
	}
}

function enrichInBackground({ anime, manga }) {
	// Fire and forget — failures here never affect the rendered widget.
	enrichMedium(anime, 'anime');
	enrichMedium(manga, 'manga');
}
