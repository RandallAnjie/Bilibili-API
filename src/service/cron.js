// Internal cron entrypoint: POST /__edge_cron (RandallFlare convention —
// the edge agent calls this on the operator's schedule with an
// X-Edge-Cron-Expression header and NO token). Must respond 2xx.
//
// Job: pull Bilibili's hot ranking (popular feed) and ingest + DOWNLOAD
// (cache media into R2) the top videos — growing the in-site library from
// what's trending. It does NOT refresh already-stored works.
//
// Safe by being throttled + bounded + idempotent: every action is a
// public-video parse we'd serve anyway.
import { metaGet, metaSet } from '../utils/db.js'
import { ingestWork } from '../utils/ingest.js'
import * as bili from '../bilibili/crawler.js'

const THROTTLE_MS = 50 * 1000
const HOT_BATCH = 30

export async function cronService (request, ctx) {
  const expr = request.headers.get('x-edge-cron-expression') || 'default'
  const last = await metaGet(ctx, `cron:last:${expr}`)
  const now = Date.now()
  if (last && (now - last.ts) < THROTTLE_MS) {
    return json({ code: 200, skipped: 'throttled', expr })
  }
  await metaSet(ctx, `cron:last:${expr}`, now)
  if (!ctx.config.d1) return json({ code: 200, skipped: 'no-d1', expr })

  const run = (async () => {
    let grown = 0
    const errors = []
    try {
      // popular returns ~20/page — walk pages until we reach HOT_BATCH.
      for (let pn = 1; pn <= 5 && grown < HOT_BATCH; pn++) {
        const pop = await bili.fetchComPopular(ctx, pn)
        const list = pop?.data?.list || []
        if (!list.length) break
        for (const v of list) {
          if (grown >= HOT_BATCH) break
          const bvid = v.bvid
          if (!bvid) continue
          try {
            // warmVideo defaults true → parse + download media into R2.
            await ingestWork(ctx, request, 'bilibili', bvid, `https://www.bilibili.com/video/${bvid}`, false)
            grown++
          } catch (e) { errors.push(`${bvid} ${e?.message || e}`) }
        }
      }
    } catch (e) { errors.push(`popular ${e?.message || e}`) }
    await metaSet(ctx, `cron:hot:${expr}`, now)
    return { grown, errors: errors.slice(0, 5) }
  })()

  if (ctx.waitUntil) {
    ctx.waitUntil(run)
    return json({ code: 200, expr, started: true, hotBatch: HOT_BATCH })
  }
  return json({ code: 200, expr, ...(await run) })
}

function json (obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
