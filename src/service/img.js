// /img — cached reverse proxy for arbitrary external images (comment
// avatars and other off-work thumbnails that have no work id/kind).
//
//   GET /img?u=<encoded image url>&auth=<HMAC-SHA1(secret,"img"+url)>
//
// Cache key is sha1(url) so repeat loads hit R2. Only URLs we signed are
// accepted (HMAC) and only from a CDN allowlist, so this is not an open
// image proxy. Anti-leech: we send the matching platform Referer.
import { HTTPException } from '../utils/http-exception.js'
import { sign } from '../utils/auth.js'
import { sha1Hex } from '../lib/sha1.js'
import { serveFromR2, r2PutRetry } from '../utils/r2cache.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
// CDN hosts we'll proxy images from (substring match on the hostname).
const ALLOW = ['hdslb.com', 'douyinpic.com', 'pstatp.com', 'byteimg.com', 'ibyteimg.com', 'bytecdn', 'bytedance', 'douyincdn', 'bdxiguavod', 'tiktokcdn', 'ttwstatic']
const MIN_BYTES = 256

export async function imgService (request, ctx) {
  const url = new URL(request.url)
  const u = url.searchParams.get('u') || ''
  const auth = url.searchParams.get('auth') || ''
  const token = url.searchParams.get('token') || ''
  const secret = ctx.config.auth.token
  if (!u) throw new HTTPException(400, { message: 'Missing query param: u' })
  if (token !== secret && auth !== sign(`img${u}`, secret)) {
    throw new HTTPException(401, { message: 'img: bad auth' })
  }
  let host
  try { host = new URL(u).hostname } catch { throw new HTTPException(400, { message: 'bad url' }) }
  if (!ALLOW.some(h => host.includes(h))) throw new HTTPException(403, { message: `host not allowed: ${host}` })

  const bucket = ctx.config.mediaR2
  const key = `img/${sha1Hex(u)}`
  if (bucket) {
    const hit = await serveFromR2(bucket, request, key, undefined, MIN_BYTES)
    if (hit) return hit
  }

  const referer = host.includes('hdslb') ? 'https://www.bilibili.com/'
    : host.includes('tiktokcdn') || host.includes('ttwstatic') ? 'https://www.tiktok.com/'
    : 'https://www.douyin.com/'
  let upstream
  try { upstream = await fetch(u, { headers: { 'User-Agent': UA, Referer: referer } }) } catch (e) {
    throw new HTTPException(502, { message: `img fetch failed: ${e?.message || e}` })
  }
  const ct = (upstream.headers.get('content-type') || '').toLowerCase()
  if (!upstream.ok || !upstream.body || !ct.startsWith('image')) {
    try { await upstream.body?.cancel() } catch {}
    throw new HTTPException(502, { message: `img upstream not an image (${upstream.status})` })
  }
  const contentType = upstream.headers.get('content-type') || 'image/jpeg'
  const buf = await upstream.arrayBuffer()
  if (buf.byteLength >= MIN_BYTES && bucket && ctx?.waitUntil) {
    ctx.waitUntil(r2PutRetry(bucket, key, () => new Response(buf).body, { httpMetadata: { contentType } }, 2))
  }
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(buf.byteLength),
      'cache-control': 'public, max-age=86400',
      'x-cache-source': 'upstream-buffer'
    }
  })
}
