// Cached Bilibili fetcher. view (title/owner/stat/pic/cid) + playurl
// (DASH video+audio and a combined mp4 durl) are normalized into one
// JSON record stored at meta/bilibili/{bvid}.json for the TTL window.
import { getJson, putJson, metaKey } from './r2cache.js'
import { HTTPException } from './http-exception.js'
import * as bili from '../bilibili/crawler.js'

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
    owner: d.owner,
    stat: d.stat,
    duration: d.duration,
    pages: Array.isArray(d.pages) ? d.pages.length : 1,
    dash: dash ? { video: dash.video || [], audio: dash.audio || [] } : null,
    durl: durl || null
  }
  putJson(bucket, ctx, key, data)
  return { data, cached: false }
}
