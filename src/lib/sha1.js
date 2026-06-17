// Pure-JS SHA-1 + HMAC-SHA1 (no node:crypto). Validated against:
//   sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
//   HMAC-SHA1(key="key", "The quick brown fox jumps over the lazy dog")
//     = de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9

const rol = (n, c) => ((n << c) | (n >>> (32 - c))) >>> 0

// SHA-1 of a byte-int array -> 20-byte array.
export function sha1Bytes (input) {
  const bytes = Array.from(input, (b) => b & 0xFF)
  const ml = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  // 64-bit big-endian length.
  const hi = Math.floor(ml / 0x100000000)
  const lo = ml >>> 0
  for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 0xFF)
  for (let i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 0xFF)

  let h0 = 0x67452301; let h1 = 0xEFCDAB89; let h2 = 0x98BADCFE
  let h3 = 0x10325476; let h4 = 0xC3D2E1F0

  const w = new Array(80)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const t = (rol(a, 5) + f + e + k + w[i]) >>> 0
      e = d; d = c; c = rol(b, 30); b = a; a = t
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }

  const out = []
  for (const h of [h0, h1, h2, h3, h4]) {
    out.push((h >>> 24) & 0xFF, (h >>> 16) & 0xFF, (h >>> 8) & 0xFF, h & 0xFF)
  }
  return out
}

const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')

export const sha1Hex = (input) => toHex(sha1Bytes(input))

// HMAC-SHA1(secret, message) -> hex. secret/message are strings (utf-8).
export function hmacSha1Hex (secret, message) {
  const enc = new TextEncoder()
  let key = Array.from(enc.encode(secret))
  if (key.length > 64) key = sha1Bytes(key)
  while (key.length < 64) key.push(0)
  const ipad = key.map((b) => b ^ 0x36)
  const opad = key.map((b) => b ^ 0x5c)
  const msg = Array.from(enc.encode(message))
  const inner = sha1Bytes(ipad.concat(msg))
  return toHex(sha1Bytes(opad.concat(inner)))
}
