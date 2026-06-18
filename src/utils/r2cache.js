// R2 cache layer — media bytes + metadata JSON. Mirrors the pattern in
// Meting-API/src/utils/cache.js (serveFromR2 / teeIntoCache /
// cachePopulateAside) and adds JSON get/put helpers for metadata.
//
// Media bytes are keyed by a STABLE id (platform/id/kind), not the
// signed CDN URL, so the cache keeps hitting after the upstream URL's
// token rotates. Metadata JSON freshness is judged from R2's own
// `uploaded` timestamp against a TTL.

export const mediaKey = (platform, id, kind) =>
  `media/${platform}/${encodeURIComponent(String(id))}/${kind}`

export const metaKey = (platform, id) =>
  `meta/${platform}/${encodeURIComponent(String(id))}.json`

function parseRangeHeader (header, totalSize) {
  if (!header) return null
  const m = String(header).trim().match(/^bytes=(\d+)-(\d*)$/i)
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] === '' ? totalSize - 1 : Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= totalSize) return null
  if (end < start) return null
  const cappedEnd = Math.min(end, totalSize - 1)
  return { start, end: cappedEnd, length: cappedEnd - start + 1 }
}

// Serve a key from R2 honouring Range. Returns Response on hit, null on
// miss / no bucket. `minSize` guards against serving a poisoned cache
// entry (e.g. a tiny upstream error body cached as a video): an object
// smaller than minSize is treated as a miss so the caller re-fetches.
export async function serveFromR2 (bucket, request, key, contentType, minSize = 0) {
  if (!bucket || typeof bucket.head !== 'function') return null
  let head
  try { head = await bucket.head(key) } catch { return null }
  if (!head) return null
  if (minSize && (Number(head.size) || 0) < minSize) return null

  const totalSize = Number(head.size) || 0
  const storedType = head.httpMetadata?.contentType || contentType || 'application/octet-stream'
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader ? parseRangeHeader(rangeHeader, totalSize) : null

  if (range) {
    let obj
    try { obj = await bucket.get(key, { range: { offset: range.start, length: range.length } }) } catch { return null }
    if (!obj) return null
    return new Response(obj.body, {
      status: 206,
      headers: {
        'content-type': storedType,
        'content-length': String(range.length),
        'content-range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=300',
        'x-cache-source': 'r2'
      }
    })
  }

  let obj
  try { obj = await bucket.get(key) } catch { return null }
  if (!obj) return null
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': storedType,
      'content-length': String(totalSize),
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300',
      'x-cache-source': 'r2'
    }
  })
}

// Tee an upstream Response into the user branch + an R2 put (scheduled
// on waitUntil so it survives the client disconnecting).
export function teeIntoCache (bucket, ctx, key, upstreamResponse, contentType) {
  if (!bucket || !upstreamResponse.ok || !upstreamResponse.body) return upstreamResponse
  const finalType = contentType || upstreamResponse.headers.get('content-type') || 'application/octet-stream'
  const lenHeader = upstreamResponse.headers.get('content-length')
  const total = lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null

  let userBranch, r2Branch
  try { [userBranch, r2Branch] = upstreamResponse.body.tee() } catch { return upstreamResponse }

  // Large bodies exceed the single-PUT body cap → multipart. Small ones
  // (or unknown length) use a plain put.
  const put = (total != null && total > PART_SIZE)
    ? r2PutMultipart(bucket, key, r2Branch, { httpMetadata: { contentType: finalType } })
    : bucket.put(key, r2Branch, { httpMetadata: { contentType: finalType } })
      .catch((e) => { try { console.error('[r2] put failed', key, e?.message || e) } catch {} })
  if (ctx?.waitUntil) ctx.waitUntil(put)

  const out = new Headers()
  out.set('content-type', finalType)
  if (total != null) out.set('content-length', String(total))
  out.set('accept-ranges', 'bytes')
  out.set('cache-control', 'public, max-age=300')
  out.set('x-cache-source', 'upstream-tee')
  return new Response(userBranch, { status: upstreamResponse.status, headers: out })
}

// Range MISS aside: user gets a Range upstream fetch now; a full-body
// fetch populates R2 in the background so the next Range hits cache.
export async function cachePopulateAside (bucket, ctx, key, rangeFetcher, fullFetcher, contentType) {
  const userPromise = rangeFetcher()
  if (bucket && ctx?.waitUntil) {
    ctx.waitUntil(r2PutRetry(
      bucket, key,
      // Re-fetch per attempt (the plane PUT 502s intermittently).
      async () => {
        const full = await fullFetcher()
        if (!full || !full.ok || !full.body) throw new Error('aside fetch not ok')
        return full.body
      },
      { httpMetadata: { contentType: contentType || 'application/octet-stream' } },
      2
    ))
  }
  return userPromise
}

// --- JSON metadata helpers ---

// Returns the parsed object if present and fresher than ttlSeconds,
// else null. Freshness uses R2's `uploaded` timestamp. Reads the body
// via Response() (the same path media reads use) rather than obj.text(),
// which some R2 shims don't implement.
export async function getJson (bucket, key, ttlSeconds) {
  if (!bucket || typeof bucket.get !== 'function') return null
  let obj
  try { obj = await bucket.get(key) } catch { return null }
  if (!obj) return null
  if (ttlSeconds && obj.uploaded) {
    const age = (Date.now() - new Date(obj.uploaded).getTime()) / 1000
    if (age > ttlSeconds) return null
  }
  try {
    const text = obj.body ? await new Response(obj.body).text() : await obj.text()
    return JSON.parse(text)
  } catch { return null }
}

// Multipart upload for LARGE bodies. A single PUT of a big video exceeds
// the plane's request body cap (Next proxyClientMaxBodySize), so it 502s
// and the video never caches. Multipart sends the stream as ~8 MiB parts
// (each well under the cap); the plane assembles + forwards on complete.
// Falls back to a single put when the binding lacks multipart. Best-effort:
// returns true/false, never throws.
const PART_SIZE = 8 * 1024 * 1024

export async function r2PutMultipart (bucket, key, stream, opts = {}, partSize = PART_SIZE) {
  if (!bucket || !stream) return false
  if (typeof bucket.createMultipartUpload !== 'function') {
    return r2PutRetry(bucket, key, () => stream, opts, 1)
  }
  let upload
  try { upload = await bucket.createMultipartUpload(key, opts) } catch (e) {
    try { console.error('[r2] multipart create failed', key, e?.message || e) } catch {}
    return false
  }
  const reader = stream.getReader()
  const parts = []
  let partNumber = 1
  let buf = new Uint8Array(0)
  const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o }
  const flush = async (chunk) => { parts.push(await upload.uploadPart(partNumber, chunk)); partNumber++ }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) {
        buf = buf.length ? concat(buf, value) : value
        while (buf.length >= partSize) { await flush(buf.subarray(0, partSize)); buf = buf.subarray(partSize) }
      }
    }
    // Final (short) part — always upload the remainder, and ensure at
    // least one part exists for an empty stream guard.
    if (buf.length > 0 || parts.length === 0) await flush(buf)
    await upload.complete(parts)
    return true
  } catch (e) {
    try { await upload.abort() } catch {}
    try { console.error('[r2] multipart upload failed', key, e?.message || e) } catch {}
    return false
  }
}

// Warm a resolved media URL into R2 (full body, multipart) in the
// background. Deduped via KV (warm:<key>) so concurrent seeks / re-parses
// don't each re-download, and skipped if the object is already cached.
// Best-effort — never throws, never blocks the response.
export async function warmUrl (ctx, bucket, key, url, headers, contentType, { lockTtl = 300 } = {}) {
  if (!bucket || !url) return
  try { const h = await bucket.head(key); if (h && (Number(h.size) || 0) > 256) return } catch {}
  const kv = ctx?.config?.kv
  const lock = `warm:${key}`
  try { if (kv) { if (await kv.get(lock)) return; await kv.put(lock, '1', { expirationTtl: lockTtl }) } } catch {}
  const job = (async () => {
    try {
      const f = await fetch(url, { headers })
      if (!f.ok || !f.body) return
      await r2PutMultipart(bucket, key, f.body, { httpMetadata: { contentType } })
    } catch (e) { try { console.error('[r2] warm failed', key, e?.message || e) } catch {} }
  })()
  if (ctx?.waitUntil) ctx.waitUntil(job); else await job
}

// Put with retry. The RandallFlare plane R2 PUT 502s intermittently, so
// a single attempt often fails silently. `makeBody` is called fresh on
// each attempt (streams can only be consumed once). Returns true on
// success. The shim 502s on string/buffer bodies but accepts a
// ReadableStream, so callers pass a stream factory.
export async function r2PutRetry (bucket, key, makeBody, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await bucket.put(key, makeBody(), opts)
      return true
    } catch (e) {
      if (i === tries - 1) {
        try { console.error('[r2] put gave up', key, e?.message || e) } catch {}
        return false
      }
    }
  }
  return false
}

// Put a JSON object (stream body + retry), in the BACKGROUND via
// waitUntil. Caching must never block/slow the user response — the
// plane PUT 502s intermittently and each attempt can take ~10s, so
// awaiting would stall the parse. Best-effort: if it doesn't land, the
// next request just re-fetches.
export function putJson (bucket, ctx, key, obj) {
  if (!bucket) return
  const json = JSON.stringify(obj)
  const p = r2PutRetry(
    bucket, key,
    () => new Response(json).body,
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } },
    2
  )
  if (ctx?.waitUntil) ctx.waitUntil(p)
}
