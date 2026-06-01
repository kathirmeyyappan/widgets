# Anime Activity Widget — Architecture

Two-part system: a static frontend (`anime-activity/`) and a Cloudflare Worker (`anime-activity/worker/`) that talks to the official MAL API. The browser never sees the OAuth token.

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ fetch on page load
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ↕ official MAL API v2 (OAuth)
```

## Data

Worker hits MAL's official endpoints in parallel using **client-ID-only auth** (no OAuth Bearer token):
- `GET /v2/users/{username}/animelist?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture&sort=list_updated_at`
- `GET /v2/users/{username}/mangalist?fields=list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture&sort=list_updated_at`

Addressing the user by name (not `@me`) lets MAL accept just the `X-MAL-CLIENT-ID` header for read-only access to a public profile. No token expiry, no refresh logic.

Filters out `plan_to_watch` / `plan_to_read`, returns `{ anime: [...], manga: [...] }` with each entry pre-shaped as `{ title, url, image, status, score, progress, total, date }`. Progress + total are always populated — the official API doesn't drop them on "X/?" entries the way Jikan does.

## Flow

`widget.js`: `GET worker?limit=LIMIT` → for each medium, render into its own section (anime / manga). No client-side filter, sort, or normalize — the worker did all that.

## Worker

- Single secret: `MAL_CLIENT_ID` (Cloudflare secret). Never expires.
- Parallel fetch of animelist + mangalist with `sort=list_updated_at`, filter plan-to-watch/read, shape the response.
- Same CORS pattern as the Spotify worker (`https://kathirm.com` + `127.0.0.1` for local).
- No OAuth, no tokens, no refresh. If MAL ever tightens this endpoint to require Bearer auth, we'd add the refresh-token flow then.

See `worker/README.md` for deploy + setup.

## Files

- `index.html` — two `<section>`s with `.entries[data-medium]` lists and `.empty-hint` placeholders.
- `widget.css` — fully siloed (forked from `spotify/widget.css`, independent thereafter).
- `widget.js` — flat module, single fetch + render.
- `worker/src/index.js` — token refresh + MAL proxy.

## Future work

- Larger LIMIT for a real activity log: the worker already accepts `?limit=N` (clamped 1–20). Page-load latency from the official API is consistently low; if a bigger feed feels good, just bump `LIMIT` in `widget.js`.
- Polling: add `setInterval` if you want live refresh.
- Retry/backoff on worker errors if MAL ever flakes.
