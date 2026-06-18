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
  if (!item) throw new HTTPException(502, { message: `Bilibili dynamic returned no item (code ${resp?.code}: ${resp?.message || ''}) — bad cookie?` })
  const data = normalizeDynamic(dynId, item)
  if (data.images.length || data.text) putJson(bucket, ctx, key, data)
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
