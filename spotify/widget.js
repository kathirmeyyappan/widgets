const WORKER_URL = "https://spotify-widget.kathirmey.workers.dev";
const POLL_INTERVAL_MS = 7000;

const $ = id => document.getElementById(id);

const els = {
	card: $("card"),
	art: $("art"),
	statusLabel: $("status-label"),
	title: $("title"),
	artist: $("artist"),
	progress: $("progress"),
};

function render(state) {
	els.card.href = state.songUrl ?? "#";
	els.art.src = state.albumArt ?? "";
	els.title.textContent = state.title ?? "—";
	els.artist.textContent = state.artist ?? "—";

	if (state.isPlaying) {
		els.statusLabel.textContent = "Now playing";
		const pct = state.durationMs ? (state.progressMs / state.durationMs) * 100 : 0;
		els.progress.style.width = `${pct}%`;
	} else if (state.title) {
		els.statusLabel.textContent = "Last played";
		els.progress.style.width = "100%";
	} else {
		els.statusLabel.textContent = "Not playing";
		els.progress.style.width = "0%";
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

poll();
setInterval(poll, POLL_INTERVAL_MS);
