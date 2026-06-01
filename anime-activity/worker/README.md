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

`GET /?limit=N` → `{ entries: [...] }` — a single merged-and-sorted list of recent anime + manga updates. Each item is shaped as `{ type, unit, title, url, image, status, score, progress, total, date }`. `plan_to_watch` / `plan_to_read` entries are filtered out. `limit` clamps to 1–20, defaults to 10.
