# Anime Activity Widget — Architecture

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ GET ?days=N
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ↕ X-MAL-Client-ID (read-only, no OAuth)
MAL API v2
```

The worker addresses the user by name (not `@me`), which lets MAL accept just the `X-MAL-CLIENT-ID` header — no OAuth, no tokens, nothing that expires.

## Worker

Hits `/v2/users/{username}/animelist` + `/mangalist` in parallel (each capped at 100 most-recently-updated entries, `nsfw=true` to include R+/Rx), filters `plan_to_watch` / `plan_to_read`, merges, drops anything older than the requested window, sorts by `updated_at` desc, returns `{ entries: [...] }`. Each entry: `{ type, unit, title, url, image, status, score, progress, total, date }`.

- Single secret: `MAL_CLIENT_ID` (Cloudflare). Never expires.
- `?days=N` clamps 1–90, defaults to 7.
- Same CORS pattern as the Spotify worker.

Setup in `worker/README.md`.

## Frontend

`widget.js`: one `fetch`, render each entry into a `<ul>` with a type badge per row. No client-side filter / sort / merge — the worker does all that.

`widget.css`: uses container queries on `.inner` so narrow embeds restack the cover + meta + timestamp without touching the wide layout.

## Files

- `index.html` — single card with `<ul id="entries">`.
- `widget.css` — siloed (forked from `spotify/widget.css`).
- `widget.js` — fetch + render.
- `worker/src/index.js` — MAL proxy.

## Future work

- Polling: add `setInterval` if you want live refresh.
- Retry/backoff if MAL ever flakes.
- If MAL ever locks this endpoint behind Bearer auth, add a refresh-token flow in the worker (mirror the Spotify pattern).
