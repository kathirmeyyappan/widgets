# anime-activity-widget worker

Cloudflare Worker for the anime-activity widget. Proxies MAL's official API using read-only client-ID auth — no tokens, no expiry, no refresh logic.

## Deploy

```bash
cd anime-activity/worker
wrangler secret put MAL_CLIENT_ID
wrangler deploy
```

For local dev, set `MAL_CLIENT_ID` in `.dev.vars` (gitignored).

## Why no OAuth?

The worker calls `/v2/users/{username}/animelist` (by name, not `@me`) with only the `X-MAL-CLIENT-ID` header. MAL accepts this for public read access — the target profile just has to be public. The client ID never expires.

If MAL ever tightens this and starts requiring Bearer auth on this endpoint, the worker will start 401-ing and we'd switch to the refresh-token flow.

## Endpoint

`GET /?days=N` → `{ entries: [...] }` — every anime + manga **progress** update from the last N days, merged and sorted by date desc. Each item: `{ id, type, unit, title, url, image, status, score, progress, total, date }`. `plan_to_watch` / `plan_to_read` entries are filtered out. `days` clamps to 1–90, defaults to 7.

## Why the RSS feeds get fetched too

The API's `updated_at` moves on any list edit, so changing a score resurfaces a long-finished show as new activity. The public per-user RSS feeds only move on episode/chapter bumps, so the worker uses them to drop non-progress edits and date the rest by when the progress happened.

The feeds gate only, never add — displayed entries still come entirely from the API, so `nsfw=true` remains the only control over R+/Rx titles. No auth, no state. If the feeds are unavailable the worker falls back to raw `updated_at` ordering.

See `../ARCHITECTURE.md` for the trade-offs (MAL's ~1h RSS cache, bounded feed length).
