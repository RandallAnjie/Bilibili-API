// Config builder — turns a worker `env` binding into a structured
// config object. Pure function; callable per-request.
//
// The Bilibili cookie lives in env (BILI_COOKIE). Auth uses a single
// HMAC secret (BILI_API_TOKEN), mirroring the sibling Meting / Douyin
// workers. Storage bindings: BILI_R2 (cache), BILI_D1 (admin log),
// BILI_KV (rate limit).

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export function buildConfig (env) {
  env = env || {}
  return {
    http: {
      prefix: env.HTTP_PREFIX || ''
    },
    auth: {
      token: env.BILI_API_TOKEN || 'token',
      tokenSource: env.BILI_API_TOKEN ? 'env' : 'default'
    },
    bili: {
      // Bilibili cookie — strongly recommended (wbi + higher quality
      // playurl). Without it, view works but playurl is limited.
      cookie: env.BILI_COOKIE || '',
      userAgent: env.DEFAULT_USER_AGENT || DEFAULT_UA
    },
    // R2 bucket binding for caching media bytes + metadata JSON.
    mediaR2: env.BILI_R2 || env.MEDIA_R2 || null,
    // D1 database binding for the query log (/admin).
    d1: env.BILI_D1 || env.DB || null,
    // KV namespace binding for guest rate limiting (preferred over D1).
    kv: env.BILI_KV || env.KV || null,
    cache: {
      metaTtl: toNumber(env.META_CACHE_TTL, 3600)
    },
    guest: {
      enabled: !['0', 'false', 'no', 'off'].includes(String(env.GUEST_ENABLED ?? '').toLowerCase()),
      limit: toNumber(env.GUEST_RATE_LIMIT, 20),
      windowSec: toNumber(env.GUEST_RATE_WINDOW, 3600),
      linkTtlSec: toNumber(env.GUEST_LINK_TTL, 7200)
    },
    log: {
      level: env.LOG_LEVEL || 'info'
    },
    rawEnv: env
  }
}

export const DEFAULT_USER_AGENT = DEFAULT_UA

export default buildConfig({})
