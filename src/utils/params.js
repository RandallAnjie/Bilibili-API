// Query-string helpers (Python urllib.parse.urlencode / quote_plus
// compatible). Used by the wbi signer and the crawler.

// Python quote_plus: safe = A-Za-z0-9 and _.-~ ; space -> '+';
// everything else -> %XX over utf-8 bytes (uppercase hex).
const SAFE = /[A-Za-z0-9_.\-~]/
export function quotePlus (value) {
  const s = String(value)
  let out = ''
  for (const ch of s) {
    if (SAFE.test(ch)) out += ch
    else if (ch === ' ') out += '+'
    else {
      for (const b of new TextEncoder().encode(ch)) {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
      }
    }
  }
  return out
}

export function urlencode (obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`)
    .join('&')
}

export function rawJoin (obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}
