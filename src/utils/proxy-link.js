// Build self-referential /proxy links carrying a per-resource HMAC, so
// rewritten media URLs are fetchable without leaking the master token.
import { sign, canonical } from './auth.js'

export function proxyBase (request, ctx) {
  const u = new URL(request.url)
  // The edge terminates TLS and forwards plain HTTP to workerd, so
  // request.url is http://. Use the forwarded proto (or default https)
  // and the forwarded host so rewritten links point at the public URL.
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || u.host
  return `${proto}://${host}${ctx.config.http.prefix}`
}

// Build a cached /img link for an arbitrary external image URL (comment
// avatars etc. that aren't tied to a parsed work's id/kind). The HMAC
// over "img{url}" means only links we mint are fetchable — not an open
// image proxy.
export function imgProxyLink (request, ctx, srcUrl) {
  if (!srcUrl) return null
  const params = new URLSearchParams({ u: srcUrl, auth: sign(`img${srcUrl}`, ctx.config.auth.token) })
  return `${proxyBase(request, ctx)}/img?${params.toString()}`
}

// Build a /proxy link. When expSec is given the link is TEMPORARY: an
// exp=<unix-sec> is appended and the HMAC covers it, so guests get a
// link that stops working after the TTL and can't be tampered with.
export function proxyLink (request, ctx, platform, id, kind, expSec) {
  const secret = ctx.config.auth.token
  const params = new URLSearchParams({ platform, id: String(id), kind })
  if (expSec) {
    const exp = Math.floor(Date.now() / 1000) + expSec
    params.set('exp', String(exp))
    params.set('auth', sign(`${canonical('proxy', platform, id)}${exp}`, secret))
  } else {
    params.set('auth', sign(canonical('proxy', platform, id), secret))
  }
  return `${proxyBase(request, ctx)}/proxy?${params.toString()}`
}

// Replace the CDN URLs in a minimal hybrid result with /proxy links.
// expSec (optional) makes them temporary — used for guests.
export function rewriteMinimalToProxy (minimal, request, ctx, expSec) {
  const { platform, video_id: id } = minimal
  const L = (kind) => proxyLink(request, ctx, platform, id, kind, expSec)
  if (minimal.video_data) {
    minimal.video_data = {
      mp4_url: minimal.video_data.mp4_url ? L('mp4') : null,
      video_url: minimal.video_data.video_url ? L('video') : null,
      audio_url: minimal.video_data.audio_url ? L('audio') : null
    }
  }
  if (minimal.cover_data) {
    minimal.cover_data = { ...minimal.cover_data, cover: minimal.cover_data.cover ? L('cover') : null }
  }
  return minimal
}
