// Bilibili id extraction. Pull the BVid from a URL or share text;
// b23.tv / bili2233.cn short links are resolved by following redirects.
import { HTTPException } from './http-exception.js'

const URL_RE = /https?:\/\/\S+/
const BV_RE = /(BV[0-9A-Za-z]{10})/

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
