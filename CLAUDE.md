# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Bilibili parsing API as one RandallFlare / Cloudflare `workerd` worker.
Sibling of `/root/Douyin-API` (shares the same infra: worker entry, auth,
r2cache, db, guest mode, admin, pure-JS crypto). Bilibili-specific:
**wbi signing** + DASH (separate video/audio) + combined mp4 (durl).

## Commands

```bash
npm run build   # esbuild -> dist/worker.js (commit this)
npm test        # wbi / md5 / sha1 / bv2av parity vs Python
npm run lint    # oxlint
```

Always `npm run build` after editing `src/` — `dist/worker.js` is the
deployed artifact and is committed.

## Architecture

```
src/worker.js        entry: CORS, buildConfig, router
src/router.js        / (解析台) · /docs · /admin · /api/admin/recent ·
                     /api/bilibili/web/* · /api/hybrid/* · /proxy · /download
src/config.js        env -> config (BILI_API_TOKEN/COOKIE/R2/D1/KV, guest)
src/lib/             md5.js, sha1.js (pure-JS; wbi=md5, auth=hmac-sha1) — no node:crypto
src/bilibili/wbi.js  wbiSign/wbiQuery (w_rid=md5(sorted+mixin)) + bv2av (BigInt)
src/bilibili/{endpoints,crawler}.js
src/hybrid/crawler.js  detect/resolve BV, fetchRawById, toMinimal, mediaCandidates
src/utils/           auth, params (urlencode/quotePlus), base-crawler, ids (BV + b23 resolve),
                     r2cache, db (log + rate limit), meta-cache (fetchBiliCached),
                     proxy-link, respond, http-exception
src/service/         bilibili.js / hybrid.js / proxy.js / app.js (解析台) / admin.js / docs.js
```

## wbi — the load-bearing part

`w_rid = md5( urlencode( sorted, char-filtered params, with the mixin key
appended to the wts value ) )`. The mixin key is **hard-coded**
(`ea1db124af3c7062474693fa704f4ff8`) — the upstream doesn't fetch
nav/img_key. `test/parity.mjs` pins the w_rid for a fixed param set + wts
against the Python reference. Run `npm test` after touching
`src/bilibili/wbi.js` or `src/lib/md5.js`. If Bilibili rotates the mixin
key and playurl starts returning -401/-352, refresh the constant (or
derive it from the nav API's `wbi_img` keys).

## Media model

Bilibili video = DASH: `dash.video[]` (no audio) + `dash.audio[]`,
plus a combined `durl` mp4 (lower-res, playable). `fetchBiliCached`
fetches view + 2 playurls (fnval 4048 dash, fnval 1 mp4) and normalizes.
Proxy kinds: `mp4` (combined, playable), `video` (DASH hi-res, no audio),
`audio`, `cover`. Bilibili CDN needs a `bilibili.com` Referer (anti-leech)
— the proxy sets it; never expose raw bilivideo URLs to the browser
(they 403 without Referer), always go through `/proxy`.

## Auth / guest / cache

Same as Douyin-API: meting-style HMAC (`requireAuth`); guest mode on the
parser path (minimal + temporary proxy links, IP rate-limited via
KV/D1); R2 reverse-proxy cache keyed by `platform/id/kind`; metadata JSON
at `meta/bilibili/{bvid}.json`. See `/root/Douyin-API/CLAUDE.md` for the
shared-infra details and the RandallFlare R2/D1 gotchas (stream-body
puts, `.all()` not `.first()`, plane body-size cap for large blobs).

## Aggregation platform (D1-backed, public reads)

Same shape as Douyin-API (see its CLAUDE.md). Public: `/discover`,
`/work`, `/search`, `/author`, `/api/comments`. Bilibili specifics:

- Tags come from `x/tag/archive/tags` (the view's `tname` is empty now);
  follower trend from `x/relation/stat?vmid=`; 分P from the full
  `pages_list` (cid+part) stored in `meta-cache.js`. All best-effort,
  fetched concurrently in `ingest.js` so the parse stays fast.
- Comments: oid is the **view's authoritative `aid`** (from the cached
  record) — `bv2av` does NOT round-trip the new large-aid format, so never
  use it for comment oids.
- **Dynamics / opus (图文)**: `t.bilibili.com/<id>` · `bilibili.com/opus/<id>`
  · `m.bilibili.com/dynamic/<id>` parse as **type=image** works, carried as
  `id="opus:<dynId>"` through the same parse/proxy/cache/discover pipeline.
  `resolveBiliTarget` (ids.js) picks video-vs-opus; `fetchBiliDynamicCached`
  (meta-cache) normalizes `module_dynamic.major.{opus|draw|archive}` →
  `{_kind:'opus', text, images[], owner, stat}`. opus images use the
  `imageN` proxy kind. Deleted/hidden dynamics → clean 404 (code≠0).

### Cron (`POST /__edge_cron`)

Edge agent POSTs with `X-Edge-Cron-Expression`, no token (memory
`project_bigrandall_cron_convention`). Throttled 50s/expr. Each run:
refresh the 8 oldest works (new `stats_history` snapshots + follower
points + comments) AND grow the library by ingesting up to 4 fresh videos
from the popular feed (`x/web-interface/popular`) AND refresh the public
排行榜 (`refreshHotBoards` — all `/hot` categories into D1).

Admins can trigger a run by hand for testing: `GET /api/admin/cron?token=`
(master token) runs synchronously, bypasses the throttle, and returns the
result. `?only=hot` refreshes just the 排行榜, `?only=grow` just growth.

### 排行榜 (`/hot` + `/api/bilibili/hot?rid=`)

Per-region ranking (`x/web-interface/ranking/v2`, no wbi), ~100 real
videos/category. **Upstream fetch is cron-only** (`refreshHotBoards`
stores each category in `kv_meta`); the public API reads D1 only and
returns `{pending:true}` on a cold miss (master `?token=` may warm it
live). Clicking a card runs the normal guest parse (stores to D1 + warms
R2) and plays the combined mp4 in a lightbox. Covers via the `/img` proxy.

## Conventions

- Cookie/secret only from env; code/comments English; ASCII-safe strings
  inside template literals (no nested quote chars).
