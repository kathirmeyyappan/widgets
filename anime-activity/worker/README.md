# anime-activity-widget worker

Cloudflare Worker for the anime-activity widget. Proxies the official MAL API.

## Deploy

```bash
cd anime-activity/worker
wrangler secret put MAL_ACCESS_TOKEN
wrangler deploy
```

## Token

`MAL_ACCESS_TOKEN` is a MAL OAuth access token with `read` scope. Easiest sources:
- Grab the current one from any other MAL-authenticated app you already run.
- Or do the one-time auth-code flow (see https://myanimelist.net/apiconfig/references/authorization).

MAL access tokens expire every ~30 days. When the widget starts returning errors, regenerate the token and re-run `wrangler secret put MAL_ACCESS_TOKEN`. No refresh-token logic lives in the worker by design.

For local dev, set `MAL_ACCESS_TOKEN` in `.dev.vars` (gitignored).

## Endpoint

`GET /?limit=N` → `{ anime: [...], manga: [...] }`, each item shaped as `{ title, url, image, status, score, progress, total, date }`. `plan_to_watch` / `plan_to_read` entries are filtered out. `limit` clamps to 1–20, defaults to 3.
