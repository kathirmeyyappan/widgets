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

async function getAccessToken(env) {
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
  return data.access_token;
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const token = await getAccessToken(env);

    const npRes = await fetch(SPOTIFY_NOW_PLAYING_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (npRes.status === 204) {
      const rpRes = await fetch(SPOTIFY_RECENTLY_PLAYED_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rpData = await rpRes.json();
      const track = rpData.items?.[0]?.track;
      if (!track) return json({ isPlaying: false }, origin);
      return json({
        isPlaying: false,
        title: track.name,
        artist: track.artists.map(a => a.name).join(", "),
        album: track.album.name,
        albumArt: track.album.images[0]?.url ?? null,
        songUrl: track.external_urls.spotify,
        progressMs: 0,
        durationMs: track.duration_ms,
      }, origin);
    }

    const npData = await npRes.json();
    const track = npData.item;
    if (!track) return json({ isPlaying: false }, origin);

    return json({
      isPlaying: true,
      title: track.name,
      artist: track.artists.map(a => a.name).join(", "),
      album: track.album.name,
      albumArt: track.album.images[0]?.url ?? null,
      songUrl: track.external_urls.spotify,
      progressMs: npData.progress_ms,
      durationMs: track.duration_ms,
    }, origin);
  },
};
