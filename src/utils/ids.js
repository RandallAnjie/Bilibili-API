// Bilibili id extraction. Pull the BVid from a URL or share text;
// b23.tv / bili2233.cn short links are resolved by following redirects.
import { HTTPException } from './http-exception.js'

const URL_RE = /https?:\/\/\S+/
const BV_RE = /(BV[0-9A-Za-z]{10})/
// 动态 / opus 图文：t.bilibili.com/<id> · bilibili.com/opus/<id> ·
// m.bilibili.com/dynamic/<id>. The id is a long numeric string.
const DYN_RE = /(?:t\.bilibili\.com|m\.bilibili\.com\/dynamic|bilibili\.com\/opus)\/(\d+)/
// 番剧 / 影视：bilibili.com/bangumi/play/ep<id> or ss<id>
const BANGUMI_RE = /bangumi\/play\/(ep|ss)(\d+)/i

export function isDynamicUrl (url) {
  return typeof url === 'string' && DYN_RE.test(url)
}

// Resolve any bilibili link to { kind:'video'|'opus', id }. Handles BV
// links, dynamic/opus links, and b23.tv short links (resolved once).
export async function resolveBiliTarget (input) {
  const url = extractValidUrl(input)
  if (!url) throw new HTTPException(400, { message: 'Invalid URL (no BV id / link found)' })
  let m
  if ((m = url.match(BANGUMI_RE))) return { kind: 'bangumi', id: `${m[1].toLowerCase()}:${m[2]}` }
  if ((m = url.match(BV_RE))) return { kind: 'video', id: m[1] }
  if ((m = url.match(DYN_RE))) return { kind: 'opus', id: m[1] }
  const finalUrl = await resolveUrl(url)
  if ((m = finalUrl.match(BANGUMI_RE))) return { kind: 'bangumi', id: `${m[1].toLowerCase()}:${m[2]}` }
  if ((m = finalUrl.match(BV_RE))) return { kind: 'video', id: m[1] }
  if ((m = finalUrl.match(DYN_RE))) return { kind: 'opus', id: m[1] }
  throw new HTTPException(404, { message: `No BV / dynamic / bangumi id in ${finalUrl}` })
}

export function extractValidUrl (input) {
  if (typeof input !== 'string') return null
  const m = input.match(URL_RE)
  return m ? m[0] : null
}

async function resolveUrl (url) {
  const resp = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }
  })
  return resp.url || url
}

// Accepts a raw BV id, a bilibili.com/video/BV... URL, or a b23.tv short
// link (resolved via redirect). Returns the BVid.
export async function getBvId (input) {
  if (typeof input === 'string') {
    const direct = input.match(BV_RE)
    if (direct) return direct[1]
  }
  const url = extractValidUrl(input)
  if (!url) throw new HTTPException(400, { message: 'Invalid URL (no BV id / link found)' })
  const m1 = url.match(BV_RE)
  if (m1) return m1[1]
  const finalUrl = await resolveUrl(url)
  const m2 = finalUrl.match(BV_RE)
  if (m2) return m2[1]
  throw new HTTPException(404, { message: `BV id not found in ${finalUrl}` })
}
