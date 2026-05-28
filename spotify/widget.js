const $ = id => document.getElementById(id);

const els = {
	card: $("card"),
	art: $("art"),
	title: $("title"),
	artist: $("artist"),
	album: $("album"),
	progress: $("progress"),
};

function render(state) {
	if (!state.isPlaying) {
		els.card.removeAttribute("href");
		els.art.removeAttribute("src");
		els.title.textContent = "Not playing";
		els.artist.textContent = "—";
		els.album.textContent = "—";
		els.progress.style.width = "0%";
		return;
	}
	els.card.href = state.songUrl ?? "#";
	els.art.src = state.albumArt ?? "";
	els.title.textContent = state.title;
	els.artist.textContent = state.artist;
	els.album.textContent = state.album;
	const pct = state.durationMs ? (state.progressMs / state.durationMs) * 100 : 0;
	els.progress.style.width = `${pct}%`;
}

const mockPlaying = {
	isPlaying: true,
	title: "Song title",
	artist: "Artist name",
	album: "Album name",
	albumArt: "",
	songUrl: "https://open.spotify.com",
	progressMs: 45000,
	durationMs: 180000,
};

const mockIdle = { isPlaying: false };

$("mock-playing").addEventListener("click", () => render(mockPlaying));
$("mock-idle").addEventListener("click", () => render(mockIdle));

render(mockIdle);
