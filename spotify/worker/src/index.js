const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing";
const SPOTIFY_RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=1";
const ALLOWED_ORIGINS = new Set(["https://kathirm.com"]);

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1";
  } catch { return false; }
}

let cachedToken = null;
let tokenExpiresAt = 0;

const RECENT_TTL_MS = 60000;
let recentCache = null;
let recentCachedAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const creds = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${env.SPOTIFY_REFRESH_TOKEN}`,
  });
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin) ? origin : "https://kathirm.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function json(data, origin) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function spotifyJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const retryAfter = res.headers.get("Retry-After");
    console.error(`[${label}] status=${res.status} retry-after=${retryAfter} body=${text.slice(0, 200)}`);
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      const token = await getAccessToken(env);

      const npRes = await fetch(SPOTIFY_NOW_PLAYING_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (npRes.status === 204) {
        // Last-played barely changes while idle, so cache it and only
        // re-fetch once the TTL lapses. Keeps us well under Spotify's
        // rate limit instead of hitting recently-played every poll.
        if (!recentCache || Date.now() - recentCachedAt > RECENT_TTL_MS) {
          const rpRes = await fetch(SPOTIFY_RECENTLY_PLAYED_URL, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const rpData = await spotifyJson(rpRes, "recently-played");
          const track = rpData?.items?.[0]?.track;
          recentCache = track ? {
            isPlaying: false,
            title: track.name,
            artist: track.artists.map(a => a.name).join(", "),
            album: track.album.name,
            albumArt: track.album.images[0]?.url ?? null,
            songUrl: track.external_urls.spotify,
            progressMs: 0,
            durationMs: track.duration_ms,
          } : { isPlaying: false };
          recentCachedAt = Date.now();
        }
        return json(recentCache, origin);
      }

      const npData = await spotifyJson(npRes, "currently-playing");
      const track = npData?.item;
      if (!track) return json({ isPlaying: false }, origin);

      return json({
        isPlaying: npData.is_playing,
        title: track.name,
        artist: track.artists.map(a => a.name).join(", "),
        album: track.album.name,
        albumArt: track.album.images[0]?.url ?? null,
        songUrl: track.external_urls.spotify,
        progressMs: npData.progress_ms,
        durationMs: track.duration_ms,
        capturedAt: npData.timestamp,
      }, origin);
    } catch (e) {
      console.error(`[worker] uncaught: ${e.message}`);
      return json({ isPlaying: false, error: e.message }, origin);
    }
  },
};
