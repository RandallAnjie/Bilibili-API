// Worker-friendly structured JSON logger. pino + pino-pretty don't
// run in workerd, so we re-implement the surface the rest of the code
// uses — `logger.info({...}, msg)`, `logger.child({...}).info(...)` —
// using console.log and a minimal JSON shape. The RandallFlare log
// tail captures stdout the same way it would pino output.

const LEVEL_PRIORITY = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }
const DEFAULT_LEVEL = 'info'

function makeLogger (bindings = {}, minLevel = DEFAULT_LEVEL) {
  const threshold = LEVEL_PRIORITY[minLevel] ?? LEVEL_PRIORITY.info

  function emit (level, payload, message) {
    const prio = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info
    if (prio < threshold) return
    const obj = typeof payload === 'object' && payload !== null ? payload : {}
    const msg = typeof payload === 'string' ? payload : (message || '')
    const out = {
      time: new Date().toISOString(),
      level,
      ...bindings,
      ...obj,
      msg
    }
    try {
      console.log(JSON.stringify(out))
    } catch {
      console.log(`[${level}] ${msg}`)
    }
  }

  return {
    trace: (p, m) => emit('trace', p, m),
    debug: (p, m) => emit('debug', p, m),
    info: (p, m) => emit('info', p, m),
    warn: (p, m) => emit('warn', p, m),
    error: (p, m) => emit('error', p, m),
    fatal: (p, m) => emit('fatal', p, m),
    child: (extra) => makeLogger({ ...bindings, ...extra }, minLevel)
  }
}

const logger = makeLogger()

const generateRequestId = () => Math.random().toString(36).slice(2, 9)

const withRequestLogger = (handler) => {
  return async (request, ctx = {}) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const url = new URL(request.url)

    const reqInfo = {
      method: request.method,
      url: url.pathname,
      headers: Object.fromEntries(request.headers)
    }

    const requestScopedLogger = makeLogger(
      { req: reqInfo },
      ctx.config?.log?.level || DEFAULT_LEVEL
    )

    ctx.logger = requestScopedLogger
    ctx.requestId = requestId
    ctx.responseHeaders = new Headers()
    ctx.error = null

    let response = await handler(request, ctx)

    const mergedHeaders = new Headers(response.headers)
    for (const [key, value] of ctx.responseHeaders) {
      mergedHeaders.set(key, value)
    }
    mergedHeaders.set('x-request-id', requestId)
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders
    })

    const responseTime = Date.now() - startTime
    const responseHeaders = {}
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value
    }
    const bindings = {
      reqId: requestId,
      res: { status: response.status, headers: responseHeaders },
      responseTime
    }
    const level = ctx.error ? 'error' : 'info'
    const message = ctx.error?.message || 'Request completed'
    requestScopedLogger[level](bindings, message)
    return response
  }
}

export { withRequestLogger, logger }
