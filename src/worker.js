// RandallFlare / Cloudflare Workers entrypoint.
//
// Shape: `export default { async fetch(request, env, ctx) }`. API-only
// Bilibili parser worker — RandallFlare. Port of the Bilibili crawler
// dependency (FastAPI, httpx, yaml config, gmssl) is replaced with
// worker-native primitives. Cookies + the HMAC secret come from the
// `env` binding. Logs go to console as structured JSON.
import { withRequestLogger, logger } from './middleware/logger.js'
import { withErrorHandler } from './middleware/errors.js'
import { router } from './router.js'
import { buildConfig } from './config.js'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'access-control-max-age': '86400'
}

function addCorsHeaders (response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const handler = withRequestLogger(withErrorHandler(router))

export default {
  async fetch (request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    // Config + env ride along on a ctx-like bag so deeper layers don't
    // have to thread `env` themselves. waitUntil is exposed for the
    // download streaming path.
    const config = buildConfig(env)
    const innerCtx = {
      config,
      env,
      waitUntil: typeof ctx?.waitUntil === 'function'
        ? ctx.waitUntil.bind(ctx)
        : null
    }
    const response = await handler(request, innerCtx)
    return addCorsHeaders(response)
  }
}

export { logger }
