import { logger as baseLogger } from './logger.js'

export function withErrorHandler (handler) {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx)
    } catch (err) {
      const status = err?.status || 500

      const requestLogger = ctx?.logger ?? baseLogger
      const url = new URL(request.url)
      const debugMode =
        ctx?.config?.log?.level === 'debug' ||
        ctx?.config?.log?.level === 'trace' ||
        ctx?.env?.DEBUG_ERRORS === '1' ||
        ctx?.env?.DEBUG_ERRORS === 'true'

      const logPayload = {
        error: {
          message: err?.message,
          stack: err?.stack,
          name: err?.name,
          status
        },
        request: {
          method: request.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          userAgent: request.headers.get('user-agent'),
          ip:
            request.headers.get('cf-connecting-ip') ||
            request.headers.get('rf-connecting-ip') ||
            request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'unknown'
        }
      }
      if (ctx?.requestId) {
        logPayload.request.requestId = ctx.requestId
      }
      requestLogger.error(logPayload, 'Request error occurred')
      try {
        console.error('[errors] ' + (err?.name || 'Error') + ': ' + (err?.message || '(no message)'))
        if (err?.stack) console.error(err.stack)
      } catch {}

      if (ctx?.responseHeaders) {
        ctx.responseHeaders.set('x-error-message', encodeURIComponent(err?.message || ''))
        ctx.error = err
      }

      // API responses are JSON to match the FastAPI original's shape.
      const body = {
        code: status,
        message: err?.message || '(no message)',
        path: url.pathname
      }
      if (debugMode && err?.stack) body.stack = err.stack
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      })
    }
  }
}
