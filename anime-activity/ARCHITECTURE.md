# Anime Activity Widget — Architecture

## Overview

Single-part system: a static frontend (`anime-activity/`) served via GitHub Pages that calls the [Jikan v4 API](https://docs.api.jikan.moe/) directly from the browser. No worker, no backend, no secrets.

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ fetch on page load
Jikan API (api.jikan.moe/v4)
  ↕ scrapes MyAnimeList
```

This is deliberately simpler than the Spotify widget. MAL profile data is public, so there's nothing to hide behind a worker.

---

## Frontend (`anime-activity/`)

**Files:** `index.html`, `widget.css`, `widget.js`

**Data source:** Two parallel calls to Jikan's history endpoints —
- `GET https://api.jikan.moe/v4/users/Uji_Gintoki_Bowl/history/anime`
- `GET https://api.jikan.moe/v4/users/Uji_Gintoki_Bowl/history/manga`

Each returns `{ data: [{ entry: { mal_id, url, title, images }, increment, date }] }`. `increment` is the episode (anime) or chapter (manga) number that was watched/read; `date` is when the event happened. The history endpoint scrapes MAL's `history.php`, which is more reliable than scraping the profile page (what `/userupdates` does) and isn't capped at 3 per type.

**Flow** (`widget.js`, organized into commented sections — Config, DOM, Fetching, Data processing, Rendering, Main):
1. Fetch both histories in parallel.
2. Normalize each event into a flat shape (`{ type, malId, title, url, image, increment, unit, date }`).
3. Dedupe within each type by `malId`, keeping the most recent event per series — history contains one entry per increment, so a single anime appears many times.
4. Merge anime + manga, sort by `date` desc.
5. Take top `LIMIT` for display; log the full pool to the console.
6. Render each row: cover, title (linked), type badge, "Episode N" / "Chapter N", relative timestamp.

**Retry:** `fetchWithRetry` retries on 429/500/502/503/504 with exponential backoff (3 attempts, 600 ms base). Jikan can return 500/`UpstreamException` when MAL throttles its scraper; usually clears on retry.

**Tradeoff vs `/userupdates`:** History events don't include the user's list `status`, `score`, or `episodes_total`/`chapters_total`. The display loses "X/Y" progress and the score line in exchange for: (a) reliable endpoint not subject to MAL's profile-page block, and (b) arbitrary `LIMIT` rather than the 3-per-type cap.

**Render states** (driven by `data-state` on `#card`):
- `loading` → show "Loading…" message, hide list
- `ready` → show list, hide message
- `empty` → show "No recent activity." (every entry was plan-to-watch/read, or the user has no list)
- `error` → show "Could not load activity." (fetch failed)

---

## Styling

`widget.css` is **fully siloed** to this widget. It was forked from `spotify/widget.css` as a starting baseline (dark theme, Inter font, card layout) but the file is independent — Spotify CSS changes will not affect this widget and vice versa. Any future restyle here stays here.

---

## Rate limits

Jikan enforces roughly **3 requests per second** and **60 per minute** per IP. The widget makes exactly one request per page load, so this is a non-issue.

---

## Known limitations / future considerations

- **Jikan is an unofficial scraper.** It can lag behind MAL by a few minutes and very occasionally fails. For a personal widget that's an acceptable tradeoff for avoiding OAuth.
- **Requires a public MAL profile.** The target profile (`Uji_Gintoki_Bowl`) is public, so this is fine today.
- **No client-side caching.** Each page load triggers a fresh fetch. Acceptable at this scale; revisit if the widget ever gets embedded somewhere high-traffic.
- **No polling.** Refresh requires reloading the page. Adding `setInterval` is trivial if live updates become useful.
- **Migration path to official MAL API.** If Jikan becomes unreliable, the fetch layer can be swapped for a Cloudflare Worker that proxies `api.myanimelist.net/v2/users/@me/animelist?sort=list_updated_at` — same widget UI, OAuth-based backend mirroring the Spotify pattern.
