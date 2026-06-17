// D1 data layer — the aggregation store behind the platform: parsed
// works (queries), authors, stats time-series, comments, and small
// key/value meta (cron throttle, comment fetch timestamps). All helpers
// no-op / return empty when no D1 binding is bound.

let schemaReady = false

async function ensureSchema (db) {
  if (schemaReady) return
  await db.prepare(`CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    type TEXT,
    author TEXT,
    author_id TEXT,
    description TEXT,
    original_url TEXT,
    cover TEXT,
    play TEXT,
    duration INTEGER,
    create_time INTEGER,
    tags TEXT,
    music TEXT,
    parts TEXT,
    extra TEXT,
    hits INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(platform, video_id)
  )`).run()
  // Add columns to pre-existing tables (SQLite has no ADD COLUMN IF NOT
  // EXISTS — ignore the "duplicate column" error).
  for (const col of ['duration INTEGER', 'extra TEXT', 'create_time INTEGER', 'author_id TEXT', 'tags TEXT', 'music TEXT', 'parts TEXT']) {
    try { await db.prepare(`ALTER TABLE queries ADD COLUMN ${col}`).run() } catch {}
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS authors (
    platform TEXT NOT NULL, author_id TEXT NOT NULL, name TEXT, avatar TEXT,
    extra TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(platform, author_id)
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
    video_id TEXT NOT NULL, ts INTEGER NOT NULL, stats TEXT
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS author_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
    author_id TEXT NOT NULL, ts INTEGER NOT NULL, follower INTEGER, extra TEXT
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
    video_id TEXT NOT NULL, comment_id TEXT NOT NULL, parent_id TEXT,
    author TEXT, author_id TEXT, avatar TEXT, text TEXT, likes INTEGER,
    ctime INTEGER, fetched_at INTEGER NOT NULL, UNIQUE(platform, video_id, comment_id)
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS kv_meta (
    k TEXT PRIMARY KEY, v TEXT, ts INTEGER NOT NULL
  )`).run()
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_stats_vid ON stats_history (platform, video_id, ts)',
    'CREATE INDEX IF NOT EXISTS idx_astats ON author_stats_history (platform, author_id, ts)',
    'CREATE INDEX IF NOT EXISTS idx_cmt ON comments (platform, video_id, likes)'
  ]) { try { await db.prepare(sql).run() } catch {} }
  schemaReady = true
}

const COLS = 'platform, video_id, type, author, author_id, description, original_url, cover, play, duration, create_time, tags, music, parts, extra, hits, created_at, updated_at'
const JSON_COLS = ['extra', 'tags', 'music', 'parts']
const parseRow = (r) => {
  if (!r) return r
  for (const c of JSON_COLS) {
    if (typeof r[c] === 'string') { try { r[c] = JSON.parse(r[c]) } catch { r[c] = null } }
  }
  return r
}
const j = (v) => (v == null ? null : JSON.stringify(v))

// --- kv_meta (cron throttle, comment fetch timestamps) ---
export async function metaGet (ctx, k) {
  const db = ctx.config.d1; if (!db) return null
  try { await ensureSchema(db); const r = await db.prepare('SELECT v, ts FROM kv_meta WHERE k = ?').bind(k).all(); return r?.results?.[0] || null } catch { return null }
}
export async function metaSet (ctx, k, v) {
  const db = ctx.config.d1; if (!db) return
  try { await ensureSchema(db); await db.prepare('INSERT INTO kv_meta (k, v, ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = ?, ts = ?').bind(k, String(v ?? ''), Date.now(), String(v ?? ''), Date.now()).run() } catch {}
}

// Upsert a parsed work + its author + a stats snapshot.
export async function logQuery (ctx, row) {
  const db = ctx.config.d1
  if (!db) return
  try {
    await ensureSchema(db)
    const now = Date.now()
    const extra = j(row.extra); const tags = j(row.tags); const music = j(row.music); const parts = j(row.parts)
    const authorId = row.authorInfo?.id || null
    await db.prepare(`INSERT INTO queries
      (platform, video_id, type, author, author_id, description, original_url, cover, play, duration, create_time, tags, music, parts, extra, hits, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(platform, video_id) DO UPDATE SET
        hits = hits + 1, updated_at = ?, type = ?, author = ?, author_id = ?,
        description = ?, original_url = ?, cover = ?, play = ?, duration = ?, create_time = ?, tags = ?, music = ?, parts = ?, extra = ?`)
      .bind(
        row.platform, row.video_id, row.type, row.author, authorId, row.description,
        row.original_url, row.cover, row.play, row.duration ?? null, row.create_time ?? null, tags, music, parts, extra, now, now,
        now, row.type, row.author, authorId, row.description, row.original_url, row.cover, row.play, row.duration ?? null, row.create_time ?? null, tags, music, parts, extra
      )
      .run()

    if (authorId) {
      const a = row.authorInfo
      const aExtra = j(a.extra)
      await db.prepare(`INSERT INTO authors (platform, author_id, name, avatar, extra, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, author_id) DO UPDATE SET name = ?, avatar = ?, extra = ?, updated_at = ?`)
        .bind(row.platform, authorId, a.name ?? null, a.avatar ?? null, aExtra, now, a.name ?? null, a.avatar ?? null, aExtra, now)
        .run()
      // Follower snapshot — record when changed or >6h since last.
      const follower = a.extra?.follower
      if (follower != null) {
        const last = await db.prepare('SELECT ts, follower FROM author_stats_history WHERE platform = ? AND author_id = ? ORDER BY ts DESC LIMIT 1').bind(row.platform, authorId).all()
        const p = last?.results?.[0]
        if (!p || p.follower !== follower || (now - p.ts) > 21600000) {
          await db.prepare('INSERT INTO author_stats_history (platform, author_id, ts, follower) VALUES (?, ?, ?, ?)').bind(row.platform, authorId, now, follower).run()
        }
      }
    }

    if (row.stats && Object.keys(row.stats).length) {
      const statsStr = JSON.stringify(row.stats)
      const last = await db.prepare('SELECT ts, stats FROM stats_history WHERE platform = ? AND video_id = ? ORDER BY ts DESC LIMIT 1').bind(row.platform, row.video_id).all()
      const prev = last?.results?.[0]
      const fresh = prev && (now - prev.ts) < 300000 && prev.stats === statsStr
      if (!fresh) {
        await db.prepare('INSERT INTO stats_history (platform, video_id, ts, stats) VALUES (?, ?, ?, ?)').bind(row.platform, row.video_id, now, statsStr).run()
      }
    }
  } catch (e) {
    try { console.error('[d1] logQuery failed', e?.message || e) } catch {}
  }
}

// --- reads ---
async function pageQueries (ctx, where, binds, order, limit, offset) {
  const db = ctx.config.d1
  if (!db) return { rows: [], total: 0 }
  try {
    await ensureSchema(db)
    const res = await db.prepare(`SELECT ${COLS} FROM queries ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all()
    const cnt = await db.prepare(`SELECT COUNT(*) AS n FROM queries ${where}`).bind(...binds).all()
    return { rows: (res?.results || []).map(parseRow), total: cnt?.results?.[0]?.n || 0 }
  } catch (e) {
    try { console.error('[d1] pageQueries failed', e?.message || e) } catch {}
    return { rows: [], total: 0 }
  }
}

export const recentQueries = (ctx, limit = 10, offset = 0) =>
  pageQueries(ctx, '', [], 'updated_at DESC', limit, offset)

export const discoverQueries = (ctx, sort = 'recent', limit = 12, offset = 0) =>
  pageQueries(ctx, '', [], sort === 'hot' ? 'hits DESC, updated_at DESC' : 'updated_at DESC', limit, offset)

// In-site search over title / author / tags (LIKE; FTS5 is a future
// upgrade if volume grows). platform optional filter.
export function searchQueries (ctx, q, platform, limit = 12, offset = 0) {
  const like = `%${String(q || '').trim()}%`
  if (platform) return pageQueries(ctx, 'WHERE platform = ? AND (description LIKE ? OR author LIKE ? OR tags LIKE ?)', [platform, like, like, like], 'hits DESC, updated_at DESC', limit, offset)
  return pageQueries(ctx, 'WHERE description LIKE ? OR author LIKE ? OR tags LIKE ?', [like, like, like], 'hits DESC, updated_at DESC', limit, offset)
}

// The oldest-refreshed works (for the cron stats-refresh job).
export async function staleQueries (ctx, limit = 15) {
  const db = ctx.config.d1
  if (!db) return []
  try {
    await ensureSchema(db)
    const r = await db.prepare(`SELECT platform, video_id, original_url FROM queries ORDER BY updated_at ASC LIMIT ?`).bind(limit).all()
    return r?.results || []
  } catch { return [] }
}

export async function getWork (ctx, platform, videoId) {
  const db = ctx.config.d1
  if (!db) return null
  try {
    await ensureSchema(db)
    const q = await db.prepare(`SELECT ${COLS} FROM queries WHERE platform = ? AND video_id = ?`).bind(platform, videoId).all()
    const row = parseRow(q?.results?.[0])
    if (!row) return null
    let author = null
    if (row.author_id) {
      const a = await db.prepare('SELECT platform, author_id, name, avatar, extra, updated_at FROM authors WHERE platform = ? AND author_id = ?').bind(platform, row.author_id).all()
      author = parseRow(a?.results?.[0]) || null
    }
    const h = await db.prepare('SELECT ts, stats FROM stats_history WHERE platform = ? AND video_id = ? ORDER BY ts ASC LIMIT 500').bind(platform, videoId).all()
    const history = (h?.results || []).map(r => { let s = {}; try { s = JSON.parse(r.stats) } catch {} return { ts: r.ts, stats: s } })
    return { work: row, author, history }
  } catch (e) {
    try { console.error('[d1] getWork failed', e?.message || e) } catch {}
    return null
  }
}

export async function getAuthor (ctx, platform, authorId, limit = 24, offset = 0) {
  const db = ctx.config.d1
  if (!db) return null
  try {
    await ensureSchema(db)
    const a = await db.prepare('SELECT platform, author_id, name, avatar, extra, updated_at FROM authors WHERE platform = ? AND author_id = ?').bind(platform, authorId).all()
    const author = parseRow(a?.results?.[0])
    if (!author) return null
    const works = await pageQueries(ctx, 'WHERE platform = ? AND author_id = ?', [platform, authorId], 'create_time DESC, updated_at DESC', limit, offset)
    const fh = await db.prepare('SELECT ts, follower FROM author_stats_history WHERE platform = ? AND author_id = ? ORDER BY ts ASC LIMIT 500').bind(platform, authorId).all()
    return { author, works: works.rows, total: works.total, follower_history: fh?.results || [] }
  } catch (e) {
    try { console.error('[d1] getAuthor failed', e?.message || e) } catch {}
    return null
  }
}

// --- comments ---
export async function storeComments (ctx, platform, videoId, comments) {
  const db = ctx.config.d1
  if (!db || !comments?.length) return 0
  try {
    await ensureSchema(db)
    const now = Date.now()
    let n = 0
    for (const c of comments) {
      if (!c.comment_id) continue
      try {
        await db.prepare(`INSERT INTO comments (platform, video_id, comment_id, parent_id, author, author_id, avatar, text, likes, ctime, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform, video_id, comment_id) DO UPDATE SET likes = ?, text = ?, fetched_at = ?`)
          .bind(platform, videoId, String(c.comment_id), c.parent_id ?? null, c.author ?? null, c.author_id ?? null, c.avatar ?? null, c.text ?? null, c.likes ?? 0, c.ctime ?? null, now, c.likes ?? 0, c.text ?? null, now)
          .run()
        n++
      } catch {}
    }
    await metaSet(ctx, `cmt:${platform}:${videoId}`, now)
    return n
  } catch (e) {
    try { console.error('[d1] storeComments failed', e?.message || e) } catch {}
    return 0
  }
}

export async function getComments (ctx, platform, videoId, limit = 20, offset = 0) {
  const db = ctx.config.d1
  if (!db) return { rows: [], total: 0 }
  try {
    await ensureSchema(db)
    const r = await db.prepare('SELECT comment_id, parent_id, author, author_id, avatar, text, likes, ctime FROM comments WHERE platform = ? AND video_id = ? ORDER BY likes DESC, ctime DESC LIMIT ? OFFSET ?').bind(platform, videoId, limit, offset).all()
    const cnt = await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE platform = ? AND video_id = ?').bind(platform, videoId).all()
    return { rows: r?.results || [], total: cnt?.results?.[0]?.n || 0 }
  } catch (e) {
    try { console.error('[d1] getComments failed', e?.message || e) } catch {}
    return { rows: [], total: 0 }
  }
}

// --- rate limit (prefers KV, falls back to D1) ---
export async function rateLimitHit (ctx, ip, limit, windowSec) {
  if (ctx.config.kv) return rateLimitKV(ctx.config.kv, ip, limit, windowSec)
  if (ctx.config.d1) return rateLimitD1(ctx.config.d1, ip, limit, windowSec)
  return { allowed: false, reason: 'no-store' }
}

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

let rateSchemaReady = false
async function rateLimitD1 (db, ip, limit, windowSec) {
  try {
    if (!rateSchemaReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip, bucket))').run()
      rateSchemaReady = true
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const bucket = Math.floor(nowSec / windowSec)
    await db.prepare('INSERT INTO rate (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1').bind(ip, bucket).run()
    const res = await db.prepare('SELECT n FROM rate WHERE ip = ? AND bucket = ?').bind(ip, bucket).all()
    const count = res?.results?.[0]?.n || 1
    return { allowed: count <= limit, count, limit, resetSec: (bucket + 1) * windowSec - nowSec }
  } catch (e) {
    try { console.error('[d1] rateLimitHit failed', e?.message || e) } catch {}
    return { allowed: false, reason: 'error' }
  }
}
