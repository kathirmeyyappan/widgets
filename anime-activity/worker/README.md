# anime-activity-widget worker (RSS variant)

Cloudflare Worker that builds the recent-activity feed from MAL's profile RSS feeds. The MAL `/v2/users/{username}/{kind}list?sort=list_updated_at` endpoint serves data from a backend cache that can lag the live profile by minutes-to-hours; RSS is generated from the live profile page so it tracks new updates immediately.

## Deploy

```bash
cd anime-activity/worker
wrangler secret put MAL_CLIENT_ID
wrangler deploy
```

For local dev, set `MAL_CLIENT_ID` in `.dev.vars` (gitignored).

## Sources

- `https://myanimelist.net/rss.php?type=rw&u={USERNAME}` — recently watched (anime)
- `https://myanimelist.net/rss.php?type=rm&u={USERNAME}` — recently read (manga)

RSS items carry title, link (with `mal_id`), status, progress, total, and `pubDate`. The worker parses these, merges anime + manga, filters plan-to-watch/read, sorts by date desc, slices to `limit`, then enriches each returned entry's cover image from MAL's public catalog API (`/v2/{type}/{id}?fields=main_picture`) using `X-MAL-CLIENT-ID`.

## Trade-off vs the MAL list variant

The RSS feed doesn't include the user's personal score, so every entry comes back with `score: null` and the frontend renders "Scored –". Everything else (title, url, image, status, progress, total, date) matches the previous shape exactly — drop-in compatible with the existing frontend.

## Endpoint

`GET /?limit=N` → `{ entries: [...] }`. Each item: `{ type, unit, title, url, image, status, score, progress, total, date }`. `Plan to Watch` / `Plan to Read` filtered out. `limit` clamps 1–20, defaults to 10.
