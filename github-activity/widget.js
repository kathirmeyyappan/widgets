const USERNAME = 'kathirmeyyappan';
const API_BASE = 'https://api.github.com';
const CACHE_KEY = 'gh-activity-v1';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_ITEMS = 10;

const card = document.getElementById('card');
const entriesEl = document.getElementById('entries');
const messageEl = document.getElementById('message');
const footerEl = document.getElementById('footer-text');

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

function parseEvents(events) {
	const items = [];
	const seenPushRepo = new Set();

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
			const count = ev.payload.size ?? commits.length;
			const branch = (ev.payload.ref ?? '').replace('refs/heads/', '');
			const msg = commits[0]?.message?.split('\n')[0];
			items.push({
				type: 'push', label: 'PUSH',
				context: branch ? `${repoShort}:${branch}` : repoShort,
				contextUrl: repoUrl,
				desc: msg || `${count} commit${count !== 1 ? 's' : ''}`,
				descUrl: commits[0] ? `${repoUrl}/commit/${commits[0].sha}` : null,
				date,
			});

		} else if (ev.type === 'PullRequestEvent') {
			const pr = ev.payload.pull_request;
			const action = ev.payload.action;
			if (action === 'opened') {
				items.push({
					type: 'pr-open', label: 'PR',
					context: repoShort, contextUrl: repoUrl,
					desc: pr.title, descUrl: pr.html_url,
					date,
				});
			} else if (action === 'closed' && pr?.merged) {
				items.push({
					type: 'pr-merge', label: 'MERGE',
					context: repoShort, contextUrl: repoUrl,
					desc: pr.title, descUrl: pr.html_url,
					date,
				});
			}

		} else if (ev.type === 'PullRequestReviewEvent') {
			const pr = ev.payload.pull_request;
			const state = (ev.payload.review?.state ?? 'commented').toLowerCase();
			const stateLabel = {
				approved: 'approved',
				changes_requested: 'changes requested',
				commented: 'commented on',
			}[state] ?? 'reviewed';
			items.push({
				type: 'review', label: 'REV',
				context: repoShort, contextUrl: repoUrl,
				desc: `${stateLabel}: ${pr.title}`,
				descUrl: ev.payload.review?.html_url ?? pr.html_url,
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

function renderEntry(item) {
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

async function fetchEvents() {
	const res = await fetch(
		`${API_BASE}/users/${USERNAME}/events?per_page=100`,
		{ headers: { Accept: 'application/vnd.github.v3+json' } }
	);
	if (res.status === 403 || res.status === 429) throw new Error('rate-limited');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

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
			render(cached.items, cached.ts);
			return;
		}
	} catch {}

	try {
		const events = await fetchEvents();
		const items = parseEvents(events);
		const ts = Date.now();
		try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, ts })); } catch {}
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
