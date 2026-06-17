// esbuild wrapper — bundle src/worker.js into dist/worker.js for
// RandallFlare / workerd.
//
// Two jobs:
//   1. Bundle our own modules into a single dist/worker.js (ESM).
//   2. Leave node:* built-ins (node:crypto) as external imports;
//      workerd's nodejs_compat resolves them at runtime. Any bare
//      `import x from "crypto"` is rewritten to `node:crypto` because
//      workerd only registers the node:*-prefixed module names.
//
// All crypto is pure-JS (src/lib: sm3 / md5 / sha1+hmac, RC4 hand-
// rolled), so the bundle has ZERO node:* imports — the worker boots
// on workerd without the nodejs_compat flag. The builtin alias/external
// lists below are kept only as a safety net for future deps.

import { build } from 'esbuild'

const NODE_BUILTINS = [
  'crypto', 'url', 'buffer', 'util', 'stream', 'fs', 'path', 'os',
  'process', 'events', 'http', 'https', 'net', 'tls', 'zlib',
  'querystring', 'assert', 'string_decoder', 'punycode'
]

const alias = Object.fromEntries(NODE_BUILTINS.map((n) => [n, `node:${n}`]))
const external = NODE_BUILTINS.map((n) => `node:${n}`)

await build({
  entryPoints: ['src/worker.js'],
  bundle: true,
  format: 'esm',
  target: 'esnext',
  platform: 'neutral',
  conditions: ['worker', 'browser', 'import', 'default'],
  alias,
  external,
  outfile: 'dist/worker.js',
  legalComments: 'none',
  logLevel: 'info'
})
