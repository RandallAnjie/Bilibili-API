// Bilibili web API endpoints. Mirrors crawlers/bilibili/web/endpoints.py.
const API = 'https://api.bilibili.com'
const LIVE = 'https://api.live.bilibili.com'

export const BiliEndpoints = {
  POST_DETAIL: `${API}/x/web-interface/view`, // ?bvid=  (no wbi)
  VIDEO_PLAYURL: `${API}/x/player/wbi/playurl`, // wbi
  VIDEO_PARTS: `${API}/x/player/pagelist`, // ?bvid=
  USER_POST: `${API}/x/space/wbi/arc/search`, // wbi
  USER_DETAIL: `${API}/x/space/wbi/acc/info`, // wbi
  COM_POPULAR: `${API}/x/web-interface/popular`, // wbi
  VIDEO_COMMENTS: `${API}/x/v2/reply`,
  COMMENT_REPLY: `${API}/x/v2/reply/reply`,
  USER_DYNAMIC: `${API}/x/polymer/web-dynamic/v1/feed/space`, // wbi
  LIVEROOM_DETAIL: `${LIVE}/room/v1/Room/get_info`,
  LIVE_VIDEOS: `${LIVE}/room/v1/Room/playUrl`,
  LIVE_AREAS: `${LIVE}/room/v1/Area/getList`
}

export const BILI_REFERER = 'https://www.bilibili.com/'
