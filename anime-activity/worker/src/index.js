const USERNAME = "Uji_Gintoki_Bowl";
const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture";
const ALLOWED_ORIGINS = new Set(["https://kathirm.com", "https://widgets.kathirm.com"]);
const DEFAULT_DAYS = 7;
// Per-medium cap on the MAL fetch; comfortably above any plausible window's activity.
const FETCH_LIMIT = 100;

const RSS_TYPE = { anime: "rw", manga: "rm" };

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

// MAL stamps list_status.updated_at on *any* list edit, so rescoring an old
// show is indistinguishable from watching it today. The RSS feeds only move on
// episode/chapter bumps: "kind:id" -> when progress actually happened. Null if
// MAL won't serve them, in which case we skip the gate rather than blank the
// widget. Gate only — it never adds, so nsfw=true above stays the one knob
// deciding whether R+/Rx titles show up.
async function fetchProgressGate() {
  const gate = new Map();
  try {
    await Promise.all(Object.entries(RSS_TYPE).map(async ([kind, type]) => {
      const res = await fetch(`https://myanimelist.net/rss.php?type=${type}&u=${USERNAME}`, {
        headers: { "User-Agent": "anime-activity-widget (+https://widgets.kathirm.com)" },
        cf: { cacheTtl: 900, cacheEverything: true }, // MAL rate-limits rss.php
      });
      if (!res.ok) throw new Error(`MAL ${kind} rss ${res.status}`);
      for (const [, item] of (await res.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const id = item.match(/<link>[^<]*\/(?:anime|manga)\/(\d+)/)?.[1];
        const ms = Date.parse(item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "");
        if (id && ms) gate.set(`${kind}:${id}`, new Date(ms).toISOString());
      }
    }));
    return gate;
  } catch (e) {
    console.error(`[worker] no progress gate: ${e.message}`);
    return null;
  }
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
        fetchProgressGate(),
      ]);
      const entries = [...anime, ...manga]
        // Re-date to the real progress bump; anything without one drops out.
        .map(e => gate ? { ...e, date: gate.get(`${e.type}:${e.id}`) } : e)
        .filter(e => e.date && new Date(e.date).getTime() >= cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      return json({ entries }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ entries: [], error: e.message }, origin, 500);
    }
  },
};
