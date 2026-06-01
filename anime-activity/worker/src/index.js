const TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture";
const ALLOWED_ORIGINS = new Set(["https://kathirm.com"]);
const DEFAULT_LIMIT = 3;
// Fetch a few extra so plan-to-watch/read filtering still leaves us with LIMIT.
const FETCH_BUFFER = 5;

const STATUS_LABEL = {
  watching: "Watching",
  completed: "Completed",
  on_hold: "On-Hold",
  dropped: "Dropped",
  plan_to_watch: "Plan to Watch",
  reading: "Reading",
  plan_to_read: "Plan to Read",
};
const SKIP = new Set(["plan_to_watch", "plan_to_read"]);

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { return new URL(origin).hostname === "127.0.0.1"; } catch { return false; }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://kathirm.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// MAL access tokens expire in ~30 days. Cache in memory and refresh ~1h
// before expiry to avoid hitting the token endpoint every request.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const body = new URLSearchParams({
    client_id: env.MAL_CLIENT_ID,
    client_secret: env.MAL_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: env.MAL_REFRESH_TOKEN,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 3600) * 1000;
  return cachedToken;
}

async function fetchList(token, kind, fetchLimit) {
  const fields = kind === "anime" ? ANIME_FIELDS : MANGA_FIELDS;
  const url = `https://api.myanimelist.net/v2/users/@me/${kind}list?fields=${fields}&sort=list_updated_at&limit=${fetchLimit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`MAL ${kind}list ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalize(item, kind) {
  const node = item.node;
  const ls = item.list_status;
  const isAnime = kind === "anime";
  return {
    title: node.title,
    url: `https://myanimelist.net/${kind}/${node.id}`,
    image: node.main_picture?.medium ?? node.main_picture?.large ?? "",
    status: STATUS_LABEL[ls.status] ?? ls.status,
    score: ls.score,
    progress: isAnime ? ls.num_episodes_watched : ls.num_chapters_read,
    total: isAnime ? node.num_episodes : node.num_chapters,
    date: ls.updated_at,
  };
}

function shape(payload, kind, limit) {
  return (payload.data ?? [])
    .filter(item => !SKIP.has(item.list_status?.status))
    .slice(0, limit)
    .map(item => normalize(item, kind));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const params = new URL(request.url).searchParams;
    const limit = Math.max(1, Math.min(20, parseInt(params.get("limit"), 10) || DEFAULT_LIMIT));

    try {
      const token = await getAccessToken(env);
      const [animeRes, mangaRes] = await Promise.all([
        fetchList(token, "anime", limit + FETCH_BUFFER),
        fetchList(token, "manga", limit + FETCH_BUFFER),
      ]);
      return json({
        anime: shape(animeRes, "anime", limit),
        manga: shape(mangaRes, "manga", limit),
      }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ anime: [], manga: [], error: e.message }, origin, 500);
    }
  },
};
