// Internal cron entrypoint: POST /__edge_cron (RandallFlare convention —
// the edge agent calls this on the operator's schedule with an
// X-Edge-Cron-Expression header and NO token). Must respond 2xx.
//
// Since no token is available, this is made safe by being throttled,
// bounded, and idempotent/read-only: every action is a public-video parse
// that we'd serve anyway, just refreshed on a schedule. Jobs each run:
//   - refresh: re-parse the oldest-refreshed works -> new stats snapshots
//     (feeds the /work line chart) + fresh author follower points.
//   - grow: pull a page of the Bilibili popular feed and ingest a few
//     not-yet-seen videos, slowly building the in-site library.
import { staleQueries, metaGet, metaSet } from '../utils/db.js'
import { ingestWork } from '../utils/ingest.js'
import { maybeFetchComments } from '../utils/comments.js'
import * as bili from '../bilibili/crawler.js'

const THROTTLE_MS = 50 * 1000
const REFRESH_BATCH = 8
const GROW_BATCH = 4

export async function cronService (request, ctx) {
  const expr = request.headers.get('x-edge-cron-expression') || 'default'
  // Throttle: ignore bursts / external pokes within the window.
  const last = await metaGet(ctx, `cron:last:${expr}`)
  const now = Date.now()
  if (last && (now - last.ts) < THROTTLE_MS) {
    return json({ code: 200, skipped: 'throttled', expr })
  }
  await metaSet(ctx, `cron:last:${expr}`, now)

  if (!ctx.config.d1) {
    return json({ code: 200, skipped: 'no-d1', expr })
  }

  const run = (async () => {
    // Job A — refresh the oldest-parsed works (new stats snapshots).
    const stale = await staleQueries(ctx, REFRESH_BATCH)
    let refreshed = 0
    const errors = []
    for (const w of stale) {
      try {
        await ingestWork(ctx, request, w.platform, w.video_id, w.original_url, true, { warmVideo: false })
        await maybeFetchComments(ctx, w.platform, w.video_id)
        refreshed++
      } catch (e) {
        errors.push(`refresh ${w.video_id} ${e?.message || e}`)
      }
    }

    // Job B — grow the library from the popular feed.
    let grown = 0
    try {
      const pop = await bili.fetchComPopular(ctx, 1)
      const list = pop?.data?.list || []
      for (const v of list) {
        if (grown >= GROW_BATCH) break
        const bvid = v.bvid
        if (!bvid) continue
        try {
          await ingestWork(ctx, request, 'bilibili', bvid, `https://www.bilibili.com/video/${bvid}`, false, { warmVideo: false })
          grown++
        } catch (e) {
          errors.push(`grow ${bvid} ${e?.message || e}`)
        }
      }
    } catch (e) {
      errors.push(`popular ${e?.message || e}`)
    }

    await metaSet(ctx, `cron:stats:${expr}`, now)
    return { refreshed, attempted: stale.length, grown, errors: errors.slice(0, 5) }
  })()

  // Respond fast; let the batch finish in the background when possible.
  if (ctx.waitUntil) {
    ctx.waitUntil(run)
    return json({ code: 200, expr, started: true, refreshBatch: REFRESH_BATCH, growBatch: GROW_BATCH })
  }
  const result = await run
  return json({ code: 200, expr, ...result })
}

function json (obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
