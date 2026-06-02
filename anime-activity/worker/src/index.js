const USERNAME = "Uji_Gintoki_Bowl";
const ANIME_RSS = `https://myanimelist.net/rss.php?type=rw&u=${USERNAME}`;
const MANGA_RSS = `https://myanimelist.net/rss.php?type=rm&u=${USERNAME}`;
const ALLOWED_ORIGINS = new Set(["https://kathirm.com"]);
const DEFAULT_LIMIT = 10;
const SKIP = new Set(["Plan to Watch", "Plan to Read"]);
const UA = "anime-activity-widget/1.0 (+https://kathirm.com)";

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

// ---------- RSS parsing ----------

// Pulls "<tag>...</tag>" out of an XML fragment, stripping CDATA wrappers.
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function extractMalId(link) {
  const m = link.match(/myanimelist\.net\/(?:anime|manga)\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// MAL RSS descriptions look like:
//   "Watching - 7 of 13 episodes"
//   "Reading - 36 of ? chapters"
//   "Completed - 24 of 24 episodes"
function parseDescription(desc) {
  const m = desc.match(/^(.+?)\s*-\s*(\d+)\s+of\s+(\?|\d+)/);
  if (!m) return { status: "", progress: null, total: null };
  return {
    status: m[1].trim(),
    progress: parseInt(m[2], 10),
    total: m[3] === "?" ? null : parseInt(m[3], 10),
  };
}

async function fetchRss(url, kind) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RSS ${kind} ${res.status}`);
  const xml = await res.text();
  const entries = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const link = extractTag(body, "link");
    const { status, progress, total } = parseDescription(extractTag(body, "description"));
    entries.push({
      type: kind,
      unit: kind === "anime" ? "ep" : "ch",
      title: extractTag(body, "title"),
      url: link,
      image: "",          // filled by enrichment
      status,
      score: null,        // not in RSS
      progress,
      total,
      date: new Date(extractTag(body, "pubDate")).toISOString(),
      _malId: extractMalId(link),
    });
  }
  return entries;
}

// ---------- Image enrichment (MAL public catalog, X-MAL-Client-ID only) ----------

async function fetchImage(clientId, type, malId) {
  if (!malId) return "";
  const url = `https://api.myanimelist.net/v2/${type}/${malId}?fields=main_picture`;
  const res = await fetch(url, { headers: { "X-MAL-CLIENT-ID": clientId } });
  if (!res.ok) return "";
  const data = await res.json();
  return data.main_picture?.medium ?? data.main_picture?.large ?? "";
}

// ---------- Main ----------

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
        fetchRss(ANIME_RSS, "anime"),
        fetchRss(MANGA_RSS, "manga"),
      ]);

      const entries = [...anime, ...manga]
        .filter(e => !SKIP.has(e.status))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, limit);

      // Enrich just the entries we're returning, in parallel.
      await Promise.all(entries.map(async e => {
        e.image = await fetchImage(env.MAL_CLIENT_ID, e.type, e._malId);
        delete e._malId;
      }));

      return json({ entries }, origin);
    } catch (e) {
      console.error(`[worker] ${e.message}`);
      return json({ entries: [], error: e.message }, origin, 500);
    }
  },
};
