// GET /api/comments?platform=&id=&page= — public, reads cached comments
// from D1. If none yet, lazily populates (rate-limited per IP to avoid
// abuse) then returns.
import { HTTPException } from '../utils/http-exception.js'
import { rawJsonResponse } from '../utils/respond.js'
import { getComments, rateLimitHit } from '../utils/db.js'
import { maybeFetchComments } from '../utils/comments.js'
import { getClientIp } from '../utils/auth.js'
import { imgProxyLink } from '../utils/proxy-link.js'

export async function commentsApiService (request, ctx) {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') || ''
  const id = url.searchParams.get('id') || ''
  if (!platform || !id) throw new HTTPException(400, { message: 'platform and id required' })
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20))

  let { rows, total } = await getComments(ctx, platform, id, limit, (page - 1) * limit)
  if (!total && page === 1) {
    const g = ctx.config.guest
    const rl = await rateLimitHit(ctx, getClientIp(request), g.limit, g.windowSec)
    if (rl.allowed) {
      await maybeFetchComments(ctx, platform, id)
      ;({ rows, total } = await getComments(ctx, platform, id, limit, 0))
    }
  }
  // Route avatars (parents + nested replies) through the cached /img proxy.
  const rw = (r) => ({ ...r, avatar: r.avatar ? imgProxyLink(request, ctx, r.avatar) : null, replies: (r.replies || []).map(rw) })
  const data = rows.map(rw)
  return rawJsonResponse({ code: 200, platform, id, page, limit, total, count: data.length, data })
}
