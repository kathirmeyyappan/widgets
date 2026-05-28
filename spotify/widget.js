const WORKER_URL = "https://spotify-widget.kathirmey.workers.dev";
const POLL_INTERVAL_MS = 7000;

const $ = id => document.getElementById(id);

const els = {
	card: $("card"),
	blurBg: $("blur-bg"),
	art: $("art"),
	statusLabel: $("status-label"),
	title: $("title"),
	artist: $("artist"),
	album: $("album"),
	progress: $("progress"),
	timeCurrent: $("time-current"),
	timeTotal: $("time-total"),
};

// Anchor for live ticking — set on each poll, frozen when not playing
let anchor = { ms: 0, at: 0, duration: 0, active: false };

function fmt(ms) {
	const s = Math.floor(ms / 1000);
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function tick() {
	if (!anchor.active) return;
	const current = Math.min(anchor.ms + (Date.now() - anchor.at), anchor.duration);
	els.progress.style.width = `${anchor.duration ? (current / anchor.duration) * 100 : 0}%`;
	els.timeCurrent.textContent = fmt(current);
}

function render(state) {
	els.card.href = state.songUrl ?? "#";

	const artUrl = state.albumArt ?? "";
	els.art.src = artUrl;
	els.blurBg.src = artUrl;

	els.title.textContent = state.title ?? "—";
	els.artist.textContent = state.artist ?? "—";
	els.album.textContent = state.album ?? "";

	if (state.isPlaying) {
		els.card.dataset.state = "playing";
		els.statusLabel.textContent = "Now playing";
		anchor = { ms: state.progressMs, at: state.capturedAt ?? Date.now(), duration: state.durationMs, active: true };
		els.timeTotal.textContent = fmt(state.durationMs);
		tick();
	} else if (state.title) {
		els.card.dataset.state = "idle";
		els.statusLabel.textContent = "Last played";
		anchor.active = false;
		els.progress.style.width = "0%";
		els.timeCurrent.textContent = "-:--";
		els.timeTotal.textContent = fmt(state.durationMs);
	} else {
		els.card.dataset.state = "offline";
		els.statusLabel.textContent = "Not playing";
		anchor.active = false;
		els.progress.style.width = "0%";
		els.timeCurrent.textContent = "00:00";
		els.timeTotal.textContent = "00:00";
	}
}

async function poll() {
	try {
		const res = await fetch(WORKER_URL);
		const data = await res.json();
		render(data);
	} catch {
		// silently keep last state on network error
	}
}

setInterval(tick, 1000);
poll();
setInterval(poll, POLL_INTERVAL_MS);
