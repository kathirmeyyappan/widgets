#!/usr/bin/env bash
# Diagnose MAL API freshness for the anime-activity widget.
#
# Hits the MAL API directly with the same parameters the worker uses, plus a
# few variants, and prints response headers (cache hints) and the top entries
# with their updated_at timestamps. Compare against what your MAL app shows
# to figure out where the staleness lives.
#
# Usage:
#   export MAL_CLIENT_ID=...     # required
#   export WORKER_URL=...        # optional, defaults to the deployed worker
#   ./diagnose-mal.sh
#
# Requires: curl, jq.

set -euo pipefail

USERNAME="Uji_Gintoki_Bowl"
CID="${MAL_CLIENT_ID:?set MAL_CLIENT_ID env var first}"
WORKER="${WORKER_URL:-https://anime-activity-widget.kathirmey.workers.dev}"
LIMIT=15

if ! command -v jq >/dev/null; then
  echo "jq not found — install it first (brew install jq / apt install jq)" >&2
  exit 1
fi

hr() { printf '\n========== %s ==========\n' "$*"; }
sub() { printf -- '---- %s ----\n' "$*"; }

# Caching headers we care about:
#   Cache-Control / Expires — what the origin says is cacheable
#   Age                     — seconds since the response was generated (CDN cache hit if > 0)
#   Date                    — when the response was sent
#   CF-Cache-Status         — Cloudflare's verdict (HIT/MISS/DYNAMIC/etc.)
#   X-Cache                 — generic CDN cache header
#   ETag / Last-Modified    — for conditional reuse
CACHE_HEADERS='^(cache-control|expires|age|date|cf-cache-status|x-cache|etag|last-modified|vary):'

probe_mal() {
  local kind=$1 query=$2 label=$3
  local fields
  if [[ $kind == animelist ]]; then
    fields="list_status{status,score,num_episodes_watched,updated_at},num_episodes,main_picture"
  else
    fields="list_status{status,score,num_chapters_read,updated_at},num_chapters,main_picture"
  fi
  local url="https://api.myanimelist.net/v2/users/${USERNAME}/${kind}?fields=${fields}&limit=${LIMIT}"
  [[ -n $query ]] && url+="&${query}"

  hr "$label"
  echo "URL: $url"

  local body; body=$(mktemp)
  local headers; headers=$(mktemp)
  curl -s -D "$headers" -o "$body" -H "X-MAL-CLIENT-ID: $CID" "$url"

  sub "response headers (cache-related only)"
  grep -iE "$CACHE_HEADERS" "$headers" || echo "(no cache-related headers present)"

  sub "top entries (updated_at  ·  status  ·  progress  ·  title)"
  local progress_field
  [[ $kind == animelist ]] \
    && progress_field='.list_status.num_episodes_watched' \
    || progress_field='.list_status.num_chapters_read'
  jq -r ".data[] | \"\(.list_status.updated_at)  ·  \(.list_status.status)  ·  ${progress_field} // \\\"?\\\"  ·  \(.node.title)\"" "$body" \
    | head -${LIMIT}

  rm -f "$body" "$headers"
}

probe_worker() {
  hr "worker (does Cloudflare add a stale layer?)"
  local url="${WORKER}?limit=${LIMIT}"
  echo "URL: $url"
  local body; body=$(mktemp)
  local headers; headers=$(mktemp)
  curl -s -D "$headers" -o "$body" "$url"

  sub "response headers (cache-related only)"
  grep -iE "$CACHE_HEADERS" "$headers" || echo "(no cache-related headers present)"

  sub "worker entries (date · type · title)"
  jq -r '.entries[] | "\(.date)  ·  \(.type)  ·  \(.title)"' "$body"

  rm -f "$body" "$headers"
}

# 1. What the worker currently asks for.
probe_mal mangalist "sort=list_updated_at" "manga · sort=list_updated_at"

# 2. Same endpoint with NO sort param — does the unsorted response include
#    the newest entry (suggesting the sort index lags the raw data)?
probe_mal mangalist "" "manga · no sort (server default)"

# 3. Cache-busting query param. MAL may key its cache on the full query
#    string; tossing in an unused param can force a fresh path.
probe_mal mangalist "sort=list_updated_at&_=$(date +%s)" "manga · sort=list_updated_at + cachebuster"

# 4. Anime variant — sanity check the symptom isn't manga-specific.
probe_mal animelist "sort=list_updated_at" "anime · sort=list_updated_at"

# 5. The worker itself — does Cloudflare's edge serve a stale copy?
probe_worker

hr "interpreting the output"
cat <<'EOF'
Look for the most-recent entry from your MAL app at the top of each list.

If it's MISSING from #1 (sort=list_updated_at) but PRESENT in #2 (no sort):
    → MAL's sorted view lags the raw data. Fix: drop sort param, sort client-side.

If it's MISSING from both #1 and #3 (with cachebuster):
    → MAL's API itself is stale, no client-side trick will help.
      Either wait, or pivot to scraping the profile page like Jikan did.

If it's MISSING from #5 (worker) but PRESENT in #1 (direct MAL):
    → Cloudflare's edge is caching the worker response. Fix: add
      cache: 'no-store' to the worker's MAL fetch, or set Cache-Control:
      no-store on the worker's response.

The 'Age' response header in any block tells you exactly how stale the
CDN copy is — a value >0 means it's a cache hit, not a fresh response.
EOF
