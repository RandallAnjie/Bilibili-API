// Async comment ingestion for Bilibili. Fetches top comments + their inline
// replies (oid = the view's authoritative aid), normalizes them, and stores
// them in D1. Best-effort + TTL-gated so the live parse path never blocks.
import { storeComments, metaGet } from './db.js'
import * as bili from '../bilibili/crawler.js'
import { fetchBiliCached } from './meta-cache.js'

const TTL = 6 * 3600 * 1000

function mapBili (c, parentId) {
  return {
    comment_id: c.rpid != null ? String(c.rpid) : null,
    parent_id: parentId || null,
    text: c.content?.message || '',
    author: c.member?.uname || null,
    author_id: c.member?.mid != null ? String(c.member.mid) : null,
    avatar: c.member?.avatar || null,
    likes: c.like ?? 0,
    ctime: c.ctime ?? null
  }
}

export async function fetchAndStoreComments (ctx, platform, id, { count = 50 } = {}) {
  try {
    // oid is the numeric aid. bv2av doesn't round-trip the new large aid
    // format, so read the authoritative aid from the cached view record.
    const { data } = await fetchBiliCached(ctx, id)
    const oid = data?.aid
    if (!oid) return 0
    const resp = await bili.fetchVideoComments(ctx, String(oid), 1)
    const list = resp?.data?.replies || []
    const out = list.map(c => mapBili(c, null))
    // each top reply carries a few inline sub-replies
    for (const c of list) for (const rc of (c.replies || [])) out.push(mapBili(rc, String(c.rpid)))
    return await storeComments(ctx, platform, id, out.filter(c => c.comment_id))
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
