// Shared ingest for Bilibili: fetch a work's normalized record by BV id,
// map to minimal, and log it into the D1 aggregation layer
// (queries/authors/stats_history/author_stats_history). Used by the live
// parser (service/hybrid.js) and the cron refresher (service/cron.js).
import { fetchRawById, toMinimal, mediaCandidates } from '../hybrid/crawler.js'
import { proxyLink } from './proxy-link.js'
import { logQuery } from './db.js'
import { warmUrl, mediaKey } from './r2cache.js'
import * as bili from '../bilibili/crawler.js'

const CT = { cover: 'image/jpeg', avatar: 'image/jpeg', mp4: 'video/mp4', video: 'video/mp4', audio: 'audio/mp4' }

// Proactively warm a parsed work's media into R2 so discover/search/work
// resources are served from cache, not the source CDN. Best-effort +
// deduped; pass warmVideo=false (cron) to skip the heavy video download.
function warmMedia (ctx, platform, id, raw, warmVideo) {
  const bucket = ctx.config.mediaR2
  if (!bucket) return
  const headers = { 'User-Agent': ctx.config.bili.userAgent, Referer: 'https://www.bilibili.com/' }
  const kinds = warmVideo ? ['cover', 'avatar', 'mp4'] : ['cover', 'avatar']
  for (const kind of kinds) {
    const cands = mediaCandidates(platform, raw, kind)
    if (cands.length) warmUrl(ctx, bucket, mediaKey(platform, id, kind), cands[0], headers, CT[kind] || 'application/octet-stream')
  }
}

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

export async function ingestWork (ctx, request, platform, id, target, refresh = false, opts = {}) {
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
  // Proactively cache the work's media into R2 (best-effort, background).
  warmMedia(ctx, platform, id, raw, opts.warmVideo !== false)
  return { raw, min }
}
