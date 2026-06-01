# Anime Activity Widget — Architecture

## Overview

Single-part system: a static frontend (`anime-activity/`) served via GitHub Pages that calls the [Jikan v4 API](https://docs.api.jikan.moe/) directly from the browser. No worker, no backend, no secrets.

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ fetch on page load (with bounded retry)
Jikan API (api.jikan.moe/v4)
  ↕ scrapes MyAnimeList
```

This is deliberately simpler than the Spotify widget. MAL profile data is public, so there's nothing to hide behind a worker.

---

## Frontend (`anime-activity/`)

**Files:** `index.html`, `widget.css`, `widget.js`

**Data source:** `GET https://api.jikan.moe/v4/users/Uji_Gintoki_Bowl/userupdates`

Returns `{ data: { anime: [...], manga: [...] } }`. Each entry includes the MAL entry (id, url, title, cover image), the user's `status` / `score`, progress (`episodes_seen` + `episodes_total` for anime, `chapters_read` + `chapters_total` for manga), and the update `date`.

**Layout:** two independent sections, "Recent Anime" and "Recent Manga". Each medium is processed separately and gets its own list — anime and manga are never merged into a single sorted feed. This is deliberate: with the per-medium cap (see below), merging would let a more-active medium completely bury the other when one is dormant.

**Flow** (`widget.js`):
1. Fetch the endpoint on page load (no polling).
2. For each medium independently:
   - Normalize entries into a unified shape, tagging with `type`.
   - Drop anything whose status is `"Plan to Watch"` / `"Plan to Read"`.
   - Sort by `date` desc, slice to `LIMIT`.
3. Render each section via `renderSection(medium, entries)` — populates its `<ul.entries data-medium="…">` or shows the `.empty-hint` if nothing to display.

**Render states** (driven by `data-state` on `#card`):
- `loading` → hide both sections, show "Loading…" in `#message`
- `ready` → show both sections (each may be empty with its own hint)
- `error` → hide both sections, show "Could not load activity." in `#message`

(No top-level `empty` state — if both sections are empty post-filter, each renders its own "No recent…" hint, which is enough.)

---

## Reliability — retry with backoff

`/userupdates` scrapes MAL's HTML profile page, which sometimes returns non-200 to Jikan's scraper (Jikan surfaces this as `500 / UpstreamException`). `fetchWithRetry` retries on `429, 500, 502, 503, 504` with exponential backoff: up to 3 retries at 600ms, 1.2s, 2.4s. Failures are `console.warn`'d on each retry; terminal failure surfaces the `error` state.

In practice these blocks are short-lived — the second attempt almost always succeeds.

---

## Per-medium cap (important)

`/userupdates` returns **at most 3 entries per medium** — this is a MAL constraint (the profile page's "Last Updates" block only shows 3 each). Setting `LIMIT` higher than 3 has no effect; the API simply won't return more. To support a larger LIMIT we'd need to swap to `/users/{user}/history/{type}`, which is uncapped but loses `status` / `score` / totals — see "Future considerations" below.

---

## Styling

`widget.css` is **fully siloed** to this widget. It was forked from `spotify/widget.css` as a starting baseline (dark theme, Inter font, card layout) but the file is independent — Spotify CSS changes will not affect this widget and vice versa.

---

## Rate limits

Jikan enforces roughly **3 requests per second** and **60 per minute** per IP. The widget makes one request per page load (plus up to 3 retries on transient failure), so this is comfortably under the limit.

---

## Known limitations / future considerations

- **Jikan is an unofficial scraper.** It can lag behind MAL by a few minutes and occasionally fails — handled by the retry logic above.
- **Requires a public MAL profile.** The target profile (`Uji_Gintoki_Bowl`) is public.
- **No client-side caching.** Each page load triggers a fresh fetch. Fine at this scale.
- **No polling.** Refresh requires reloading the page. Adding `setInterval` is trivial if useful.
- **Larger feeds.** If the 3-per-medium cap becomes limiting, swap to `/users/{user}/history/{type}` (anime + manga separately). That endpoint is uncapped but only provides `entry.name` / `mal_id` / `url` plus `increment` and `date` — no `status` / `score` / totals — so the row layout would need to drop the "X/Y · Scored N" detail line, or enrich displayed entries by hitting `/anime/{id}` / `/manga/{id}` (with `localStorage` caching to keep page loads fast).
- **Migration path to official MAL API.** If Jikan becomes unreliable, the fetch layer can be swapped for a Cloudflare Worker that proxies `api.myanimelist.net/v2/users/@me/animelist?sort=list_updated_at` — same widget UI, OAuth-based backend mirroring the Spotify pattern.
