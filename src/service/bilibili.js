// /api/bilibili/web/* route handlers. Auth (meting-style) gates the data
// endpoints; bv_to_aid is an open utility.
import { HTTPException } from '../utils/http-exception.js'
import { jsonResponse } from '../utils/respond.js'
import { requireAuth } from '../utils/auth.js'
import * as crawler from '../bilibili/crawler.js'
import { bv2av } from '../bilibili/wbi.js'

const PLATFORM = 'bilibili'
const q = (request, key, dflt = '') => new URL(request.url).searchParams.get(key) ?? dflt
const requireQ = (request, key) => {
  const v = new URL(request.url).searchParams.get(key)
  if (v === null || v === '') throw new HTTPException(400, { message: `Missing query param: ${key}` })
  return v
}

export default async function bilibiliWebService (route, request, ctx) {
  const m = request.method

  if (m === 'GET' && route === 'fetch_one_video') {
    const bv = requireQ(request, 'bv_id')
    requireAuth(request, ctx, PLATFORM, route, bv)
    return jsonResponse(await crawler.fetchOneVideo(ctx, bv), { router: route, params: { bv_id: bv } })
  }
  if (m === 'GET' && route === 'fetch_video_playurl') {
    const bv = requireQ(request, 'bv_id')
    requireAuth(request, ctx, PLATFORM, route, bv)
    const cid = requireQ(request, 'cid')
    return jsonResponse(await crawler.fetchVideoPlayurl(ctx, bv, cid, { qn: q(request, 'qn', '80'), fnval: q(request, 'fnval', '4048') }), { router: route })
  }
  if (m === 'GET' && route === 'fetch_video_parts') {
    const bv = requireQ(request, 'bv_id')
    requireAuth(request, ctx, PLATFORM, route, bv)
    return jsonResponse(await crawler.fetchVideoParts(ctx, bv), { router: route })
  }
  if (m === 'GET' && route === 'fetch_user_profile') {
    const uid = requireQ(request, 'uid')
    requireAuth(request, ctx, PLATFORM, route, uid)
    return jsonResponse(await crawler.fetchUserProfile(ctx, uid), { router: route })
  }
  if (m === 'GET' && route === 'fetch_user_post_videos') {
    const uid = requireQ(request, 'uid')
    requireAuth(request, ctx, PLATFORM, route, uid)
    return jsonResponse(await crawler.fetchUserPostVideos(ctx, uid, q(request, 'pn', '1')), { router: route })
  }
  if (m === 'GET' && route === 'fetch_com_popular') {
    requireAuth(request, ctx, PLATFORM, route, '')
    return jsonResponse(await crawler.fetchComPopular(ctx, q(request, 'pn', '1')), { router: route })
  }
  if (m === 'GET' && route === 'fetch_video_comments') {
    const bv = requireQ(request, 'bv_id')
    requireAuth(request, ctx, PLATFORM, route, bv)
    return jsonResponse(await crawler.fetchVideoComments(ctx, bv2av(bv), q(request, 'pn', '1')), { router: route })
  }
  if (m === 'GET' && route === 'fetch_comment_reply') {
    const bv = requireQ(request, 'bv_id')
    requireAuth(request, ctx, PLATFORM, route, bv)
    return jsonResponse(await crawler.fetchCommentReply(ctx, bv2av(bv), requireQ(request, 'rpid'), q(request, 'pn', '1')), { router: route })
  }
  if (m === 'GET' && route === 'fetch_live_room_detail') {
    const roomId = requireQ(request, 'room_id')
    requireAuth(request, ctx, PLATFORM, route, roomId)
    return jsonResponse(await crawler.fetchLiveRoomDetail(ctx, roomId), { router: route })
  }
  if (m === 'GET' && route === 'bv_to_aid') {
    return jsonResponse({ aid: bv2av(requireQ(request, 'bv_id')) }, { router: route })
  }

  throw new HTTPException(404, { message: `Unknown bilibili/web route: ${route}` })
}
