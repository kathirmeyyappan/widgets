const USERNAME = "Uji_Gintoki_Bowl";
const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture";
const ALLOWED_ORIGINS = new Set(["https://kathirm.com"]);
const DEFAULT_LIMIT = 10;

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

function normalize(item, kind) {
  const node = item.node;
  const ls = item.list_status;
  const isAnime = kind === "anime";
  return {
    type: kind,
    unit: isAnime ? "ep" : "ch",
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

// Fetch one medium's recently-updated list, filter plan-to-X, normalize.
// Each medium contributes up to `limit` candidates so the merged top-LIMIT
// is always correct even if all picks come from one side.
async function fetchMedium(clientId, kind, limit) {
  const fields = kind === "anime" ? ANIME_FIELDS : MANGA_FIELDS;
  const url = `https://api.myanimelist.net/v2/users/${USERNAME}/${kind}list?fields=${fields}&sort=list_updated_at&limit=${limit}&nsfw=true`;
  const res = await fetch(url, { headers: { "X-MAL-CLIENT-ID": clientId } });
  if (!res.ok) throw new Error(`MAL ${kind}list ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return (payload.data ?? [])
    .filter(item => !SKIP.has(item.list_status?.status))
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
      const [anime, manga] = await Promise.all([
        fetchMedium(env.MAL_CLIENT_ID, "anime", limit),
        fetchMedium(env.MAL_CLIENT_ID, "manga", limit),
      ]);
      // Merge, sort, and trim to get animanga log to pass to frontend
      const entries = [...anime, ...manga]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, limit);
      return json({ entries }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ entries: [], error: e.message }, origin, 500);
    }
  },
};
