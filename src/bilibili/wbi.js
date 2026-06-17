// Bilibili wbi signing — port of crawlers/bilibili/web/{wrid.py,utils.py}.
//
// w_rid = md5( urlencode( sorted, char-filtered params with the mixin key
// appended to the wts value ) ). The upstream uses a HARD-CODED mixin key
// (it doesn't fetch nav/img_key), so no extra request is needed. (If
// Bilibili rotates it and signatures start failing, refresh this string
// or derive it from the nav API's wbi_img keys.)
import { md5HexOfBytes } from '../lib/md5.js'
import { quotePlus } from '../utils/params.js'

const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8'
const utf8 = (s) => Array.from(new TextEncoder().encode(s))
const filterChars = (v) => String(v).split('').filter(c => !"!'()*".includes(c)).join('')

// Given a params object (without wts/w_rid), return a new object with wts
// + w_rid added, ready to be query-joined. `now` overridable for tests.
export function wbiSign (params, now) {
  const wts = String(now ?? Math.floor(Date.now() / 1000))
  // Signing string: sort keys, append mixin key to wts value, filter
  // forbidden chars from values, urlencode (quote_plus).
  const signObj = { ...params, wts: wts + MIXIN_KEY }
  const sorted = {}
  for (const k of Object.keys(signObj).sort()) sorted[k] = filterChars(signObj[k])
  const query = Object.entries(sorted).map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join('&')
  const wRid = md5HexOfBytes(utf8(query))
  return { ...params, wts, w_rid: wRid }
}

// Build a wbi-signed query string (raw "k=v&k=v" join, as upstream does).
export function wbiQuery (params, now) {
  const p = wbiSign(params, now)
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join('&')
}

// BV id -> AV (aid) number. Port of bv2av; BigInt so large modern aids
// don't overflow JS's 32-bit bitwise ops.
const TABLE = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF'
const S = [11, 10, 3, 8, 4, 6, 2, 9, 5, 7]
const XOR = 177451812n
const ADD_105 = 8728348608n
const ADD_ALL = 8728348608n - (2n ** 31n - 1n) - 1n
export function bv2av (bvId) {
  const tr = {}
  for (let i = 0; i < 58; i++) tr[TABLE[i]] = BigInt(i)
  let r = 0n
  for (let i = 0; i < 6; i++) r += tr[bvId[S[i]]] * (58n ** BigInt(i))
  const add = r < ADD_105 ? ADD_ALL : ADD_105
  return Number((r - add) ^ XOR)
}
