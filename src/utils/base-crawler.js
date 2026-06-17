// Minimal fetch-based crawler client, replacing the upstream httpx
// BaseCrawler. Carries the platform headers (UA / Referer / Cookie)
// and returns parsed JSON.
import { HTTPException } from './http-exception.js'

export function buildHeaders ({ userAgent, referer, cookie, extra = {} }) {
  const h = {
    'User-Agent': userAgent,
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
    ...extra
  }
  if (referer) h.Referer = referer
  if (cookie) h.Cookie = cookie
  return h
}

async function parseJson (resp, url) {
  const text = await resp.text()
  if (!resp.ok) {
    throw new HTTPException(resp.status === 404 ? 404 : 502, {
      message: `Upstream ${resp.status} for ${url}: ${text.slice(0, 200)}`
    })
  }
  if (!text) {
    // Douyin returns an empty body when it blocks the request (bad
    // cookie / signature). Surface it clearly.
    throw new HTTPException(502, {
      message: `Upstream returned an empty body for ${url} — usually a bad/expired cookie or blocked signature.`
    })
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HTTPException(502, {
      message: `Upstream returned non-JSON for ${url}: ${text.slice(0, 200)}`
    })
  }
}

export async function fetchGetJson (url, headers) {
  const resp = await fetch(url, { method: 'GET', headers, redirect: 'follow' })
  return parseJson(resp, url)
}

export async function fetchPostJson (url, headers, body) {
  const resp = await fetch(url, { method: 'POST', headers, body, redirect: 'follow' })
  return parseJson(resp, url)
}
