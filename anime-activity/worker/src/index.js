const USERNAME = "Uji_Gintoki_Bowl";
const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture,nsfw";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture,nsfw";
const ALLOWED_ORIGINS = new Set(["https://kathirm.com", "https://widgets.kathirm.com"]);
const DEFAULT_DAYS = 7;
// Per-medium cap on the MAL fetch; comfortably above any plausible window's activity.
const FETCH_LIMIT = 100;

// MAL's per-user RSS feeds only move on episode/chapter bumps — never on score
// or status edits — so they can vouch for an entry being real progress. Fetched
// raw here and handed to the client untouched; the client owns how it's applied.
const RSS_TYPE = { anime: "rw", manga: "rm" };
// Short enough that a fresh bump is visible almost immediately, long enough to
// absorb a burst of reloads without hammering rss.php.
const RSS_CACHE_TTL = 60;

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
    id: String(node.id),
    type: kind,
    unit: isAnime ? "ep" : "ch",
    title: node.title,
    url: `https://myanimelist.net/${kind}/${node.id}`,
    image: node.main_picture?.medium ?? node.main_picture?.large ?? "",
    status: STATUS_LABEL[ls.status] ?? ls.status,
    score: ls.score,
    progress: isAnime ? ls.num_episodes_watched : ls.num_chapters_read,
    total: isAnime ? node.num_episodes : node.num_chapters,
    // "white" | "gray" | "black", or null if MAL omits it. Null means the
    // client can't tell, and it fails open (skips gating) rather than risk
    // silently dropping a title.
    nsfw: node.nsfw ?? null,
    date: ls.updated_at,
  };
}

// Fetch one medium's recently-updated list, filter plan-to-X, normalize.
async function fetchMedium(clientId, kind) {
  const fields = kind === "anime" ? ANIME_FIELDS : MANGA_FIELDS;
  const url = `https://api.myanimelist.net/v2/users/${USERNAME}/${kind}list?fields=${fields}&sort=list_updated_at&limit=${FETCH_LIMIT}&nsfw=true`;
  const res = await fetch(url, { headers: { "X-MAL-CLIENT-ID": clientId } });
  if (!res.ok) throw new Error(`MAL ${kind}list ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return (payload.data ?? [])
    .filter(item => !SKIP.has(item.list_status?.status))
    .map(item => normalize(item, kind));
}

// "{kind}:{id}" -> ISO timestamp of the progress event MAL last published.
// Throws if either feed is unavailable so the caller can mark the gate absent.
async function fetchGate() {
  const gate = {};
  await Promise.all(Object.entries(RSS_TYPE).map(async ([kind, type]) => {
    const res = await fetch(`https://myanimelist.net/rss.php?type=${type}&u=${USERNAME}`, {
      headers: { "User-Agent": "anime-activity-widget (+https://widgets.kathirm.com)" },
      cf: { cacheTtl: RSS_CACHE_TTL, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`MAL ${kind} rss ${res.status}`);
    for (const [, item] of (await res.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const id = item.match(/<link>[^<]*\/(?:anime|manga)\/(\d+)/)?.[1];
      const ms = Date.parse(item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "");
      if (id && ms) gate[`${kind}:${id}`] = new Date(ms).toISOString();
    }
  }));
  return gate;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const params = new URL(request.url).searchParams;
    const days = Math.max(1, Math.min(90, parseInt(params.get("days"), 10) || DEFAULT_DAYS));
    const cutoff = Date.now() - days * 86400000;

    try {
      const [anime, manga, gate] = await Promise.all([
        fetchMedium(env.MAL_CLIENT_ID, "anime"),
        fetchMedium(env.MAL_CLIENT_ID, "manga"),
        // A missing gate degrades the feed rather than breaking it, so it must
        // never fail the whole request.
        fetchGate().catch(e => {
          console.error(`[worker] gate unavailable: ${e.message}`);
          return null;
        }),
      ]);
      const entries = [...anime, ...manga]
        .filter(e => new Date(e.date).getTime() >= cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      return json({ entries, gate, gateOk: gate !== null }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ entries: [], gate: null, gateOk: false, error: e.message }, origin, 500);
    }
  },
};
