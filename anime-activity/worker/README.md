# anime-activity-widget worker

Cloudflare Worker for the anime-activity widget. Proxies the official MAL API so the browser never sees the OAuth token.

## Deploy

```bash
cd anime-activity/worker
wrangler deploy
```

## Required secrets

Set via the Cloudflare dashboard (or `wrangler secret put`):

- `MAL_CLIENT_ID`
- `MAL_CLIENT_SECRET`
- `MAL_REFRESH_TOKEN` — obtained via the one-time OAuth flow (see https://myanimelist.net/apiconfig/references/authorization)

For local dev, mirror them in `.dev.vars` (gitignored).

## Endpoint

`GET /?limit=N` → `{ anime: [...], manga: [...] }`, each item shaped as `{ title, url, image, status, score, progress, total, date }`. `plan_to_watch` / `plan_to_read` entries are filtered out. `limit` clamps to 1–20, defaults to 3.
