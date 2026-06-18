// /proxy — id-based media reverse proxy with R2 byte cache (Bilibili).
//
//   GET /proxy?platform=bilibili&id=<BVid>&kind=mp4|video|audio|cover
//
// Cache key is platform/id/kind (stable), so Bilibili's signed CDN URL
// can rotate without breaking hits. On miss we re-resolve candidate URLs
// from the (cached) metadata, probe them, and stream/cache the first that
// serves media. Bilibili CDN requires a bilibili.com Referer (anti-leech).
import { HTTPException } from '../utils/http-exception.js'
import { requireProxyAuth } from '../utils/auth.js'
import { fetchRawById, mediaCandidates } from '../hybrid/crawler.js'
import { serveFromR2, teeIntoCache, r2PutRetry, r2PutMultipart, mediaKey } from '../utils/r2cache.js'

const BUFFER_CAP = 20 * 1024 * 1024
const MIN_CACHE_BYTES = 1024
const minSizeForKind = (kind) => (kind === 'cover' || kind === 'avatar' ? 256 : 10000)

const KIND_CT = { mp4: 'video/mp4', video: 'video/mp4', audio: 'audio/mp4', cover: 'image/jpeg', avatar: 'image/jpeg' }
const KIND_EXT = { mp4: 'mp4', video: 'm4s', audio: 'm4s', cover: 'jpeg', avatar: 'jpeg' }

export async function proxyService (request, ctx) {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') || 'bilibili'
  const id = url.searchParams.get('id') || ''
  const kind = url.searchParams.get('kind') || 'mp4'
  if (platform !== 'bilibili') throw new HTTPException(400, { message: 'platform must be bilibili' })
  if (!id) throw new HTTPException(400, { message: 'Missing query param: id' })
  if (!KIND_CT[kind]) throw new HTTPException(400, { message: `Unknown kind: ${kind}` })
  requireProxyAuth(request, ctx, platform, id)

  const refresh = ['1', 'true', 'yes'].includes(String(url.searchParams.get('refresh')).toLowerCase())
  const download = ['1', 'true', 'yes'].includes(String(url.searchParams.get('download')).toLowerCase())
  const bucket = ctx.config.mediaR2
  const key = mediaKey(platform, id, kind)
  const contentType = KIND_CT[kind]
  const ext = KIND_EXT[kind]

  if (bucket && !refresh) {
    const hit = await serveFromR2(bucket, request, key, undefined, minSizeForKind(kind))
    if (hit) return withDisposition(hit, download, platform, id, kind, ext)
  }

  const reqHeaders = { 'User-Agent': ctx.config.bili.userAgent, Referer: 'https://www.bilibili.com/' }
  const rangeHeader = request.headers.get('range')

  const probe = async (cands) => {
    for (const u of cands) {
      let r
      try { r = await fetch(u, { headers: rangeHeader ? { ...reqHeaders, range: rangeHeader } : reqHeaders }) } catch { continue }
      if (looksLikeMedia(r, kind, !!rangeHeader)) return { upstream: r, usedUrl: u }
      try { await r.body?.cancel() } catch {}
    }
    return { upstream: null, usedUrl: null }
  }

  let { raw } = await fetchRawById(ctx, platform, id, refresh)
  let candidates = mediaCandidates(platform, raw, kind)
  if (!candidates.length && refresh) throw new HTTPException(404, { message: `No media url for kind=${kind}` })
  let { upstream, usedUrl } = candidates.length ? await probe(candidates) : { upstream: null, usedUrl: null }

  // Bilibili's signed CDN urls (esp. bilivideo durl/dash) expire. If every
  // cached candidate failed and we hadn't already forced a refresh,
  // re-resolve fresh links once and retry before giving up.
  if (!upstream && !refresh) {
    ;({ raw } = await fetchRawById(ctx, platform, id, true))
    candidates = mediaCandidates(platform, raw, kind)
    if (!candidates.length) throw new HTTPException(404, { message: `No media url for kind=${kind}` })
    ;({ upstream, usedUrl } = await probe(candidates))
  }
  if (!upstream) throw new HTTPException(502, { message: `All ${candidates.length} candidate url(s) failed for kind=${kind}` })

  if (rangeHeader) {
    if (bucket && ctx?.waitUntil && rangeStartOf(rangeHeader) === 0) {
      ctx.waitUntil((async () => {
        try {
          const f = await fetch(usedUrl, { headers: reqHeaders })
          if (!f.ok || !f.body) return
          // Videos are large → multipart (single PUT exceeds the body cap).
          await r2PutMultipart(bucket, key, f.body, { httpMetadata: { contentType } })
        } catch (e) { try { console.error('[r2] warm failed', key, e?.message || e) } catch {} }
      })())
    }
    return withDisposition(wrapMedia(upstream, contentType, 'upstream-range'), download, platform, id, kind, ext)
  }

  if (!bucket) {
    return withDisposition(wrapMedia(upstream, contentType, 'upstream-plain'), download, platform, id, kind, ext)
  }

  const cl = Number(upstream.headers.get('content-length') || 0)
  if (cl > BUFFER_CAP) {
    return withDisposition(teeIntoCache(bucket, ctx, key, upstream, contentType), download, platform, id, kind, ext)
  }

  const buf = await upstream.arrayBuffer()
  const size = buf.byteLength
  if (size >= MIN_CACHE_BYTES && ctx?.waitUntil) {
    ctx.waitUntil(r2PutRetry(bucket, key, () => new Response(buf).body, { httpMetadata: { contentType } }, 2))
  }
  const out = new Headers({
    'content-type': contentType,
    'content-length': String(size),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=300',
    'x-cache-source': 'upstream-buffer'
  })
  return withDisposition(new Response(buf, { status: 200, headers: out }), download, platform, id, kind, ext)
}

function looksLikeMedia (resp, kind, isRange) {
  if (!resp.ok || !resp.body) return false
  const ct = (resp.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/xml') || ct.includes('text/plain')) return false
  if (!isRange) {
    const len = Number(resp.headers.get('content-length') || 0)
    if (len && len < minSizeForKind(kind)) return false
  }
  return true
}

function rangeStartOf (header) {
  const m = String(header || '').match(/bytes=(\d+)-/)
  return m ? Number(m[1]) : 0
}

function wrapMedia (upstream, contentType, source) {
  const out = new Headers()
  out.set('content-type', upstream.headers.get('content-type') || contentType || 'application/octet-stream')
  const cl = upstream.headers.get('content-length'); if (cl) out.set('content-length', cl)
  const cr = upstream.headers.get('content-range'); if (cr) out.set('content-range', cr)
  out.set('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes')
  out.set('cache-control', 'public, max-age=300')
  out.set('x-cache-source', source)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

function withDisposition (resp, download, platform, id, kind, ext) {
  if (!download) return resp
  const headers = new Headers(resp.headers)
  headers.set('content-disposition', `attachment; filename="bilibili_${id}_${kind}.${ext}"`)
  return new Response(resp.body, { status: resp.status, headers })
}
