// Worker proxies the official MAL API and returns already-shaped data.
const ENDPOINT = 'https://anime-activity-widget.kathirmey.workers.dev';
const LIMIT = 3;

const card = document.getElementById('card');
const messageEl = document.getElementById('message');

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

function renderEntry(e, unit) {
	const li = document.createElement('li');

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
	const progressStr = `${e.progress ?? 0}/${e.total && e.total > 0 ? e.total : '?'} ${unit}`;
	const scoreStr = e.score && e.score > 0 ? `Scored ${e.score}` : 'Scored –';
	detail.innerHTML = `${e.status}<span class="sep">·</span>${progressStr}<span class="sep">·</span>${scoreStr}`;
	meta.appendChild(detail);

	li.appendChild(meta);

	const ts = document.createElement('div');
	ts.className = 'timestamp';
	ts.textContent = relativeTime(e.date);
	li.appendChild(ts);

	return li;
}

function renderSection(medium, entries, unit) {
	const listEl = document.querySelector(`.entries[data-medium="${medium}"]`);
	const emptyEl = document.querySelector(`.empty-hint[data-medium="${medium}"]`);
	if (entries.length === 0) {
		listEl.replaceChildren();
		emptyEl.classList.add('visible');
	} else {
		listEl.replaceChildren(...entries.map(e => renderEntry(e, unit)));
		emptyEl.classList.remove('visible');
	}
}

async function load() {
	card.dataset.state = 'loading';
	messageEl.textContent = 'Loading…';

	try {
		const res = await fetch(`${ENDPOINT}?limit=${LIMIT}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { anime = [], manga = [], error } = await res.json();
		if (error) throw new Error(error);

		console.log(`[anime-activity] fetched ${anime.length} anime + ${manga.length} manga`, { anime, manga });

		renderSection('anime', anime, 'ep');
		renderSection('manga', manga, 'ch');
		card.dataset.state = 'ready';
	} catch (err) {
		console.error('[anime-activity] failed to load', err);
		card.dataset.state = 'error';
		messageEl.textContent = 'Could not load activity.';
	}
}

load();
