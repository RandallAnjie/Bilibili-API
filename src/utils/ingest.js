// Shared ingest for Bilibili: fetch a work's normalized record by BV id,
// map to minimal, and log it into the D1 aggregation layer
// (queries/authors/stats_history/author_stats_history). Used by the live
// parser (service/hybrid.js) and the cron refresher (service/cron.js).
import { fetchRawById, toMinimal } from '../hybrid/crawler.js'
import { proxyLink } from './proxy-link.js'
import { logQuery } from './db.js'
import * as bili from '../bilibili/crawler.js'

// Best-effort follower count (relation/stat); never throws.
async function fetchFollower (ctx, mid) {
  try {
    const r = await bili.fetchUserStat(ctx, mid)
    const f = r?.data?.follower
    return typeof f === 'number' ? f : null
  } catch { return null }
}

// Best-effort UP-assigned tags; never throws. (The view endpoint's tname
// is empty now, so the real category/hashtags come from this endpoint.)
async function fetchTags (ctx, bvId, tname) {
  try {
    const r = await bili.fetchVideoTags(ctx, bvId)
    const tags = (r?.data || []).map(t => t.tag_name).filter(Boolean)
    if (tags.length) return tags.slice(0, 20)
  } catch {}
  return tname ? [tname] : null
}

export async function ingestWork (ctx, request, platform, id, target, refresh = false) {
  const { raw } = await fetchRawById(ctx, platform, id, refresh)
  const min = toMinimal(platform, id, raw)
  const o = min.author || {}
  const s = min.statistics || {}
  // Enrich (follower + tags) concurrently to keep the parse fast.
  const [follower, tags] = await Promise.all([
    o.mid ? fetchFollower(ctx, o.mid) : Promise.resolve(null),
    fetchTags(ctx, id, raw.tname)
  ])
  await logQuery(ctx, {
    platform,
    video_id: id,
    type: 'video',
    author: o.name || null,
    authorInfo: o.mid
      ? {
          id: String(o.mid),
          name: o.name || null,
          avatar: proxyLink(request, ctx, platform, id, 'avatar'),
          extra: { mid: o.mid, follower, signature: o.sign || null }
        }
      : null,
    create_time: raw.pubdate || null,
    stats: {
      play: s.view, digg: s.like, comment: s.reply, share: s.share,
      danmaku: s.danmaku, coin: s.coin, collect: s.favorite
    },
    tags,
    music: null,
    parts: Array.isArray(raw.pages_list) && raw.pages_list.length > 1 ? raw.pages_list : null,
    description: min.desc || null,
    original_url: target,
    cover: proxyLink(request, ctx, platform, id, 'cover'),
    play: proxyLink(request, ctx, platform, id, 'mp4'),
    duration: raw.duration || null,
    extra: { stats: min.statistics || null }
  })
  return { raw, min }
}
