# Anime Activity Widget — Architecture (RSS variant)

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ GET ?limit=N
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ↕ MAL profile RSS (real-time)  +  MAL public catalog API (covers)
```

The profile RSS feed is generated from the live "Last Updates" block on the user's MAL page, so new entries appear immediately — no backend-cache lag like `/v2/users/{username}/{kind}list?sort=list_updated_at`. Covers are still fetched from MAL's catalog API since RSS doesn't include them.

## Worker

Hits `/rss.php?type=rw&u={username}` + `/rss.php?type=rm&u={username}` in parallel, parses XML to pull title / link / description / pubDate, extracts `mal_id` from the link and status/progress/total from the description ("Reading - 36 of ? chapters" → `Reading`, `36`, `null`), filters plan-to-watch/read, merges, sorts by date desc, slices to `limit`. Then enriches each returned entry's cover via `/v2/{type}/{id}?fields=main_picture` with `X-MAL-CLIENT-ID`.

Returns `{ entries: [...] }` shaped as `{ type, unit, title, url, image, status, score, progress, total, date }`. **`score` is always `null`** (RSS doesn't expose the user's personal score — the only field we lose vs the MAL list variant).

- Single secret: `MAL_CLIENT_ID` (for the catalog enrichment requests). Never expires.
- `?limit=N` clamps 1–20, defaults to 10.
- Same CORS pattern as the Spotify worker.

Setup in `worker/README.md`.

## Frontend

Unchanged — same response shape. `widget.js`: one fetch, render. `widget.css`: container queries restack on narrow embeds.

## Files

- `index.html` — single card with `<ul id="entries">`.
- `widget.css` — siloed (forked from `spotify/widget.css`).
- `widget.js` — fetch + render.
- `worker/src/index.js` — RSS parser + MAL catalog enrichment.

## Future work

- Polling for live refresh.
- Retry/backoff if MAL's RSS or catalog API ever flakes.
- If we ever want personal scores back, fall back to a single `/v2/users/{username}/animelist?fields=list_status{score}` call and join by `mal_id` — accepting the same backend lag for that field only.
