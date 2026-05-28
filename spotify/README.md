# Spotify widget

"Now-playing" card backed by a Cloudflare Worker. Polls every 7s, falls back to last played when idle.

**Deploy worker:** `cd worker && wrangler deploy`

Worker secrets (set in Cloudflare): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`

CORS allows `kathirm.com` and `127.0.0.1`.

See [WORKER_CACHE_SUGGESTION.md](WORKER_CACHE_SUGGESTION.md) if things start getting rate-limited because of high traffic or bad actors.
