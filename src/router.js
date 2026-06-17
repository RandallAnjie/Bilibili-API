// Manual path router (no framework):
//   /                   -> 解析台 (parser page)
//   /docs               -> API docs
//   /admin              -> recent-query dashboard
//   /api/admin/recent   -> query log JSON
//   /api/bilibili/web/* -> bilibiliWebService
//   /api/hybrid/*       -> hybridService (parse / update_cookie)
//   /proxy /download    -> media reverse proxy / download
//
// An optional HTTP_PREFIX (e.g. "/v1") is stripped before matching.
import bilibiliWebService from './service/bilibili.js'
import { hybridService, downloadService } from './service/hybrid.js'
import { proxyService } from './service/proxy.js'
import { cacheDebugService } from './service/debug.js'
import { adminPageService, adminRecentService } from './service/admin.js'
import appService from './service/app.js'
import docsService from './service/docs.js'
import { HTTPException } from './utils/http-exception.js'

export async function router (request, ctx) {
  const url = new URL(request.url)
  const prefix = ctx.config.http.prefix
  let pathname = url.pathname

  if (prefix && pathname.startsWith(prefix)) {
    pathname = pathname.slice(prefix.length)
  }
  if (pathname === '') pathname = '/'

  if (pathname === '/favicon.ico') {
    return new Response(null, { status: 204 })
  }
  if (pathname === '/' && request.method === 'GET') {
    return appService(request, ctx)
  }
  if (pathname === '/docs' && request.method === 'GET') {
    return docsService(request, ctx)
  }
  if (pathname === '/admin' && request.method === 'GET') {
    return adminPageService(request, ctx)
  }
  if (pathname === '/api/admin/recent' && request.method === 'GET') {
    return adminRecentService(request, ctx)
  }
  if (pathname.startsWith('/api/bilibili/web/')) {
    return bilibiliWebService(pathname.slice('/api/bilibili/web/'.length), request, ctx)
  }
  if (pathname.startsWith('/api/hybrid/')) {
    return hybridService(pathname.slice('/api/hybrid/'.length), request, ctx)
  }
  if (pathname === '/download') {
    return downloadService(request, ctx)
  }
  if (pathname === '/proxy') {
    return proxyService(request, ctx)
  }
  if (pathname === '/__cachedebug') {
    return cacheDebugService(request, ctx)
  }

  throw new HTTPException(404, { message: `No route for ${pathname}` })
}
