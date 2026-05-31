# Spotify Widget — Architecture

## Overview

Two-part system: a static frontend (`spotify/`) served via GitHub Pages, and a Cloudflare Worker (`spotify/worker/`) that handles all Spotify API communication. The browser never touches Spotify directly and never sees any secrets.

```
Browser (kathirm.com/widgets/spotify/)
  ↕ polls every 7s (only when tab is focused)
Cloudflare Worker (spotify-widget.kathirmey.workers.dev)
  ↕ Spotify Web API
```

---

## Frontend (`spotify/`)

**Files:** `index.html`, `widget.css`, `widget.js`

**Polling:** `widget.js` calls the worker every 7 seconds via `setInterval`. Polling is paused when the tab loses focus (`visibilitychange`) and resumes (with an immediate poll) when the tab regains focus.

**Render states:** driven by the `isPlaying` and `title` fields in the worker response:
- `isPlaying: true` → "Now playing" — shows track, art, live progress bar
- `isPlaying: false` + `title` present → "Last played" — shows track, art, static progress bar
- `isPlaying: false` + no `title` → "Not playing" — empty card

**Progress ticking:** a separate `setInterval(tick, 1000)` advances the progress bar locally between polls, anchored to the `capturedAt` timestamp returned by the worker. Keeps the bar smooth without extra API calls.

---

## Worker (`spotify/worker/src/index.js`)

### Secrets (stored in Cloudflare, never in source)
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

### Request flow (per incoming poll)

```
1. Check CORS — allow kathirm.com + 127.0.0.1 (local dev), reject others
2. Get access token (see token cache below)
3. GET /me/player/currently-playing
   ├─ 200 → return track with isPlaying: true
   │         also prime the last-played cache with this track (free, no extra call)
   └─ 204 → nothing playing, go to last-played cache logic (see below)
```

### In-memory caches (per worker instance)

**Token cache**
- Spotify access tokens expire in 3600s. Fetching a new one on every poll would hit token endpoint rate limits.
- Cache the token in memory, reuse until 60s before expiry, then refresh.
- `cachedToken`, `tokenExpiresAt`

**Last-played cache** (`RECENT_TTL_MS = 60s`)
- `recently-played` has a stricter rate limit than `currently-playing`. Polling it every 7s caused sustained 429s with up to ~57min penalty windows.
- While idle (204), only call `recently-played` if cache is empty or older than 60s.
- **Priming:** whenever `currently-playing` returns a live track, that track is also written into the last-played cache. This means pausing stops `recently-played` from being called at all — the paused track is already cached. `recently-played` only fires as a cold-start fallback.
- **On failure (429/bad response):** if a real track is already cached, keep it — don't clobber it with the empty not-playing state. Only write the offline fallback if nothing is cached yet.
- `recentCache`, `recentCachedAt`

### CORS
- Allowed origins: `https://kathirm.com`, `http://127.0.0.1` (any port)
- All responses always include CORS headers, even on errors, so the browser never gets blocked by a missing header on a failed request.

### Error handling
- Non-JSON Spotify responses (rate-limit strings, etc.) are caught in `spotifyJson()`, logged to `console.error` (visible in `wrangler tail`), and return `null` rather than throwing.
- Uncaught exceptions fall to a top-level catch, log the message, and return `{ isPlaying: false }` with valid CORS headers.

---

## Known limitations / future considerations

- **Cache is per worker instance.** Cloudflare may spin up multiple instances; each starts with empty caches. In practice for a personal widget this means occasional extra `recently-played` calls on cold starts, not a sustained problem.
- **No persistent storage.** KV or Durable Objects would make the cache truly global across instances, but adds complexity not warranted for a single-user widget.
- **Spotify app is in Development mode.** Rate limits are tighter than Extended Quota mode. This is fine for personal use (max 25 users, just you).
