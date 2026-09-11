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

`GET /?days=N` → `{ entries, gate, gateOk }`.

`entries` is every anime + manga update from the last N days, merged and sorted by date desc. Each item: `{ id, type, unit, title, url, image, status, score, progress, total, nsfw, date }`. `plan_to_watch` / `plan_to_read` are filtered out. `days` clamps to 1–90, defaults to 7.

`gate` maps `"{type}:{id}"` to the ISO timestamp of the progress event MAL last published on its RSS feeds, which only move on episode/chapter bumps. It's returned raw and unapplied — the client decides how to use it. `gateOk` is false when the feeds couldn't be read, in which case `gate` is null and the client falls back to showing everything with a degraded-feed warning.

The feeds are edge-cached for 60s. Longer TTLs hurt: a bump on a series not yet in the cached feed would be filtered out client-side until the cache turns over.
