# Worker Response Caching

Add this if Spotify starts returning 429s. Not worth it for a personal portfolio — Spotify's limits are generous and caching adds lag.

## How it works

All visitors want the same data. Cache the last Spotify response in the worker and serve it to everyone within the TTL, so Spotify's API is called at most once per TTL window regardless of traffic.

```js
let responseCache = { data: null, expiresAt: 0 };

// top of fetch handler, before calling Spotify:
if (Date.now() < responseCache.expiresAt) {
  return json(responseCache.data, origin);
}

// ...fetch from Spotify, build responseObject...

responseCache = { data: responseObject, expiresAt: Date.now() + TTL_MS };
return json(responseObject, origin);
```

## TTL trade-off

Worst-case status change lag = **TTL + poll interval (7s)**.

| TTL | Worst-case lag | Spotify calls (100 visitors) |
|-----|---------------|------------------------------|
| 0s (no cache) | 7s | 100 / 7s |
| 2s | 9s | ~3–4 / 7s |
| 7s | 14s | ~1 / 7s |
| 14s | 21s | ~1 / 14s |

A 2–3s TTL gets most of the protection with barely noticeable extra lag.

## Isolate caveat

Cloudflare may spin up multiple Worker isolates under load — module-level state isn't globally shared, so you might see a few more Spotify calls than the table above. Use KV for a truly shared cache, but that's overkill unless isolate-splitting is measurably causing issues.
