# Anime Activity Widget — Architecture

Static frontend that calls the [Jikan v4 API](https://docs.api.jikan.moe/) directly from the browser. No worker, no secrets — MAL profile data is public.

## Data

`GET https://api.jikan.moe/v4/users/Uji_Gintoki_Bowl/userupdates` returns up to **3 anime + 3 manga** entries (this is a hard MAL cap — `LIMIT > 3` has no effect). Each entry has title, cover, status, score, progress, and update date.

## Flow

`widget.js`: fetch → for each medium independently filter out `Plan to Watch/Read` → sort by date desc → slice to `LIMIT` → render into its own section. Anime and manga are never merged so a dormant medium can't get buried.

## Reliability

`fetchWithRetry` retries on 429 / 5xx with exponential backoff (3 attempts, 600ms / 1.2s / 2.4s). Jikan occasionally 500s when MAL throttles its scraper; the second attempt almost always succeeds.

## Files

- `index.html` — two `<section>`s with `.entries[data-medium]` lists and `.empty-hint` placeholders.
- `widget.css` — fully siloed (forked from `spotify/widget.css`, independent thereafter).
- `widget.js` — flat module, no dependencies.

## Future work

- Want more than 3 per medium? Swap to `/users/{user}/history/{type}` (uncapped, but lacks status/score/totals — would need `/anime/{id}` lookups to fill that in).
- Want guaranteed reliability? Pivot to the official MAL API behind a Cloudflare Worker, mirroring the Spotify widget's setup.
