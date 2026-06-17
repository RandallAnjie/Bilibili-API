// Shared JSON response helpers. The upstream FastAPI project wraps
// every payload as { code, router, params, data }. We keep a compatible
// envelope so existing clients parse the same shape.

export function jsonResponse (data, { status = 200, headers = {}, router = '', params = {} } = {}) {
  const body = {
    code: status,
    router,
    params,
    data
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

// Raw passthrough — used when we want to return the upstream JSON
// verbatim without the envelope (kept for parity flexibility).
export function rawJsonResponse (data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
