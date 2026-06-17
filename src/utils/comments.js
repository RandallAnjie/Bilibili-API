// Async comment ingestion for Bilibili. Fetches top replies for a video
// (oid = av number derived from the BV id), normalizes them, and stores
// them in D1. Best-effort + TTL-gated so the live parse path never blocks.
import { storeComments, metaGet } from './db.js'
import * as bili from '../bilibili/crawler.js'
import { bv2av } from '../bilibili/wbi.js'

const TTL = 6 * 3600 * 1000

function normalize (resp) {
  const list = resp?.data?.replies || []
  return list.map(c => ({
    comment_id: c.rpid != null ? String(c.rpid) : null,
    parent_id: null,
    text: c.content?.message || '',
    author: c.member?.uname || null,
    author_id: c.member?.mid != null ? String(c.member.mid) : null,
    avatar: c.member?.avatar || null,
    likes: c.like ?? 0,
    ctime: c.ctime ?? null
  })).filter(c => c.comment_id)
}

export async function fetchAndStoreComments (ctx, platform, id, { count = 50 } = {}) {
  try {
    const oid = bv2av(id).toString()
    const resp = await bili.fetchVideoComments(ctx, oid, 1)
    return await storeComments(ctx, platform, id, normalize(resp))
  } catch (e) {
    try { console.error('[comments] fetch failed', e?.message || e) } catch {}
    return 0
  }
}

export async function maybeFetchComments (ctx, platform, id) {
  const m = await metaGet(ctx, `cmt:${platform}:${id}`)
  if (m && (Date.now() - m.ts) < TTL) return 0
  return fetchAndStoreComments(ctx, platform, id)
}
