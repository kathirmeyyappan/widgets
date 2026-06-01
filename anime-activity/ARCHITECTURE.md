# Anime Activity Widget — Architecture

Two-part system: a static frontend (`anime-activity/`) and a Cloudflare Worker (`anime-activity/worker/`) that talks to the official MAL API. The browser never sees the OAuth token (there isn't one — see Worker section).

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ fetch on page load
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ↕ official MAL API v2 (X-MAL-Client-ID, read-only)
```

## Data

Worker hits MAL's official endpoints in parallel using **client-ID-only auth**:
- `GET /v2/users/{username}/animelist?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture&sort=list_updated_at`
- `GET /v2/users/{username}/mangalist?fields=list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture&sort=list_updated_at`

Addressing the user by name (not `@me`) lets MAL accept just the `X-MAL-CLIENT-ID` header for read-only access to a public profile. No token expiry, no refresh logic.

Filters out `plan_to_watch` / `plan_to_read`, merges anime + manga, sorts by `date` desc, slices to `limit`, and returns a single `{ entries: [...] }` array. Each entry is pre-shaped as `{ type, unit, title, url, image, status, score, progress, total, date }`.

## Flow

`widget.js`: `GET worker?limit=LIMIT` → render `entries` as a single mixed list with type badges per row. No client-side filter, sort, or merge — the worker did all that.

## Worker

- Single secret: `MAL_CLIENT_ID` (Cloudflare secret). Never expires.
- Parallel fetch of animelist + mangalist, filter plan-to-watch/read, merge, sort by `date` desc, slice to `limit`. Returns one flat array.
- Same CORS pattern as the Spotify worker (`https://kathirm.com` + `127.0.0.1` for local).
- No OAuth, no tokens, no refresh. If MAL ever tightens this endpoint to require Bearer auth, we'd add the refresh-token flow then.

See `worker/README.md` for deploy + setup.

## Files

- `index.html` — single card with a `<ul id="entries">` populated by JS.
- `widget.css` — fully siloed (forked from `spotify/widget.css`, independent thereafter).
- `widget.js` — flat module, single fetch + merge + render.
- `worker/src/index.js` — MAL proxy.

## Future work

- Polling: add `setInterval` if you want live refresh.
- Retry/backoff on worker errors if MAL ever flakes.
- Larger `LIMIT`: the worker accepts `?limit=N` (clamped 1–20). The merged log already handles whatever the worker returns.
