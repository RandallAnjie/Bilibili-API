// Bilibili parser. Detect a bilibili/b23.tv URL, fetch the (cached)
// normalized record, and map it to the unified minimal schema. Bilibili
// video is DASH (separate video + audio); we also expose a combined mp4
// (durl) for one-click playback/download.
import { getBvId } from '../utils/ids.js'
import { fetchBiliCached } from '../utils/meta-cache.js'
import { HTTPException } from '../utils/http-exception.js'

export function detectPlatform (url) {
  if (url.includes('bilibili') || url.includes('b23.tv') || url.includes('bili2233') || /BV[0-9A-Za-z]{10}/.test(url)) return 'bilibili'
  return null
}

export async function resolvePlatformId (url) {
  if (/\/proxy\?/.test(url) || /[?&]kind=/.test(url)) {
    throw new HTTPException(400, { message: '这是解析结果链接，请粘贴 B 站原始视频链接 / 分享口令' })
  }
  if (!detectPlatform(url)) throw new HTTPException(400, { message: 'Not a Bilibili URL (need bilibili.com / b23.tv / BV…)' })
  return { platform: 'bilibili', id: await getBvId(url) }
}

export async function fetchRawById (ctx, platform, id, refresh = false) {
  const { raw } = { raw: (await fetchBiliCached(ctx, id, refresh)).data }
  return { raw }
}

export function toMinimal (platform, videoId, data) {
  const v = data.dash?.video?.[0]?.baseUrl || null
  const a = data.dash?.audio?.[0]?.baseUrl || null
  const mp4 = data.durl?.[0]?.url || null
  return {
    type: 'video',
    platform: 'bilibili',
    video_id: videoId,
    desc: data.title,
    create_time: null,
    author: data.owner || null,
    music: null,
    statistics: data.stat || null,
    duration: data.duration || null,
    cover_data: { cover: data.pic || null },
    video_data: {
      mp4_url: mp4, // combined, playable
      video_url: v, // DASH hi-res video (no audio)
      audio_url: a // DASH audio
    }
  }
}

export async function hybridParseSingleVideo (ctx, url, minimal = false, refresh = false) {
  const { platform, id } = await resolvePlatformId(url)
  const { raw } = await fetchRawById(ctx, platform, id, refresh)
  if (!minimal) return raw
  return toMinimal(platform, id, raw)
}

// Candidate CDN urls for a proxy `kind`, in priority order. Bilibili
// gives a primary baseUrl + several backupUrl mirrors per stream.
export function mediaCandidates (platform, raw, kind) {
  const out = []
  const push = (u) => { if (typeof u === 'string' && u) out.push(u) }
  const pushStream = (s) => { if (s) { push(s.baseUrl || s.base_url); for (const b of (s.backupUrl || s.backup_url || [])) push(b) } }

  if (kind === 'mp4') {
    for (const d of (raw.durl || [])) { push(d.url); for (const b of (d.backup_url || [])) push(b) }
  } else if (kind === 'video') {
    for (const s of (raw.dash?.video || [])) pushStream(s)
  } else if (kind === 'audio') {
    for (const s of (raw.dash?.audio || [])) pushStream(s)
  } else if (kind === 'cover') {
    push(raw.pic)
  }
  return [...new Set(out.map(u => u.replace(/^http:/, 'https:')))]
}
