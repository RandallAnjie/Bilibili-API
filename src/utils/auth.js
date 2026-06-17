// Meting-style auth. A request is authorised if it carries either:
//   - ?token=<secret>            (master key), or
//   - ?auth=<HMAC-SHA1 hex>      where the message is the canonical
//     string "{platform}{route}{primaryId}".
//
// Mirrors Meting-API/src/service/api.js: HMAC-SHA1(secret, message).
import { hmacSha1Hex } from '../lib/sha1.js'
import { HTTPException } from './http-exception.js'

export const sign = (message, secret) => hmacSha1Hex(secret, message)

export const canonical = (platform, route, primaryId = '') =>
  `${platform}${route}${primaryId}`

// Client IP from the usual edge headers (used for guest rate limiting).
export const getClientIp = (request) =>
  request.headers.get('cf-connecting-ip') ||
  request.headers.get('rf-connecting-ip') ||
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  request.headers.get('x-real-ip') ||
  'unknown'

// True if the request carries a valid master token or per-resource HMAC.
export function isAuthorised (request, ctx, platform, route, primaryId = '') {
  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token') || ''
  const queryAuth = url.searchParams.get('auth') || ''
  const secret = ctx.config.auth.token
  if (queryToken && queryToken === secret) return true
  if (queryAuth && queryAuth === sign(canonical(platform, route, primaryId), secret)) return true
  return false
}

// Auth for /proxy links. Accepts the master token, a permanent HMAC
// over "proxy{platform}{id}", or a TEMPORARY link carrying ?exp= with an
// HMAC over "proxy{platform}{id}{exp}" — valid until exp (unix sec).
export function requireProxyAuth (request, ctx, platform, id) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''
  const authp = url.searchParams.get('auth') || ''
  const exp = url.searchParams.get('exp') || ''
  const secret = ctx.config.auth.token

  if (token && token === secret) return
  if (authp) {
    if (exp) {
      const expected = sign(`${canonical('proxy', platform, id)}${exp}`, secret)
      if (authp === expected) {
        if (Date.now() <= Number(exp) * 1000) return
        throw new HTTPException(403, { message: '链接已过期，请重新解析 / link expired' })
      }
    } else if (authp === sign(canonical('proxy', platform, id), secret)) {
      return
    }
  }
  throw new HTTPException(401, { message: 'proxy: bad or expired auth' })
}

// Throws HTTPException(401) unless the caller is authorised. Returns
// nothing on success. `primaryId` is the route's main identifier
// (aweme_id / itemId / sec_user_id / url …) — '' when there isn't one.
export function requireAuth (request, ctx, platform, route, primaryId = '') {
  if (isAuthorised(request, ctx, platform, route, primaryId)) return
  const url = new URL(request.url)
  const sent = url.searchParams.get('auth') || url.searchParams.get('token') || '(none)'
  throw new HTTPException(401, {
    message: `Unauthorized: bad token/auth for ${platform}/${route}. ` +
      `Pass ?token=<secret> or ?auth=HMAC-SHA1(secret,"${canonical(platform, route, primaryId)}"). ` +
      `Received: ${sent.slice(0, 12)}…`
  })
}
