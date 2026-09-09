# Anime Activity Widget — Architecture

```
Browser (kathirm.com/widgets/anime-activity/)
  ↕ GET ?days=N
Cloudflare Worker (anime-activity-widget.kathirmey.workers.dev)
  ├ X-MAL-Client-ID (read-only, no OAuth) → MAL API v2   (what to show)
  └ public RSS, no auth                   → rss.php      (when it happened)
```

The worker addresses the user by name (not `@me`), which lets MAL accept just the `X-MAL-CLIENT-ID` header — no OAuth, no tokens, nothing that expires.

## Worker

Hits `/v2/users/{username}/animelist` + `/mangalist` in parallel (each capped at 100 most-recently-updated entries, `nsfw=true` to include R+/Rx), filters `plan_to_watch` / `plan_to_read`, merges, applies the progress gate below, drops anything older than the requested window, sorts by date desc, returns `{ entries: [...] }`. Each entry: `{ id, type, unit, title, url, image, status, score, progress, total, date }`.

- Single secret: `MAL_CLIENT_ID` (Cloudflare). Never expires.
- `?days=N` clamps 1–90, defaults to 7.
- Same CORS pattern as the Spotify worker.

### The progress gate

`list_status.updated_at` moves on *any* list edit — score, status, notes — and the API exposes no separate "progress changed" timestamp, so rescoring an old show is indistinguishable from watching it today.

MAL's per-user RSS feeds (`rss.php?type=rw|rm`) only move on episode/chapter bumps, so the worker fetches both alongside the API and uses them to drop entries with no real progress and to re-date the rest to when it happened.

The gate only ever removes. What's rendered still comes from the API list, so `nsfw=true` stays the one knob for R+/Rx — which is why this pairs the two sources instead of just switching to RSS. No stored state; feeds are edge-cached 15 min since MAL rate-limits `rss.php`. If they fail, the worker logs and falls back to raw `updated_at` — a noisy feed beats a blank one.

Two caveats: MAL caches `rss.php` for up to an hour, and the feeds are bounded, so progress older than a feed's tail gets gated out even if it's inside `?days=N` (fine at 10 days, revisit if the window grows).

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
- If `rss.php` ever dies, `myanimelist.net/history/{user}` is the other progress-only source — strictly accurate, but HTML to scrape and timestamps rendered in the profile's local timezone.
- If MAL ever locks this endpoint behind Bearer auth, add a refresh-token flow in the worker (mirror the Spotify pattern).
