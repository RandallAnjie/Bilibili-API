// Temporary R2 binding probe — token-gated. Remove after diagnosing.
import { HTTPException } from '../utils/http-exception.js'
import { rawJsonResponse } from '../utils/respond.js'

export async function cacheDebugService (request, ctx) {
  const url = new URL(request.url)
  if ((url.searchParams.get('token') || '') !== ctx.config.auth.token) {
    throw new HTTPException(401, { message: 'token required' })
  }
  const b = ctx.config.mediaR2
  const r = { bound: !!b, type: typeof b, isString: typeof b === 'string', hasHead: typeof b?.head, hasPut: typeof b?.put, hasGet: typeof b?.get }
  if (b && typeof b.put === 'function') {
    const key = 'media/_probe.bin'
    try { await b.put(key, new Response('hello-bili').body, { httpMetadata: { contentType: 'text/plain' } }); r.put = 'ok' } catch (e) { r.put = String(e?.message || e) }
    try { const h = await b.head(key); r.headFound = !!h; r.headSize = h?.size } catch (e) { r.headErr = String(e?.message || e) }
  }
  return rawJsonResponse(r)
}
