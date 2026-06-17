// Temporary R2 binding probe — token-gated. Remove after diagnosing.
import { HTTPException } from '../utils/http-exception.js'
import { rawJsonResponse } from '../utils/respond.js'

export async function cacheDebugService (request, ctx) {
  const url = new URL(request.url)
  if ((url.searchParams.get('token') || '') !== ctx.config.auth.token) {
    throw new HTTPException(401, { message: 'token required' })
  }
  const b = ctx.config.mediaR2
  const r = { bound: !!b, hasPut: typeof b?.put }
  if (b && typeof b.put === 'function') {
    const key = 'media/_probe.bin'
    try { await b.put(key, new Response('hello-bili-' + Date.now()).body, { httpMetadata: { contentType: 'text/plain' } }); r.put = 'ok' } catch (e) { r.put = String(e?.message || e) }
    try { const h = await b.head(key); r.headFound = !!h; r.headSize = h?.size } catch (e) { r.headErr = String(e?.message || e) }
    try { const o = await b.get(key); r.getFound = !!o; if (o) r.getText = await new Response(o.body).text() } catch (e) { r.getErr = String(e?.message || e) }
    try { if (typeof b.list === 'function') { const l = await b.list({ prefix: 'media/', limit: 3 }); r.listKeys = (l?.objects || []).map(o => o.key) } } catch (e) { r.listErr = String(e?.message || e) }
  }
  return rawJsonResponse(r)
}
