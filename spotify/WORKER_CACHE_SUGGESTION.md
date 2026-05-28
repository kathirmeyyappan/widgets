# Worker Response Caching

If the site ever gets enough concurrent visitors that Spotify starts rate-limiting the worker, add a module-level response cache to `worker/src/index.js`.

## The idea

Every visitor polls the worker every 7s, but they all want the same data. Instead of calling Spotify's API on every request, cache the last result in the worker and serve it to everyone within the TTL window.

```js
let responseCache = { data: null, expiresAt: 0 };

// top of fetch handler, before calling Spotify:
if (Date.now() < responseCache.expiresAt) {
  return json(responseCache.data, origin);
}

// ...fetch from Spotify as normal, build the response object...

responseCache = { data: responseObject, expiresAt: Date.now() + 7000 };
return json(responseObject, origin);
```

## Trade-off

Cache TTL matches the poll interval (7s), so worst-case status change lag goes from **7s → 14s** (cache refreshes right as you pause → stale hit → 7s later cache expires → Spotify called).

## When to bother

Not worth it for a personal portfolio with a handful of concurrent visitors — Spotify's rate limits are generous and the extra latency is noticeable. Add this if Spotify starts returning 429s.

Cloudflare may spin up multiple Worker isolates under high load, so module-level state isn't globally shared. For truly shared caching across isolates, use KV instead — but that's overkill unless the isolate-splitting is actually causing duplicate Spotify calls at scale.
