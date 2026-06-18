// Cached Bilibili fetcher. view (title/owner/stat/pic/cid) + playurl
// (DASH video+audio and a combined mp4 durl) are normalized into one
// JSON record stored at meta/bilibili/{bvid}.json for the TTL window.
import { getJson, putJson, metaKey } from './r2cache.js'
import { HTTPException } from './http-exception.js'
import * as bili from '../bilibili/crawler.js'

// Dynamic / opus (图文动态) — normalized into the same record shape the
// rest of the pipeline understands, marked with _kind:'opus'. Cached at
// meta/bilibili/opus:<id>.json.
function normalizeDynamic (dynId, item) {
  const mods = item.modules || {}
  const au = mods.module_author || {}
  const md = mods.module_dynamic || {}
  const stat = mods.module_stat || {}
  const major = md.major || {}
  let text = ''
  let images = []
  if (major.opus) {
    text = major.opus.summary?.text || ''
    images = (major.opus.pics || []).map(p => p.url).filter(Boolean)
  } else if (major.draw) {
    images = (major.draw.items || []).map(i => i.src).filter(Boolean)
    text = md.desc?.text || ''
  } else if (major.archive) {
    images = major.archive.cover ? [major.archive.cover] : []
    text = major.archive.title || md.desc?.text || ''
  } else {
    text = md.desc?.text || ''
  }
  return {
    _kind: 'opus',
    dyn_id: dynId,
    dyn_type: item.type || null,
    text,
    images,
    owner: { mid: au.mid, name: au.name, face: au.face },
    pubdate: au.pub_ts || null,
    stat: { like: stat.like?.count ?? 0, reply: stat.comment?.count ?? 0, share: stat.forward?.count ?? 0 }
  }
}

export async function fetchBiliDynamicCached (ctx, dynId, refresh = false) {
  const bucket = ctx.config.mediaR2
  const key = metaKey('bilibili', `opus:${dynId}`)
  if (bucket && !refresh) {
    const cached = await getJson(bucket, key, ctx.config.cache.metaTtl)
    if (cached) return { data: cached, cached: true }
  }
  const resp = await bili.fetchDynamicDetail(ctx, dynId)
  const item = resp?.data?.item
  if (!item) {
    // A non-zero code is an upstream verdict (deleted / hidden / private),
    // not our problem — surface it cleanly as 404 rather than "bad cookie".
    if (resp?.code) throw new HTTPException(404, { message: `B站动态无法获取：${resp.message || 'code ' + resp.code}` })
    throw new HTTPException(502, { message: 'Bilibili dynamic returned no item — bad cookie?' })
  }
  const data = normalizeDynamic(dynId, item)
  if (data.images.length || data.text) putJson(bucket, ctx, key, data)
  return { data, cached: false }
}

// Bangumi (番剧/影视) — PGC. video_id is "ep:<id>" or "ss:<id>". Metadata
// (title/cover/cid) always resolves; the playurl is region/VIP-gated, so
// the stream is best-effort (info + cover still cached when gated).
export async function fetchBiliBangumiCached (ctx, vid, refresh = false) {
  const bucket = ctx.config.mediaR2
  const key = metaKey('bilibili', vid)
  if (bucket && !refresh) {
    const cached = await getJson(bucket, key, ctx.config.cache.metaTtl)
    if (cached) return { data: cached, cached: true }
  }
  const [kind, idval] = vid.split(':')
  const sv = await bili.fetchBangumiSeason(ctx, kind, idval)
  const result = sv?.result
  if (!result) throw new HTTPException(sv?.code === -404 ? 404 : 502, { message: `B站番剧获取失败：${sv?.message || 'code ' + sv?.code}` })
  const eps = result.episodes || []
  let ep = kind === 'ep'
    ? eps.find(e => String(e.id) === idval || String(e.ep_id) === idval)
    : (result.new_ep ? eps.find(e => String(e.id) === String(result.new_ep.id)) : null)
  if (!ep) ep = eps[0] || (result.new_ep && { id: result.new_ep.id, cid: result.new_ep.cid, cover: result.new_ep.cover, long_title: result.new_ep.long_title })
  if (!ep || !ep.cid) throw new HTTPException(404, { message: 'B站番剧无可解析分集（可能区域限制/下架）' })

  const epid = ep.id || ep.ep_id || idval
  let dash = null
  let durl = null
  let playMsg = null
  try { const r = await bili.fetchBangumiPlayurl(ctx, epid, ep.cid, { fnval: '4048', qn: '80' }); const pr = r?.result || r; dash = pr?.dash || null; if (r?.code && r.code !== 0) playMsg = r.message } catch {}
  try { const r = await bili.fetchBangumiPlayurl(ctx, epid, ep.cid, { fnval: '1', qn: '80' }); const pr = r?.result || r; durl = pr?.durl || null } catch {}

  const s = result.stat || {}
  const data = {
    bvid: ep.bvid || result.season_id,
    aid: ep.aid,
    cid: ep.cid,
    ep_id: epid,
    title: [result.season_title || result.title, ep.long_title || ep.title || ep.share_copy].filter(Boolean).join(' '),
    desc: result.evaluate || '',
    pic: ep.cover || result.cover,
    pubdate: ep.pub_time || null,
    tname: result.season_title || '番剧',
    owner: { mid: result.season_id ? `ss${result.season_id}` : null, name: result.season_title || result.title, face: result.cover },
    stat: { view: s.views, danmaku: s.danmakus, reply: s.reply, favorite: s.favorites ?? s.favorite, coin: s.coins, like: s.likes, share: s.share },
    duration: ep.duration ? Math.round(ep.duration / 1000) : null,
    pages: 1,
    pages_list: [],
    dash: dash ? { video: dash.video || [], audio: dash.audio || [] } : null,
    durl: durl || null,
    is_bangumi: true,
    play_restricted: (!dash && !durl) ? (playMsg || '区域/会员限制，无法取流') : null
  }
  putJson(bucket, ctx, key, data)
  return { data, cached: false }
}

export async function fetchBiliCached (ctx, bvId, refresh = false) {
  const bucket = ctx.config.mediaR2
  const key = metaKey('bilibili', bvId)
  if (bucket && !refresh) {
    const cached = await getJson(bucket, key, ctx.config.cache.metaTtl)
    if (cached) return { data: cached, cached: true }
  }

  const view = await bili.fetchOneVideo(ctx, bvId)
  const d = view.data
  if (!d) throw new HTTPException(502, { message: `Bilibili view returned no data (code ${view.code}: ${view.message || ''}) — bad cookie?` })
  const cid = d.cid

  let dash = null
  let durl = null
  try { const r = await bili.fetchVideoPlayurl(ctx, bvId, cid, { fnval: '4048', qn: '80' }); dash = r.data?.dash || null } catch {}
  try { const r = await bili.fetchVideoPlayurl(ctx, bvId, cid, { fnval: '1', qn: '80' }); durl = r.data?.durl || null } catch {}

  const data = {
    bvid: d.bvid || bvId,
    aid: d.aid,
    cid,
    title: d.title,
    desc: d.desc,
    pic: d.pic,
    pubdate: d.pubdate,
    tname: d.tname || null,
    owner: d.owner,
    stat: d.stat,
    duration: d.duration,
    pages: Array.isArray(d.pages) ? d.pages.length : 1,
    pages_list: Array.isArray(d.pages)
      ? d.pages.map(p => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration }))
      : [],
    dash: dash ? { video: dash.video || [], audio: dash.audio || [] } : null,
    durl: durl || null
  }
  putJson(bucket, ctx, key, data)
  return { data, cached: false }
}
