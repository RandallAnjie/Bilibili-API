// /api/hybrid/* and /download handlers (Bilibili).
import { HTTPException } from '../utils/http-exception.js'
import { jsonResponse } from '../utils/respond.js'
import { isAuthorised, getClientIp } from '../utils/auth.js'
import { hybridParseSingleVideo, resolvePlatformId } from '../hybrid/crawler.js'
import { rewriteMinimalToProxy } from '../utils/proxy-link.js'
import { rateLimitHit } from '../utils/db.js'
import { ingestWork } from '../utils/ingest.js'
import { maybeFetchComments } from '../utils/comments.js'

const PLATFORM = 'bilibili'
const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())

export async function hybridService (route, request, ctx) {
  if (request.method === 'GET' && route === 'video_data') {
    const url = new URL(request.url)
    const target = url.searchParams.get('url')
    if (!target) throw new HTTPException(400, { message: 'Missing query param: url' })

    const authed = isAuthorised(request, ctx, PLATFORM, 'video_data', target)
    let guest = false
    if (!authed) {
      const g = ctx.config.guest
      if (!g.enabled) throw new HTTPException(401, { message: 'Unauthorized: pass ?token=<secret>' })
      const rl = await rateLimitHit(ctx, getClientIp(request), g.limit, g.windowSec)
      if (rl.reason === 'no-store') {
        throw new HTTPException(503, { message: '游客模式需要 KV 或 D1 才能限流，请联系管理员绑定 / guest mode needs a KV or D1 binding' })
      }
      if (!rl.allowed) {
        return new Response(JSON.stringify({ code: 429, message: `游客每 ${Math.round(g.windowSec / 60)} 分钟限 ${g.limit} 次，请 ${rl.resetSec}s 后再试或填入访问密钥` }), {
          status: 429,
          headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(rl.resetSec || g.windowSec) }
        })
      }
      guest = true
    }

    const minimal = guest ? true : truthy(url.searchParams.get('minimal') ?? 'false')
    const proxy = guest ? true : truthy(url.searchParams.get('proxy') ?? 'false')
    const refresh = guest ? false : truthy(url.searchParams.get('refresh') ?? 'false')
    const linkTtl = guest ? ctx.config.guest.linkTtlSec : undefined

    const { platform, id } = await resolvePlatformId(target)
    const { raw, min } = await ingestWork(ctx, request, platform, id, target, refresh)

    // Async: refresh this work's comments into D1 (best-effort, 6h TTL).
    if (ctx.waitUntil) ctx.waitUntil(maybeFetchComments(ctx, platform, id))

    let data = minimal ? min : raw
    if (minimal && proxy) data = rewriteMinimalToProxy(data, request, ctx, linkTtl)
    return jsonResponse(data, { router: 'hybrid/video_data', params: { url: target, minimal, proxy, guest } })
  }

  if (request.method === 'POST' && route === 'update_cookie') {
    throw new HTTPException(501, { message: 'update_cookie is not supported — set the BILI_COOKIE env binding instead.' })
  }

  throw new HTTPException(404, { message: `Unknown hybrid route: ${route}` })
}

export async function downloadService (request, ctx) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) throw new HTTPException(400, { message: 'Missing query param: url' })
  requireAuthOrThrow(request, ctx, target)

  const data = await hybridParseSingleVideo(ctx, target, true)
  // Prefer the combined mp4 (playable); fall back to DASH video.
  const fileUrl = data.video_data.mp4_url || data.video_data.video_url
  if (!fileUrl) throw new HTTPException(404, { message: 'No downloadable URL found' })

  const upstream = await fetch(fileUrl, {
    headers: { 'User-Agent': ctx.config.bili.userAgent, Referer: 'https://www.bilibili.com/' }
  })
  if (!upstream.ok || !upstream.body) throw new HTTPException(502, { message: `Failed to fetch media (${upstream.status})` })

  const headers = new Headers()
  headers.set('content-type', upstream.headers.get('content-type') || 'video/mp4')
  const len = upstream.headers.get('content-length'); if (len) headers.set('content-length', len)
  headers.set('content-disposition', `attachment; filename="bilibili_${data.video_id}.mp4"`)
  return new Response(upstream.body, { status: 200, headers })
}

function requireAuthOrThrow (request, ctx, target) {
  if (!isAuthorised(request, ctx, 'bilibili', 'download', target)) {
    throw new HTTPException(401, { message: 'Unauthorized: pass ?token=<secret> or ?auth=' })
  }
}
