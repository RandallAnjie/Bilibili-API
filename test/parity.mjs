// Parity tests. wbi w_rid reference captured from the upstream Python
// (crawlers/bilibili/web/wrid.py) with wts pinned. Run: node test/parity.mjs
import { createHmac } from 'node:crypto'
import { md5HexOfBytes } from '../src/lib/md5.js'
import { sha1Hex, hmacSha1Hex } from '../src/lib/sha1.js'
import { wbiSign, bv2av } from '../src/bilibili/wbi.js'

let failed = 0
const enc = s => Array.from(Buffer.from(s, 'utf8'))
const check = (name, got, exp) => {
  const ok = got === exp
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`  got: ${got}\n  exp: ${exp}`)
}

check('md5("abc")', md5HexOfBytes(enc('abc')), '900150983cd24fb0d6963f7d28e17f72')
check('sha1("abc")', sha1Hex(enc('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d')
check('hmac-sha1 == node', hmacSha1Hex('secret123', 'biliX'),
  createHmac('sha1', 'secret123').update('biliX').digest('hex'))

// wbi w_rid for a fixed param set + wts=1700000000.
const signed = wbiSign({ bvid: 'BV1xx411c7XD', cid: '12345', qn: '80', fnval: '4048', fourk: '1', fnver: '0', otype: 'json', platform: 'pc' }, 1700000000)
check('wbi w_rid', signed.w_rid, '44e483a43cfc120e657669cf89eb9315')

// bv2av sanity (BV17x411w7KC is the classic av170001).
check('bv2av(BV17x411w7KC)', String(bv2av('BV17x411w7KC')), '170001')
check('bv2av(BV1xx411c7XD)', String(bv2av('BV1xx411c7XD')), '288')

console.log(failed === 0 ? '\nAll parity tests passed.' : `\n${failed} failed.`)
process.exit(failed === 0 ? 0 : 1)
