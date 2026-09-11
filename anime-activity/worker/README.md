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

`GET /?days=N` → `{ entries, gateOk }` — every anime + manga **progress** update from the last N days, merged and sorted by date desc. Each item: `{ id, type, unit, title, url, image, status, score, progress, total, nsfw, date }`. `plan_to_watch` / `plan_to_read` entries are filtered out. `days` clamps to 1–90, defaults to 7.

`gateOk` is false when the RSS feeds couldn't be read, in which case the gate is skipped and the frontend raises a warning banner.

## Why the RSS feeds get fetched too

The API's `updated_at` moves on any list edit, so changing a score resurfaces a long-finished show as new activity. The public per-user RSS feeds only move on episode/chapter bumps, so the worker uses them as a membership test: an entry survives if the feed saw progress on it inside the window.

Membership only — the gate never re-dates anything, so every displayed value including the timestamp stays the API's own. R+/Rx titles (and any with a null rating) bypass the gate entirely, since they're stripped from the feeds and gating on their absence would delete exactly what `nsfw=true` exists to include.

No auth, no state, and no added caching — one page load is one request, so a TTL would only delay a new title's first appearance.

See `../ARCHITECTURE.md` for the remaining trade-off (bounded feed length).
