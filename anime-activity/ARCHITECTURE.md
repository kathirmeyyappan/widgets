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

**Data source:** `GET https://api.jikan.moe/v4/users/Uji_Gintoki_Bowl/userupdates`

Returns `{ data: { anime: [...], manga: [...] } }`. Each entry includes the MAL entry (id, url, title, cover image), the user's `status` / `score`, progress (`episodes_seen` + `episodes_total` for anime, `chapters_read` + `chapters_total` for manga), and the update `date`.

**Flow** (`widget.js`):
1. Fetch the endpoint on page load (no polling — one request per visit is plenty).
2. Normalize anime and manga entries into a unified shape, tagging each with its `type`.
3. Drop anything whose status is `"Plan to Watch"` or `"Plan to Read"`.
4. Sort by `date` desc, take the top 3.
5. Render each row: cover thumbnail, title (linked to MAL), type badge, status / progress / score, relative timestamp via `Intl.RelativeTimeFormat`.

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
