# Anime Activity Widget — Architecture

Two-part system: a static frontend (`anime-activity/`) and a Cloudflare Worker (`anime-activity/worker/`) that talks to the official MAL API. The browser never sees the OAuth token.

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ fetch on page load
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ↕ official MAL API v2 (OAuth)
```

## Data

Worker hits MAL's official endpoints in parallel:
- `GET /v2/users/@me/animelist?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture&sort=list_updated_at`
- `GET /v2/users/@me/mangalist?fields=list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture&sort=list_updated_at`

Filters out `plan_to_watch` / `plan_to_read`, returns `{ anime: [...], manga: [...] }` with each entry pre-shaped as `{ title, url, image, status, score, progress, total, date }`. Progress + total are always populated — the official API doesn't drop them on "X/?" entries the way Jikan does.

## Flow

`widget.js`: `GET worker?limit=LIMIT` → for each medium, render into its own section (anime / manga). No client-side filter, sort, or normalize — the worker did all that.

## Worker

- OAuth refresh-token flow with an in-memory access-token cache (refresh ~1 h before MAL's 30-day expiry).
- Same CORS pattern as the Spotify worker (`https://kathirm.com` + `127.0.0.1` for local).
- No retry, no per-request caching — MAL's official API is reliable enough that a single bad response should surface to the user.

Secrets (set via Cloudflare dashboard):
- `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `MAL_REFRESH_TOKEN`

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
