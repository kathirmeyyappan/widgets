const USERNAME = 'kathirmeyyappan';
const API_BASE = 'https://api.github.com';
const CACHE_KEY = 'gh-activity-v3';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_ITEMS = 10;

const card = document.getElementById('card');
const entriesEl = document.getElementById('entries');
const messageEl = document.getElementById('message');
const footerEl = document.getElementById('footer-text');
const heatmapEl = document.getElementById('heatmap');

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

function toLocalDateStr(d) {
	const date = typeof d === 'string' ? new Date(d) : d;
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}

// ── Heatmap ──────────────────────────────────────────────

function buildHeatmapData(events) {
	const counts = {};
	for (const ev of events) {
		const day = toLocalDateStr(ev.created_at);
		counts[day] = (counts[day] ?? 0) + 1;
	}

	const now = new Date();
	now.setHours(0, 0, 0, 0);

	// Start at Sunday 13 complete weeks ago
	const start = new Date(now);
	start.setDate(start.getDate() - start.getDay() - 13 * 7);

	// End at Saturday of current week
	const end = new Date(now);
	end.setDate(end.getDate() + (6 - now.getDay()));

	const cells = [];
	const cur = new Date(start);
	while (cur <= end) {
		const dateStr = toLocalDateStr(cur);
		const isFuture = cur > now;
		cells.push({ date: isFuture ? null : dateStr, count: isFuture ? -1 : (counts[dateStr] ?? 0) });
		cur.setDate(cur.getDate() + 1);
	}
	return cells; // 14 × 7 = 98 cells
}

function renderHeatmap(cells) {
	heatmapEl.innerHTML = '';

	// Month labels (14 columns, overflow-visible text)
	const monthsRow = document.createElement('div');
	monthsRow.className = 'heatmap-months';
	for (let col = 0; col < 14; col++) {
		const span = document.createElement('span');
		const sunday = cells[col * 7];
		if (sunday?.date) {
			const d = new Date(sunday.date + 'T00:00:00');
			if (col === 0 || d.getDate() <= 7) {
				span.textContent = d.toLocaleString('en', { month: 'short' });
			}
		}
		monthsRow.appendChild(span);
	}
	heatmapEl.appendChild(monthsRow);

	// Day labels + grid
	const body = document.createElement('div');
	body.className = 'heatmap-body';

	const dayLabels = document.createElement('div');
	dayLabels.className = 'heatmap-day-labels';
	['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach(label => {
		const span = document.createElement('span');
		span.textContent = label;
		dayLabels.appendChild(span);
	});
	body.appendChild(dayLabels);

	const grid = document.createElement('div');
	grid.className = 'heatmap-grid';
	const level = n => n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
	for (const cell of cells) {
		const div = document.createElement('div');
		if (cell.count === -1) {
			div.className = 'heatmap-cell heatmap-future';
		} else {
			div.className = `heatmap-cell heatmap-lv${level(cell.count)}`;
			div.title = cell.count > 0
				? `${cell.date}: ${cell.count} event${cell.count !== 1 ? 's' : ''}`
				: (cell.date ?? '');
		}
		grid.appendChild(div);
	}
	body.appendChild(grid);
	heatmapEl.appendChild(body);

	// Legend
	const legend = document.createElement('div');
	legend.className = 'heatmap-legend';
	const lessSpan = document.createElement('span');
	lessSpan.textContent = 'Less';
	legend.appendChild(lessSpan);
	for (let lv = 0; lv <= 4; lv++) {
		const div = document.createElement('div');
		div.className = `heatmap-cell heatmap-lv${lv}`;
		legend.appendChild(div);
	}
	const moreSpan = document.createElement('span');
	moreSpan.textContent = 'More';
	legend.appendChild(moreSpan);
	heatmapEl.appendChild(legend);
}

// ── Activity list ─────────────────────────────────────────

function parseEvents(events) {
	const items = [];
	const seenPushRepo = new Set();
	const prRepoCount = {};

	for (const ev of events) {
		if (items.length >= MAX_ITEMS) break;

		const repo = ev.repo.name;
		const repoShort = repo.split('/')[1] ?? repo;
		const repoUrl = `https://github.com/${repo}`;
		const date = ev.created_at;

		if (ev.type === 'PushEvent') {
			if (seenPushRepo.has(repo)) continue;
			seenPushRepo.add(repo);
			const commits = ev.payload.commits ?? [];
			const count = ev.payload.size > 0 ? ev.payload.size : commits.length;
			const branch = (ev.payload.ref ?? '').replace('refs/heads/', '');
			const msg = commits[commits.length - 1]?.message?.split('\n')[0];
			items.push({
				type: 'push', label: 'PUSH',
				context: branch ? `${repoShort}:${branch}` : repoShort,
				contextUrl: repoUrl,
				desc: msg || `${count > 0 ? count : 1} commit${count !== 1 ? 's' : ''}`,
				descUrl: commits[0] ? `${repoUrl}/commit/${commits[0].sha}` : null,
				date,
			});

		} else if (ev.type === 'PullRequestEvent') {
			const pr = ev.payload.pull_request;
			const action = ev.payload.action;
			prRepoCount[repo] = (prRepoCount[repo] ?? 0) + 1;
			if (prRepoCount[repo] > 2) continue;
			if (action === 'opened') {
				items.push({
					type: 'pr-open', label: 'PR',
					context: repoShort, contextUrl: repoUrl,
					desc: pr.title || `PR #${pr.number}`, descUrl: pr.html_url,
					prNumber: pr.number, actionLabel: 'opened',
					date,
				});
			} else if (action === 'closed' && pr?.merged) {
				items.push({
					type: 'pr-merge', label: 'MERGE',
					context: repoShort, contextUrl: repoUrl,
					desc: pr.title || `PR #${pr.number}`, descUrl: pr.html_url,
					prNumber: pr.number, actionLabel: 'merged',
					date,
				});
			}

		} else if (ev.type === 'PullRequestReviewEvent') {
			const pr = ev.payload.pull_request;
			const state = (ev.payload.review?.state ?? 'commented').toLowerCase();
			const actionLabel = {
				approved: 'approved',
				changes_requested: 'changes requested',
				commented: 'commented on',
			}[state] ?? 'reviewed';
			items.push({
				type: 'review', label: 'REV',
				context: repoShort, contextUrl: repoUrl,
				desc: pr.title || `PR #${pr.number}`,
				descUrl: ev.payload.review?.html_url ?? pr.html_url,
				prNumber: pr.number, actionLabel,
				date,
			});

		} else if (ev.type === 'CreateEvent' && ev.payload.ref_type === 'repository') {
			items.push({
				type: 'repo', label: 'REPO',
				context: repoShort, contextUrl: repoUrl,
				desc: ev.payload.description || 'initialized repository',
				descUrl: null,
				date,
			});

		} else if (ev.type === 'ForkEvent') {
			const forkee = ev.payload.forkee;
			items.push({
				type: 'fork', label: 'FORK',
				context: repoShort, contextUrl: forkee?.html_url ?? repoUrl,
				desc: 'forked repository',
				descUrl: null,
				date,
			});
		}
	}

	return items;
}

const PR_TYPES = new Set(['pr-open', 'pr-merge', 'review']);

function renderEntry(item) {
	if (PR_TYPES.has(item.type)) return renderPREntry(item);

	const li = document.createElement('li');
	li.className = `entry entry-${item.type}`;

	const badge = document.createElement('span');
	badge.className = `badge badge-${item.type}`;
	badge.textContent = item.label;
	li.appendChild(badge);

	const body = document.createElement('div');
	body.className = 'entry-body';

	const ctx = document.createElement('a');
	ctx.className = 'entry-ctx';
	ctx.href = item.contextUrl;
	ctx.target = '_blank';
	ctx.rel = 'noopener';
	ctx.textContent = item.context;
	body.appendChild(ctx);

	const sep = document.createElement('span');
	sep.className = 'entry-sep';
	sep.textContent = '·';
	body.appendChild(sep);

	if (item.descUrl) {
		const a = document.createElement('a');
		a.className = 'entry-desc';
		a.href = item.descUrl;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = item.desc;
		a.title = item.desc;
		body.appendChild(a);
	} else {
		const span = document.createElement('span');
		span.className = 'entry-desc';
		span.textContent = item.desc;
		span.title = item.desc;
		body.appendChild(span);
	}

	li.appendChild(body);

	const timeEl = document.createElement('span');
	timeEl.className = 'entry-time';
	timeEl.textContent = relativeTime(item.date);
	li.appendChild(timeEl);

	return li;
}

function renderPREntry(item) {
	const li = document.createElement('li');
	li.className = `entry entry-${item.type} entry--pr`;

	const badge = document.createElement('span');
	badge.className = `badge badge-${item.type}`;
	badge.textContent = item.label;
	li.appendChild(badge);

	const body = document.createElement('div');
	body.className = 'entry-body--pr';

	const title = document.createElement('a');
	title.className = 'pr-title';
	title.href = item.descUrl ?? item.contextUrl;
	title.target = '_blank';
	title.rel = 'noopener';
	title.textContent = item.desc;
	title.title = item.desc;
	body.appendChild(title);

	const sub = document.createElement('div');
	sub.className = 'pr-sub';

	const repoLink = document.createElement('a');
	repoLink.className = 'pr-repo';
	repoLink.href = item.contextUrl;
	repoLink.target = '_blank';
	repoLink.rel = 'noopener';
	repoLink.textContent = item.context;
	sub.appendChild(repoLink);

	if (item.prNumber) {
		appendSep(sub);
		const num = document.createElement('span');
		num.className = 'pr-num';
		num.textContent = `#${item.prNumber}`;
		sub.appendChild(num);
	}

	if (item.actionLabel) {
		appendSep(sub);
		const act = document.createElement('span');
		act.className = 'pr-action';
		act.textContent = item.actionLabel;
		sub.appendChild(act);
	}

	body.appendChild(sub);
	li.appendChild(body);

	const timeEl = document.createElement('span');
	timeEl.className = 'entry-time';
	timeEl.textContent = relativeTime(item.date);
	li.appendChild(timeEl);

	return li;
}

function appendSep(parent) {
	const sep = document.createElement('span');
	sep.className = 'pr-sep';
	sep.textContent = '·';
	parent.appendChild(sep);
}

// ── Fetch ─────────────────────────────────────────────────

async function fetchAllEvents() {
	const headers = { Accept: 'application/vnd.github.v3+json' };
	const fetchPage = async page => {
		const res = await fetch(
			`${API_BASE}/users/${USERNAME}/events?per_page=100&page=${page}`,
			{ headers }
		);
		if (res.status === 403 || res.status === 429) throw new Error('rate-limited');
		if (!res.ok) return [];
		return res.json();
	};
	const [p1, p2, p3] = await Promise.all([
		fetchPage(1),
		fetchPage(2).catch(() => []),
		fetchPage(3).catch(() => []),
	]);
	return [...p1, ...p2, ...p3];
}

// ── Render / Load ─────────────────────────────────────────

function render(items, ts) {
	if (!items.length) {
		card.dataset.state = 'empty';
		messageEl.textContent = 'No recent public activity.';
		return;
	}
	entriesEl.replaceChildren(...items.map(renderEntry));
	footerEl.textContent = `↺ updated ${relativeTime(new Date(ts).toISOString())}`;
	card.dataset.state = 'ready';
}

async function load() {
	card.dataset.state = 'loading';
	messageEl.textContent = 'Loading…';

	try {
		const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
		if (cached && Date.now() - cached.ts < CACHE_TTL) {
			renderHeatmap(cached.heatCells);
			render(cached.items, cached.ts);
			return;
		}
	} catch {}

	try {
		const events = await fetchAllEvents();
		const items = parseEvents(events);
		const heatCells = buildHeatmapData(events);
		const ts = Date.now();
		try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, heatCells, ts })); } catch {}
		renderHeatmap(heatCells);
		render(items, ts);
	} catch (err) {
		console.error('[gh-activity]', err);
		card.dataset.state = 'error';
		messageEl.textContent = err.message === 'rate-limited'
			? 'Rate limited — try again in a moment.'
			: 'Could not load activity.';
	}
}

load();
