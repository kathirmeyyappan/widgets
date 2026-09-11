const USERNAME = "Uji_Gintoki_Bowl";
const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture,nsfw";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture,nsfw";
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
    // "white" | "gray" | "black", or null when MAL omits the field.
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

// "{kind}:{id}" -> ISO timestamp of the most recent progress event MAL
// published. Null if the feeds can't be read, which disables the gate rather
// than blanking the widget.
//
// Deliberately uncached: the widget fetches once per page load and never polls,
// so a TTL would almost never produce a hit and would only ever delay a new
// title's first appearance.
async function fetchProgressGate() {
  const gate = new Map();
  try {
    await Promise.all(Object.entries(RSS_TYPE).map(async ([kind, type]) => {
      const res = await fetch(`https://myanimelist.net/rss.php?type=${type}&u=${USERNAME}`, {
        headers: { "User-Agent": "anime-activity-widget (+https://widgets.kathirm.com)" },
      });
      if (!res.ok) throw new Error(`MAL ${kind} rss ${res.status}`);
      for (const [, item] of (await res.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const id = item.match(/<link>[^<]*\/(?:anime|manga)\/(\d+)/)?.[1];
        const ms = Date.parse(item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "");
        if (!id || !ms) continue;
        // A title gets one item per episode watched, so keep the newest.
        const key = `${kind}:${id}`;
        const prev = gate.get(key);
        if (!prev || ms > Date.parse(prev)) gate.set(key, new Date(ms).toISOString());
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

      // The feeds are consulted for membership only — nothing here re-dates an
      // entry. Every rendered value, timestamp included, stays the API's own,
      // so a feed lagging behind can't make a fresh bump display as old.
      const entries = [...anime, ...manga]
        .filter(e => {
          if (new Date(e.date).getTime() < cutoff) return false;
          if (!gate) return true;
          // R+/Rx titles are stripped from the feeds, so their absence proves
          // nothing. Null rating means MAL didn't say, so fail open too —
          // showing a stale entry beats silently dropping a real one.
          if (e.nsfw !== "white") return true;
          const progressedAt = gate.get(`${e.type}:${e.id}`);
          return Boolean(progressedAt) && new Date(progressedAt).getTime() >= cutoff;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      return json({ entries, gateOk: gate !== null }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ entries: [], gateOk: false, error: e.message }, origin, 500);
    }
  },
};
