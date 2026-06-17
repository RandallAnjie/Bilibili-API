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

## Conventions

- Cookie/secret only from env; code/comments English; ASCII-safe strings
  inside template literals (no nested quote chars).
