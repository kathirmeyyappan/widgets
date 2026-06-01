const USERNAME = 'Uji_Gintoki_Bowl';
const LIMIT = 3;
const ENDPOINT = `https://api.jikan.moe/v4/users/${USERNAME}/userupdates`;

const SKIP_STATUSES = new Set(['Plan to Watch', 'Plan to Read']);

const card = document.getElementById('card');
const entriesEl = document.getElementById('entries');
const messageEl = document.getElementById('message');

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relativeTime(iso) {
	const then = new Date(iso).getTime();
	const diffSec = Math.round((then - Date.now()) / 1000);
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
	const progressStr = `${e.progress ?? 0}/${e.total && e.total > 0 ? e.total : '?'} ${e.unit}`;
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

async function load() {
	card.dataset.state = 'loading';
	messageEl.textContent = 'Loading…';

	try {
		const res = await fetch(ENDPOINT);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = await res.json();

		const anime = (json.data?.anime ?? []).map(r => normalize(r, 'anime'));
		const manga = (json.data?.manga ?? []).map(r => normalize(r, 'manga'));

		const merged = [...anime, ...manga]
			.filter(e => !SKIP_STATUSES.has(e.status))
			.sort((a, b) => new Date(b.date) - new Date(a.date))
			.slice(0, LIMIT);

		if (merged.length === 0) {
			card.dataset.state = 'empty';
			messageEl.textContent = 'No recent activity.';
			return;
		}

		entriesEl.replaceChildren(...merged.map(renderEntry));
		card.dataset.state = 'ready';
	} catch (err) {
		console.error('Failed to load activity', err);
		card.dataset.state = 'error';
		messageEl.textContent = 'Could not load activity.';
	}
}

load();
