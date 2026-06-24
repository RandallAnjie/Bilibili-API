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
import { adminPageService, adminRecentService } from './service/admin.js'
import { discoverPageService, discoverApiService } from './service/discover.js'
import { hotPageService, hotApiService } from './service/hot.js'
import { workPageService, workApiService } from './service/work.js'
import { commentsApiService } from './service/comments.js'
import { searchPageService, searchApiService } from './service/search.js'
import { authorPageService, authorApiService } from './service/author.js'
import { cronService } from './service/cron.js'
import { imgService } from './service/img.js'
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
  if (pathname === '/__edge_cron' && request.method === 'POST') {
    return cronService(request, ctx)
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
  if (pathname === '/discover' && request.method === 'GET') {
    return discoverPageService(request, ctx)
  }
  if (pathname === '/api/discover' && request.method === 'GET') {
    return discoverApiService(request, ctx)
  }
  if (pathname === '/hot' && request.method === 'GET') {
    return hotPageService(request, ctx)
  }
  if (pathname === '/api/bilibili/hot' && request.method === 'GET') {
    return hotApiService(request, ctx)
  }
  if (pathname === '/work' && request.method === 'GET') {
    return workPageService(request, ctx)
  }
  if (pathname === '/api/work' && request.method === 'GET') {
    return workApiService(request, ctx)
  }
  if (pathname === '/api/comments' && request.method === 'GET') {
    return commentsApiService(request, ctx)
  }
  if (pathname === '/search' && request.method === 'GET') {
    return searchPageService(request, ctx)
  }
  if (pathname === '/api/search' && request.method === 'GET') {
    return searchApiService(request, ctx)
  }
  if (pathname === '/author' && request.method === 'GET') {
    return authorPageService(request, ctx)
  }
  if (pathname === '/api/author' && request.method === 'GET') {
    return authorApiService(request, ctx)
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
  if (pathname === '/img') {
    return imgService(request, ctx)
  }

  throw new HTTPException(404, { message: `No route for ${pathname}` })
}
