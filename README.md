# Bilibili API (RandallFlare worker)

Bilibili parsing API as a single [RandallFlare](../randallflare.md) /
Cloudflare `workerd` worker. Sibling of `/root/Douyin-API` — same shape:
paste-to-parse web UI, JSON API, R2 reverse-proxy cache, meting-style
auth, guest mode, D1 admin log.

- **wbi signing** (`w_rid = md5(sorted params + mixin key)`) ported to
  pure JS — verified against the upstream Python (`test/parity.mjs`).
- **Cookie in env** (`BILI_COOKIE`) — recommended (higher playurl
  quality); without it, public videos still parse.
- **DASH** (separate video + audio) plus a combined **mp4** (durl) for
  one-click inline play / download.
- Pure-JS crypto (md5 / sha1+hmac) → **no `node:crypto`, no
  nodejs_compat flag**.

## Build

```bash
npm install
npm run build   # -> dist/worker.js (deploy to RandallFlare)
npm test        # wbi / md5 / sha1 / bv2av parity vs Python
```

## Env bindings

| var | meaning | default |
|---|---|---|
| `BILI_API_TOKEN` | HMAC secret / master token | `token` |
| `BILI_COOKIE` | Bilibili cookie | *(empty — public videos still work)* |
| `BILI_R2` | R2 bucket for media + metadata cache | *(unbound → uncached)* |
| `BILI_D1` | D1 database for the query log / `/admin` | *(unbound → admin empty)* |
| `BILI_KV` | KV for guest rate limiting (preferred over D1) | *(falls back to D1)* |
| `META_CACHE_TTL` | metadata JSON freshness, seconds | `3600` |
| `GUEST_ENABLED` / `GUEST_RATE_LIMIT` / `GUEST_RATE_WINDOW` / `GUEST_LINK_TTL` | guest mode | on / 20 / 3600 / 7200 |
| `HTTP_PREFIX` | mount sub-path | *(empty)* |

## Pages & endpoints

- `/` — **解析台** paste-to-parse UI (inline mp4 play + video/audio/cover
  downloads). `/admin` recent-query log. `/docs` full route index.
- `GET /api/bilibili/web/{fetch_one_video,fetch_video_playurl,fetch_video_parts,fetch_user_profile,fetch_user_post_videos,fetch_com_popular,fetch_video_comments,fetch_comment_reply,fetch_live_room_detail}` 🔒 · `bv_to_aid` (open)
- `GET /api/hybrid/video_data?url=&minimal=&proxy=&refresh=` — parse (guests allowed)
- `GET /proxy?platform=bilibili&id=&kind=mp4|video|audio|cover&download=` 🔒 — id-based reverse proxy + R2 cache (bilibili Referer, Range)
- `GET /download?url=` 🔒 — combined mp4 download

## Auth & guest mode

🔒 endpoints need `?token=<BILI_API_TOKEN>` or
`?auth=HMAC-SHA1(secret,"{platform}{route}{primaryId}")`. The parser path
also allows **guests** (no token): minimal data + temporary proxied links
only (never raw JSON / `/admin`), IP rate-limited via `BILI_KV`/`BILI_D1`.

## Notes

- Bilibili video is DASH (separate streams). The page plays the combined
  mp4 (durl, up to ~1080p with a login cookie); "高清视频(无音)" + "音频"
  are the higher-res DASH streams (merge with ffmpeg for full quality).
- The wbi mixin key is hard-coded (matches the upstream). If Bilibili
  rotates it and signatures start failing, refresh it in
  `src/bilibili/wbi.js`.
