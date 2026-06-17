// D1 query log — records each hybrid/video_data parse so /admin can show
// recent queries and their content. All helpers no-op when no D1 binding
// is bound (ctx.config.d1 === null), so the rest of the app is unaffected.

let schemaReady = false

async function ensureSchema (db) {
  if (schemaReady) return
  await db.prepare(`CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    type TEXT,
    author TEXT,
    description TEXT,
    original_url TEXT,
    cover TEXT,
    play TEXT,
    duration INTEGER,
    extra TEXT,
    hits INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(platform, video_id)
  )`).run()
  // Add columns to pre-existing tables (SQLite has no ADD COLUMN IF NOT
  // EXISTS — ignore the "duplicate column" error).
  for (const col of ['duration INTEGER', 'extra TEXT']) {
    try { await db.prepare(`ALTER TABLE queries ADD COLUMN ${col}`).run() } catch {}
  }
  schemaReady = true
}

const COLS = 'platform, video_id, type, author, description, original_url, cover, play, duration, extra, hits, created_at, updated_at'
const parseRow = (r) => {
  if (r && typeof r.extra === 'string') { try { r.extra = JSON.parse(r.extra) } catch { r.extra = null } }
  return r
}

// Upsert a query row. Re-parsing the same id bumps hits + updated_at so
// the list shows it again at the top without duplicating. Best-effort:
// any error is swallowed (logging must never break a parse).
export async function logQuery (ctx, row) {
  const db = ctx.config.d1
  if (!db) return
  try {
    await ensureSchema(db)
    const now = Date.now()
    const extra = row.extra ? JSON.stringify(row.extra) : null
    await db.prepare(`INSERT INTO queries
      (platform, video_id, type, author, description, original_url, cover, play, duration, extra, hits, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(platform, video_id) DO UPDATE SET
        hits = hits + 1, updated_at = ?, type = ?, author = ?,
        description = ?, original_url = ?, cover = ?, play = ?, duration = ?, extra = ?`)
      .bind(
        row.platform, row.video_id, row.type, row.author, row.description,
        row.original_url, row.cover, row.play, row.duration ?? null, extra, now, now,
        now, row.type, row.author, row.description, row.original_url, row.cover, row.play, row.duration ?? null, extra
      )
      .run()
  } catch (e) {
    try { console.error('[d1] logQuery failed', e?.message || e) } catch {}
  }
}

// A page of queries + total count. `order` is a safe SQL ORDER BY
// clause. Returns { rows, total }; {rows:[],total:0} without D1.
async function pageQueries (ctx, order, limit, offset) {
  const db = ctx.config.d1
  if (!db) return { rows: [], total: 0 }
  try {
    await ensureSchema(db)
    const res = await db.prepare(`SELECT ${COLS} FROM queries ORDER BY ${order} LIMIT ? OFFSET ?`).bind(limit, offset).all()
    // .all() not .first() — the RandallFlare D1 shim's .first() returns null.
    const cnt = await db.prepare('SELECT COUNT(*) AS n FROM queries').all()
    return { rows: (res?.results || []).map(parseRow), total: cnt?.results?.[0]?.n || 0 }
  } catch (e) {
    try { console.error('[d1] pageQueries failed', e?.message || e) } catch {}
    return { rows: [], total: 0 }
  }
}

// Admin: most-recently-seen first.
export const recentQueries = (ctx, limit = 10, offset = 0) =>
  pageQueries(ctx, 'updated_at DESC', limit, offset)

// Public discover: sort by hits (热度) or recency.
export const discoverQueries = (ctx, sort = 'recent', limit = 12, offset = 0) =>
  pageQueries(ctx, sort === 'hot' ? 'hits DESC, updated_at DESC' : 'updated_at DESC', limit, offset)

// Per-IP fixed-window rate limit. Prefers KV (TTL-expiring counters),
// falls back to D1. Returns { allowed, count, limit, resetSec }. With
// neither store bound we can't enforce a limit, so guests are refused
// ({ allowed:false, reason:'no-store' }).
export async function rateLimitHit (ctx, ip, limit, windowSec) {
  if (ctx.config.kv) return rateLimitKV(ctx.config.kv, ip, limit, windowSec)
  if (ctx.config.d1) return rateLimitD1(ctx.config.d1, ip, limit, windowSec)
  return { allowed: false, reason: 'no-store' }
}

// KV counter. get→+1→put is not atomic (a burst can slip a few over the
// limit), which is fine for soft guest limiting. The window key expires
// via expirationTtl, so there's nothing to clean up.
async function rateLimitKV (kv, ip, limit, windowSec) {
  try {
    const nowSec = Math.floor(Date.now() / 1000)
    const bucket = Math.floor(nowSec / windowSec)
    const key = `rl:${ip}:${bucket}`
    let n = 0
    try { const v = await kv.get(key); if (v) n = parseInt(v, 10) || 0 } catch {}
    n += 1
    await kv.put(key, String(n), { expirationTtl: Math.max(60, windowSec) })
    return { allowed: n <= limit, count: n, limit, resetSec: (bucket + 1) * windowSec - nowSec }
  } catch (e) {
    try { console.error('[kv] rateLimitHit failed', e?.message || e) } catch {}
    return { allowed: false, reason: 'error' }
  }
}

// D1 counter (atomic n=n+1 upsert).
let rateSchemaReady = false
async function rateLimitD1 (db, ip, limit, windowSec) {
  try {
    if (!rateSchemaReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip, bucket))').run()
      rateSchemaReady = true
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const bucket = Math.floor(nowSec / windowSec)
    await db.prepare('INSERT INTO rate (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1')
      .bind(ip, bucket).run()
    // .all() not .first() — see note in recentQueries.
    const res = await db.prepare('SELECT n FROM rate WHERE ip = ? AND bucket = ?').bind(ip, bucket).all()
    const count = res?.results?.[0]?.n || 1
    return { allowed: count <= limit, count, limit, resetSec: (bucket + 1) * windowSec - nowSec }
  } catch (e) {
    try { console.error('[d1] rateLimitHit failed', e?.message || e) } catch {}
    return { allowed: false, reason: 'error' }
  }
}
