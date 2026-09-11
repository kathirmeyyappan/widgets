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

Hits `/v2/users/{username}/animelist` + `/mangalist` in parallel (each capped at 100 most-recently-updated entries, `nsfw=true` to include R+/Rx), filters `plan_to_watch` / `plan_to_read`, merges, applies the progress gate below, drops anything older than the requested window, sorts by date desc, returns `{ entries, gateOk }`. Each entry: `{ id, type, unit, title, url, image, status, score, progress, total, nsfw, date }`.

- Single secret: `MAL_CLIENT_ID` (Cloudflare). Never expires.
- `?days=N` clamps 1–90, defaults to 7.
- Same CORS pattern as the Spotify worker.

### The progress gate

`list_status.updated_at` moves on *any* list edit — score, status, notes — and the API exposes no separate "progress changed" timestamp, so rescoring an old show is indistinguishable from watching it today.

MAL's per-user RSS feeds (`rss.php?type=rw|rm`) only move on episode/chapter bumps, so the worker fetches both alongside the API and uses them as a **membership test**: an entry survives if the feed saw progress on it inside the window.

Membership only — the gate never re-dates anything. Every rendered value, timestamps included, stays the API's own. That's what keeps it live: bump a show you were already watching and the feed vouches for it while the displayed time comes from the API, so a feed lagging behind can't make a fresh episode read as days old.

**R+/Rx titles bypass the gate entirely.** They're stripped from the feeds, so their absence proves nothing — gating on it would silently delete exactly the titles `nsfw=true` exists to include. Entries whose `nsfw` rating is null (MAL didn't report one) bypass for the same reason: failing open shows a stale entry, failing closed loses a real one.

No stored state and no added caching — the widget fetches once per page load and never polls, so a TTL would rarely hit and would only delay a new title's first appearance. If the feeds fail the worker logs, sets `gateOk: false`, and falls back to raw `updated_at`; the frontend raises a banner rather than quietly showing a noisier feed.

One caveat: the feeds are bounded, so progress older than a feed's tail gets gated out even if it's inside `?days=N`. Fine at 10 days; revisit if the window grows.

Setup in `worker/README.md`.

## Frontend

`widget.js`: one `fetch`, render each entry into a `<ul>` with a type badge per row. No client-side filter / sort / merge — the worker does all that. On `gateOk: false` it logs and shows a dismissible warning banner.

`widget.css`: uses container queries on `.inner` so narrow embeds restack the cover + meta + timestamp without touching the wide layout.

## Files

- `index.html` — single card with `<ul id="entries">`, plus the degraded-feed banner.
- `widget.css` — siloed (forked from `spotify/widget.css`).
- `widget.js` — fetch + render.
- `worker/src/index.js` — MAL proxy.

## Future work

- Polling: add `setInterval` if you want live refresh.
- Retry/backoff if MAL ever flakes.
- If `rss.php` ever dies, `myanimelist.net/history/{user}` is the other progress-only source — strictly accurate, but HTML to scrape and timestamps rendered in the profile's local timezone.
- If MAL ever locks this endpoint behind Bearer auth, add a refresh-token flow in the worker (mirror the Spotify pattern).
