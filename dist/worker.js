// src/middleware/logger.js
var LEVEL_PRIORITY = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
var DEFAULT_LEVEL = "info";
function makeLogger(bindings = {}, minLevel = DEFAULT_LEVEL) {
  const threshold = LEVEL_PRIORITY[minLevel] ?? LEVEL_PRIORITY.info;
  function emit(level, payload, message) {
    const prio = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
    if (prio < threshold) return;
    const obj = typeof payload === "object" && payload !== null ? payload : {};
    const msg = typeof payload === "string" ? payload : message || "";
    const out = {
      time: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      ...bindings,
      ...obj,
      msg
    };
    try {
      console.log(JSON.stringify(out));
    } catch {
      console.log(`[${level}] ${msg}`);
    }
  }
  return {
    trace: (p, m) => emit("trace", p, m),
    debug: (p, m) => emit("debug", p, m),
    info: (p, m) => emit("info", p, m),
    warn: (p, m) => emit("warn", p, m),
    error: (p, m) => emit("error", p, m),
    fatal: (p, m) => emit("fatal", p, m),
    child: (extra) => makeLogger({ ...bindings, ...extra }, minLevel)
  };
}
var logger = makeLogger();
var generateRequestId = () => Math.random().toString(36).slice(2, 9);
var withRequestLogger = (handler2) => {
  return async (request, ctx = {}) => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const url = new URL(request.url);
    const reqInfo = {
      method: request.method,
      url: url.pathname,
      headers: Object.fromEntries(request.headers)
    };
    const requestScopedLogger = makeLogger(
      { req: reqInfo },
      ctx.config?.log?.level || DEFAULT_LEVEL
    );
    ctx.logger = requestScopedLogger;
    ctx.requestId = requestId;
    ctx.responseHeaders = new Headers();
    ctx.error = null;
    let response = await handler2(request, ctx);
    const mergedHeaders = new Headers(response.headers);
    for (const [key, value] of ctx.responseHeaders) {
      mergedHeaders.set(key, value);
    }
    mergedHeaders.set("x-request-id", requestId);
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders
    });
    const responseTime = Date.now() - startTime;
    const responseHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }
    const bindings = {
      reqId: requestId,
      res: { status: response.status, headers: responseHeaders },
      responseTime
    };
    const level = ctx.error ? "error" : "info";
    const message = ctx.error?.message || "Request completed";
    requestScopedLogger[level](bindings, message);
    return response;
  };
};

// src/middleware/errors.js
function withErrorHandler(handler2) {
  return async (request, ctx) => {
    try {
      return await handler2(request, ctx);
    } catch (err) {
      const status = err?.status || 500;
      const requestLogger = ctx?.logger ?? logger;
      const url = new URL(request.url);
      const debugMode = ctx?.config?.log?.level === "debug" || ctx?.config?.log?.level === "trace" || ctx?.env?.DEBUG_ERRORS === "1" || ctx?.env?.DEBUG_ERRORS === "true";
      const logPayload = {
        error: {
          message: err?.message,
          stack: err?.stack,
          name: err?.name,
          status
        },
        request: {
          method: request.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          userAgent: request.headers.get("user-agent"),
          ip: request.headers.get("cf-connecting-ip") || request.headers.get("rf-connecting-ip") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
        }
      };
      if (ctx?.requestId) {
        logPayload.request.requestId = ctx.requestId;
      }
      requestLogger.error(logPayload, "Request error occurred");
      try {
        console.error("[errors] " + (err?.name || "Error") + ": " + (err?.message || "(no message)"));
        if (err?.stack) console.error(err.stack);
      } catch {
      }
      if (ctx?.responseHeaders) {
        ctx.responseHeaders.set("x-error-message", encodeURIComponent(err?.message || ""));
        ctx.error = err;
      }
      const body = {
        code: status,
        message: err?.message || "(no message)",
        path: url.pathname
      };
      if (debugMode && err?.stack) body.stack = err.stack;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
  };
}

// src/utils/http-exception.js
var HTTPException = class extends Error {
  constructor(status, options = {}) {
    super(options.message || "Unknown Error");
    this.status = status;
    this.name = "HTTPException";
  }
};

// src/utils/respond.js
function jsonResponse(data, { status = 200, headers = {}, router: router2 = "", params = {} } = {}) {
  const body = {
    code: status,
    router: router2,
    params,
    data
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
function rawJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

// src/lib/sha1.js
var rol = (n, c) => (n << c | n >>> 32 - c) >>> 0;
function sha1Bytes(input) {
  const bytes = Array.from(input, (b) => b & 255);
  const ml = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(ml / 4294967296);
  const lo = ml >>> 0;
  for (let i = 3; i >= 0; i--) bytes.push(hi >>> i * 8 & 255);
  for (let i = 3; i >= 0; i--) bytes.push(lo >>> i * 8 & 255);
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h2 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const w = new Array(80);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const t = rol(a, 5) + f + e + k + w[i] >>> 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  const out = [];
  for (const h of [h0, h1, h2, h3, h4]) {
    out.push(h >>> 24 & 255, h >>> 16 & 255, h >>> 8 & 255, h & 255);
  }
  return out;
}
var toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
function hmacSha1Hex(secret, message) {
  const enc = new TextEncoder();
  let key = Array.from(enc.encode(secret));
  if (key.length > 64) key = sha1Bytes(key);
  while (key.length < 64) key.push(0);
  const ipad = key.map((b) => b ^ 54);
  const opad = key.map((b) => b ^ 92);
  const msg = Array.from(enc.encode(message));
  const inner = sha1Bytes(ipad.concat(msg));
  return toHex(sha1Bytes(opad.concat(inner)));
}

// src/utils/auth.js
var sign = (message, secret) => hmacSha1Hex(secret, message);
var canonical = (platform, route, primaryId = "") => `${platform}${route}${primaryId}`;
var getClientIp = (request) => request.headers.get("cf-connecting-ip") || request.headers.get("rf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
function isAuthorised(request, ctx, platform, route, primaryId = "") {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || "";
  const queryAuth = url.searchParams.get("auth") || "";
  const secret = ctx.config.auth.token;
  if (queryToken && queryToken === secret) return true;
  if (queryAuth && queryAuth === sign(canonical(platform, route, primaryId), secret)) return true;
  return false;
}
function requireProxyAuth(request, ctx, platform, id) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const authp = url.searchParams.get("auth") || "";
  const exp = url.searchParams.get("exp") || "";
  const secret = ctx.config.auth.token;
  if (token && token === secret) return;
  if (authp) {
    if (exp) {
      const expected = sign(`${canonical("proxy", platform, id)}${exp}`, secret);
      if (authp === expected) {
        if (Date.now() <= Number(exp) * 1e3) return;
        throw new HTTPException(403, { message: "\u94FE\u63A5\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u89E3\u6790 / link expired" });
      }
    } else if (authp === sign(canonical("proxy", platform, id), secret)) {
      return;
    }
  }
  throw new HTTPException(401, { message: "proxy: bad or expired auth" });
}
function requireAuth(request, ctx, platform, route, primaryId = "") {
  if (isAuthorised(request, ctx, platform, route, primaryId)) return;
  const url = new URL(request.url);
  const sent = url.searchParams.get("auth") || url.searchParams.get("token") || "(none)";
  throw new HTTPException(401, {
    message: `Unauthorized: bad token/auth for ${platform}/${route}. Pass ?token=<secret> or ?auth=HMAC-SHA1(secret,"${canonical(platform, route, primaryId)}"). Received: ${sent.slice(0, 12)}\u2026`
  });
}

// src/utils/base-crawler.js
function buildHeaders({ userAgent, referer, cookie, extra = {} }) {
  const h = {
    "User-Agent": userAgent,
    "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
    ...extra
  };
  if (referer) h.Referer = referer;
  if (cookie) h.Cookie = cookie;
  return h;
}
async function parseJson(resp, url) {
  const text = await resp.text();
  if (!resp.ok) {
    throw new HTTPException(resp.status === 404 ? 404 : 502, {
      message: `Upstream ${resp.status} for ${url}: ${text.slice(0, 200)}`
    });
  }
  if (!text) {
    throw new HTTPException(502, {
      message: `Upstream returned an empty body for ${url} \u2014 usually a bad/expired cookie or blocked signature.`
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HTTPException(502, {
      message: `Upstream returned non-JSON for ${url}: ${text.slice(0, 200)}`
    });
  }
}
async function fetchGetJson(url, headers) {
  const resp = await fetch(url, { method: "GET", headers, redirect: "follow" });
  return parseJson(resp, url);
}

// src/lib/md5.js
var add32 = (a, b) => a + b & 4294967295;
var rol2 = (n, c) => n << c | n >>> 32 - c;
function cmn(q2, a, b, x, s, t) {
  a = add32(add32(a, q2), add32(x, t));
  return add32(rol2(a, s), b);
}
var ff = (a, b, c, d, x, s, t) => cmn(b & c | ~b & d, a, b, x, s, t);
var gg = (a, b, c, d, x, s, t) => cmn(b & d | c & ~d, a, b, x, s, t);
var hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
var ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
function cycle(state, blk) {
  let [a, b, c, d] = state;
  a = ff(a, b, c, d, blk[0], 7, -680876936);
  d = ff(d, a, b, c, blk[1], 12, -389564586);
  c = ff(c, d, a, b, blk[2], 17, 606105819);
  b = ff(b, c, d, a, blk[3], 22, -1044525330);
  a = ff(a, b, c, d, blk[4], 7, -176418897);
  d = ff(d, a, b, c, blk[5], 12, 1200080426);
  c = ff(c, d, a, b, blk[6], 17, -1473231341);
  b = ff(b, c, d, a, blk[7], 22, -45705983);
  a = ff(a, b, c, d, blk[8], 7, 1770035416);
  d = ff(d, a, b, c, blk[9], 12, -1958414417);
  c = ff(c, d, a, b, blk[10], 17, -42063);
  b = ff(b, c, d, a, blk[11], 22, -1990404162);
  a = ff(a, b, c, d, blk[12], 7, 1804603682);
  d = ff(d, a, b, c, blk[13], 12, -40341101);
  c = ff(c, d, a, b, blk[14], 17, -1502002290);
  b = ff(b, c, d, a, blk[15], 22, 1236535329);
  a = gg(a, b, c, d, blk[1], 5, -165796510);
  d = gg(d, a, b, c, blk[6], 9, -1069501632);
  c = gg(c, d, a, b, blk[11], 14, 643717713);
  b = gg(b, c, d, a, blk[0], 20, -373897302);
  a = gg(a, b, c, d, blk[5], 5, -701558691);
  d = gg(d, a, b, c, blk[10], 9, 38016083);
  c = gg(c, d, a, b, blk[15], 14, -660478335);
  b = gg(b, c, d, a, blk[4], 20, -405537848);
  a = gg(a, b, c, d, blk[9], 5, 568446438);
  d = gg(d, a, b, c, blk[14], 9, -1019803690);
  c = gg(c, d, a, b, blk[3], 14, -187363961);
  b = gg(b, c, d, a, blk[8], 20, 1163531501);
  a = gg(a, b, c, d, blk[13], 5, -1444681467);
  d = gg(d, a, b, c, blk[2], 9, -51403784);
  c = gg(c, d, a, b, blk[7], 14, 1735328473);
  b = gg(b, c, d, a, blk[12], 20, -1926607734);
  a = hh(a, b, c, d, blk[5], 4, -378558);
  d = hh(d, a, b, c, blk[8], 11, -2022574463);
  c = hh(c, d, a, b, blk[11], 16, 1839030562);
  b = hh(b, c, d, a, blk[14], 23, -35309556);
  a = hh(a, b, c, d, blk[1], 4, -1530992060);
  d = hh(d, a, b, c, blk[4], 11, 1272893353);
  c = hh(c, d, a, b, blk[7], 16, -155497632);
  b = hh(b, c, d, a, blk[10], 23, -1094730640);
  a = hh(a, b, c, d, blk[13], 4, 681279174);
  d = hh(d, a, b, c, blk[0], 11, -358537222);
  c = hh(c, d, a, b, blk[3], 16, -722521979);
  b = hh(b, c, d, a, blk[6], 23, 76029189);
  a = hh(a, b, c, d, blk[9], 4, -640364487);
  d = hh(d, a, b, c, blk[12], 11, -421815835);
  c = hh(c, d, a, b, blk[15], 16, 530742520);
  b = hh(b, c, d, a, blk[2], 23, -995338651);
  a = ii(a, b, c, d, blk[0], 6, -198630844);
  d = ii(d, a, b, c, blk[7], 10, 1126891415);
  c = ii(c, d, a, b, blk[14], 15, -1416354905);
  b = ii(b, c, d, a, blk[5], 21, -57434055);
  a = ii(a, b, c, d, blk[12], 6, 1700485571);
  d = ii(d, a, b, c, blk[3], 10, -1894986606);
  c = ii(c, d, a, b, blk[10], 15, -1051523);
  b = ii(b, c, d, a, blk[1], 21, -2054922799);
  a = ii(a, b, c, d, blk[8], 6, 1873313359);
  d = ii(d, a, b, c, blk[15], 10, -30611744);
  c = ii(c, d, a, b, blk[6], 15, -1560198380);
  b = ii(b, c, d, a, blk[13], 21, 1309151649);
  a = ii(a, b, c, d, blk[4], 6, -145523070);
  d = ii(d, a, b, c, blk[11], 10, -1120210379);
  c = ii(c, d, a, b, blk[2], 15, 718787259);
  b = ii(b, c, d, a, blk[9], 21, -343485551);
  state[0] = add32(a, state[0]);
  state[1] = add32(b, state[1]);
  state[2] = add32(c, state[2]);
  state[3] = add32(d, state[3]);
}
function bytesToWords(bytes, start) {
  const w = new Array(16);
  for (let i = 0; i < 16; i++) {
    const j = start + i * 4;
    w[i] = bytes[j] | bytes[j + 1] << 8 | bytes[j + 2] << 16 | bytes[j + 3] << 24;
  }
  return w;
}
var toHexLE = (n) => {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += (n >>> i * 8 & 255).toString(16).padStart(2, "0");
  }
  return s;
};
function md5HexOfBytes(input) {
  const bytes = Array.from(input, (b) => b & 255);
  const len = bytes.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 0; i + 64 <= len; i += 64) {
    cycle(state, bytesToWords(bytes, i));
  }
  const tail = bytes.slice(i);
  tail.push(128);
  if (tail.length > 56) {
    while (tail.length < 64) tail.push(0);
    cycle(state, bytesToWords(tail, 0));
    tail.length = 0;
  }
  while (tail.length < 56) tail.push(0);
  const bitLen = len * 8;
  for (let k = 0; k < 4; k++) tail.push(bitLen >>> k * 8 & 255);
  const high = Math.floor(len / 536870912);
  for (let k = 0; k < 4; k++) tail.push(high >>> k * 8 & 255);
  cycle(state, bytesToWords(tail, 0));
  return toHexLE(state[0]) + toHexLE(state[1]) + toHexLE(state[2]) + toHexLE(state[3]);
}

// src/utils/params.js
var SAFE = /[A-Za-z0-9_.\-~]/;
function quotePlus(value) {
  const s = String(value);
  let out = "";
  for (const ch of s) {
    if (SAFE.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else {
      for (const b of new TextEncoder().encode(ch)) {
        out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

// src/bilibili/wbi.js
var MIXIN_KEY = "ea1db124af3c7062474693fa704f4ff8";
var utf8 = (s) => Array.from(new TextEncoder().encode(s));
var filterChars = (v) => String(v).split("").filter((c) => !"!'()*".includes(c)).join("");
function wbiSign(params, now) {
  const wts = String(now ?? Math.floor(Date.now() / 1e3));
  const signObj = { ...params, wts: wts + MIXIN_KEY };
  const sorted = {};
  for (const k of Object.keys(signObj).sort()) sorted[k] = filterChars(signObj[k]);
  const query = Object.entries(sorted).map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join("&");
  const wRid = md5HexOfBytes(utf8(query));
  return { ...params, wts, w_rid: wRid };
}
function wbiQuery(params, now) {
  const p = wbiSign(params, now);
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join("&");
}
var TABLE = "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF";
var S = [11, 10, 3, 8, 4, 6, 2, 9, 5, 7];
var XOR = 177451812n;
var ADD_105 = 8728348608n;
var ADD_ALL = 8728348608n - (2n ** 31n - 1n) - 1n;
function bv2av(bvId) {
  const tr = {};
  for (let i = 0; i < 58; i++) tr[TABLE[i]] = BigInt(i);
  let r = 0n;
  for (let i = 0; i < 6; i++) r += tr[bvId[S[i]]] * 58n ** BigInt(i);
  const add = r < ADD_105 ? ADD_ALL : ADD_105;
  return Number(r - add ^ XOR);
}

// src/bilibili/endpoints.js
var API = "https://api.bilibili.com";
var LIVE = "https://api.live.bilibili.com";
var BiliEndpoints = {
  POST_DETAIL: `${API}/x/web-interface/view`,
  // ?bvid=  (no wbi)
  VIDEO_PLAYURL: `${API}/x/player/wbi/playurl`,
  // wbi
  VIDEO_PARTS: `${API}/x/player/pagelist`,
  // ?bvid=
  USER_POST: `${API}/x/space/wbi/arc/search`,
  // wbi
  USER_DETAIL: `${API}/x/space/wbi/acc/info`,
  // wbi
  COM_POPULAR: `${API}/x/web-interface/popular`,
  // wbi
  VIDEO_COMMENTS: `${API}/x/v2/reply`,
  COMMENT_REPLY: `${API}/x/v2/reply/reply`,
  USER_DYNAMIC: `${API}/x/polymer/web-dynamic/v1/feed/space`,
  // wbi
  LIVEROOM_DETAIL: `${LIVE}/room/v1/Room/get_info`,
  LIVE_VIDEOS: `${LIVE}/room/v1/Room/playUrl`,
  LIVE_AREAS: `${LIVE}/room/v1/Area/getList`
};
var BILI_REFERER = "https://www.bilibili.com/";

// src/bilibili/crawler.js
function biliHeaders(ctx) {
  return buildHeaders({
    userAgent: ctx.config.bili.userAgent,
    referer: BILI_REFERER,
    cookie: ctx.config.bili.cookie
  });
}
function fetchOneVideo(ctx, bvId) {
  const url = `${BiliEndpoints.POST_DETAIL}?bvid=${encodeURIComponent(bvId)}`;
  return fetchGetJson(url, biliHeaders(ctx));
}
function fetchVideoPlayurl(ctx, bvId, cid, { fnval = "4048", qn = "80" } = {}) {
  const q2 = wbiQuery({ bvid: bvId, cid: String(cid), qn: String(qn), fnval: String(fnval), fourk: "1", fnver: "0", otype: "json", platform: "pc" });
  return fetchGetJson(`${BiliEndpoints.VIDEO_PLAYURL}?${q2}`, biliHeaders(ctx));
}
function fetchVideoParts(ctx, bvId) {
  return fetchGetJson(`${BiliEndpoints.VIDEO_PARTS}?bvid=${encodeURIComponent(bvId)}`, biliHeaders(ctx));
}
function fetchUserProfile(ctx, mid) {
  const q2 = wbiQuery({ mid: String(mid), platform: "web", web_location: "1550101" });
  return fetchGetJson(`${BiliEndpoints.USER_DETAIL}?${q2}`, biliHeaders(ctx));
}
function fetchUserPostVideos(ctx, mid, pn = 1) {
  const q2 = wbiQuery({ mid: String(mid), pn: String(pn), ps: "20", order: "pubdate", platform: "web", web_location: "1550101" });
  return fetchGetJson(`${BiliEndpoints.USER_POST}?${q2}`, biliHeaders(ctx));
}
function fetchComPopular(ctx, pn = 1) {
  const q2 = wbiQuery({ ps: "20", pn: String(pn), web_location: "333.934" });
  return fetchGetJson(`${BiliEndpoints.COM_POPULAR}?${q2}`, biliHeaders(ctx));
}
function fetchVideoComments(ctx, aid, pn = 1) {
  return fetchGetJson(`${BiliEndpoints.VIDEO_COMMENTS}?type=1&oid=${encodeURIComponent(aid)}&pn=${pn}&sort=2`, biliHeaders(ctx));
}
function fetchCommentReply(ctx, aid, rpid, pn = 1) {
  return fetchGetJson(`${BiliEndpoints.COMMENT_REPLY}?type=1&oid=${encodeURIComponent(aid)}&root=${encodeURIComponent(rpid)}&pn=${pn}`, biliHeaders(ctx));
}
function fetchLiveRoomDetail(ctx, roomId) {
  return fetchGetJson(`${BiliEndpoints.LIVEROOM_DETAIL}?room_id=${encodeURIComponent(roomId)}`, biliHeaders(ctx));
}

// src/service/bilibili.js
var PLATFORM = "bilibili";
var q = (request, key, dflt = "") => new URL(request.url).searchParams.get(key) ?? dflt;
var requireQ = (request, key) => {
  const v = new URL(request.url).searchParams.get(key);
  if (v === null || v === "") throw new HTTPException(400, { message: `Missing query param: ${key}` });
  return v;
};
async function bilibiliWebService(route, request, ctx) {
  const m = request.method;
  if (m === "GET" && route === "fetch_one_video") {
    const bv = requireQ(request, "bv_id");
    requireAuth(request, ctx, PLATFORM, route, bv);
    return jsonResponse(await fetchOneVideo(ctx, bv), { router: route, params: { bv_id: bv } });
  }
  if (m === "GET" && route === "fetch_video_playurl") {
    const bv = requireQ(request, "bv_id");
    requireAuth(request, ctx, PLATFORM, route, bv);
    const cid = requireQ(request, "cid");
    return jsonResponse(await fetchVideoPlayurl(ctx, bv, cid, { qn: q(request, "qn", "80"), fnval: q(request, "fnval", "4048") }), { router: route });
  }
  if (m === "GET" && route === "fetch_video_parts") {
    const bv = requireQ(request, "bv_id");
    requireAuth(request, ctx, PLATFORM, route, bv);
    return jsonResponse(await fetchVideoParts(ctx, bv), { router: route });
  }
  if (m === "GET" && route === "fetch_user_profile") {
    const uid = requireQ(request, "uid");
    requireAuth(request, ctx, PLATFORM, route, uid);
    return jsonResponse(await fetchUserProfile(ctx, uid), { router: route });
  }
  if (m === "GET" && route === "fetch_user_post_videos") {
    const uid = requireQ(request, "uid");
    requireAuth(request, ctx, PLATFORM, route, uid);
    return jsonResponse(await fetchUserPostVideos(ctx, uid, q(request, "pn", "1")), { router: route });
  }
  if (m === "GET" && route === "fetch_com_popular") {
    requireAuth(request, ctx, PLATFORM, route, "");
    return jsonResponse(await fetchComPopular(ctx, q(request, "pn", "1")), { router: route });
  }
  if (m === "GET" && route === "fetch_video_comments") {
    const bv = requireQ(request, "bv_id");
    requireAuth(request, ctx, PLATFORM, route, bv);
    return jsonResponse(await fetchVideoComments(ctx, bv2av(bv), q(request, "pn", "1")), { router: route });
  }
  if (m === "GET" && route === "fetch_comment_reply") {
    const bv = requireQ(request, "bv_id");
    requireAuth(request, ctx, PLATFORM, route, bv);
    return jsonResponse(await fetchCommentReply(ctx, bv2av(bv), requireQ(request, "rpid"), q(request, "pn", "1")), { router: route });
  }
  if (m === "GET" && route === "fetch_live_room_detail") {
    const roomId = requireQ(request, "room_id");
    requireAuth(request, ctx, PLATFORM, route, roomId);
    return jsonResponse(await fetchLiveRoomDetail(ctx, roomId), { router: route });
  }
  if (m === "GET" && route === "bv_to_aid") {
    return jsonResponse({ aid: bv2av(requireQ(request, "bv_id")) }, { router: route });
  }
  throw new HTTPException(404, { message: `Unknown bilibili/web route: ${route}` });
}

// src/utils/ids.js
var URL_RE = /https?:\/\/\S+/;
var BV_RE = /(BV[0-9A-Za-z]{10})/;
function extractValidUrl(input) {
  if (typeof input !== "string") return null;
  const m = input.match(URL_RE);
  return m ? m[0] : null;
}
async function resolveUrl(url) {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" }
  });
  return resp.url || url;
}
async function getBvId(input) {
  if (typeof input === "string") {
    const direct = input.match(BV_RE);
    if (direct) return direct[1];
  }
  const url = extractValidUrl(input);
  if (!url) throw new HTTPException(400, { message: "Invalid URL (no BV id / link found)" });
  const m1 = url.match(BV_RE);
  if (m1) return m1[1];
  const finalUrl = await resolveUrl(url);
  const m2 = finalUrl.match(BV_RE);
  if (m2) return m2[1];
  throw new HTTPException(404, { message: `BV id not found in ${finalUrl}` });
}

// src/utils/r2cache.js
var mediaKey = (platform, id, kind) => `media/${platform}/${encodeURIComponent(String(id))}/${kind}`;
var metaKey = (platform, id) => `meta/${platform}/${encodeURIComponent(String(id))}.json`;
function parseRangeHeader(header, totalSize) {
  if (!header) return null;
  const m = String(header).trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === "" ? totalSize - 1 : Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= totalSize) return null;
  if (end < start) return null;
  const cappedEnd = Math.min(end, totalSize - 1);
  return { start, end: cappedEnd, length: cappedEnd - start + 1 };
}
async function serveFromR2(bucket, request, key, contentType, minSize = 0) {
  if (!bucket || typeof bucket.head !== "function") return null;
  let head;
  try {
    head = await bucket.head(key);
  } catch {
    return null;
  }
  if (!head) return null;
  if (minSize && (Number(head.size) || 0) < minSize) return null;
  const totalSize = Number(head.size) || 0;
  const storedType = head.httpMetadata?.contentType || contentType || "application/octet-stream";
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRangeHeader(rangeHeader, totalSize) : null;
  if (range) {
    let obj2;
    try {
      obj2 = await bucket.get(key, { range: { offset: range.start, length: range.length } });
    } catch {
      return null;
    }
    if (!obj2) return null;
    return new Response(obj2.body, {
      status: 206,
      headers: {
        "content-type": storedType,
        "content-length": String(range.length),
        "content-range": `bytes ${range.start}-${range.end}/${totalSize}`,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=300",
        "x-cache-source": "r2"
      }
    });
  }
  let obj;
  try {
    obj = await bucket.get(key);
  } catch {
    return null;
  }
  if (!obj) return null;
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": storedType,
      "content-length": String(totalSize),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=300",
      "x-cache-source": "r2"
    }
  });
}
function teeIntoCache(bucket, ctx, key, upstreamResponse, contentType) {
  if (!bucket || !upstreamResponse.ok || !upstreamResponse.body) return upstreamResponse;
  const finalType = contentType || upstreamResponse.headers.get("content-type") || "application/octet-stream";
  const lenHeader = upstreamResponse.headers.get("content-length");
  const total = lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
  let userBranch, r2Branch;
  try {
    [userBranch, r2Branch] = upstreamResponse.body.tee();
  } catch {
    return upstreamResponse;
  }
  const put = bucket.put(key, r2Branch, { httpMetadata: { contentType: finalType } }).catch((e) => {
    try {
      console.error("[r2] put failed", key, e?.message || e);
    } catch {
    }
  });
  if (ctx?.waitUntil) ctx.waitUntil(put);
  const out = new Headers();
  out.set("content-type", finalType);
  if (total != null) out.set("content-length", String(total));
  out.set("accept-ranges", "bytes");
  out.set("cache-control", "public, max-age=300");
  out.set("x-cache-source", "upstream-tee");
  return new Response(userBranch, { status: upstreamResponse.status, headers: out });
}
async function getJson(bucket, key, ttlSeconds) {
  if (!bucket || typeof bucket.get !== "function") return null;
  let obj;
  try {
    obj = await bucket.get(key);
  } catch {
    return null;
  }
  if (!obj) return null;
  if (ttlSeconds && obj.uploaded) {
    const age = (Date.now() - new Date(obj.uploaded).getTime()) / 1e3;
    if (age > ttlSeconds) return null;
  }
  try {
    const text = obj.body ? await new Response(obj.body).text() : await obj.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function r2PutRetry(bucket, key, makeBody, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await bucket.put(key, makeBody(), opts);
      return true;
    } catch (e) {
      if (i === tries - 1) {
        try {
          console.error("[r2] put gave up", key, e?.message || e);
        } catch {
        }
        return false;
      }
    }
  }
  return false;
}
function putJson(bucket, ctx, key, obj) {
  if (!bucket) return;
  const json = JSON.stringify(obj);
  const p = r2PutRetry(
    bucket,
    key,
    () => new Response(json).body,
    { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    2
  );
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

// src/utils/meta-cache.js
async function fetchBiliCached(ctx, bvId, refresh = false) {
  const bucket = ctx.config.mediaR2;
  const key = metaKey("bilibili", bvId);
  if (bucket && !refresh) {
    const cached = await getJson(bucket, key, ctx.config.cache.metaTtl);
    if (cached) return { data: cached, cached: true };
  }
  const view = await fetchOneVideo(ctx, bvId);
  const d = view.data;
  if (!d) throw new HTTPException(502, { message: `Bilibili view returned no data (code ${view.code}: ${view.message || ""}) \u2014 bad cookie?` });
  const cid = d.cid;
  let dash = null;
  let durl = null;
  try {
    const r = await fetchVideoPlayurl(ctx, bvId, cid, { fnval: "4048", qn: "80" });
    dash = r.data?.dash || null;
  } catch {
  }
  try {
    const r = await fetchVideoPlayurl(ctx, bvId, cid, { fnval: "1", qn: "80" });
    durl = r.data?.durl || null;
  } catch {
  }
  const data = {
    bvid: d.bvid || bvId,
    aid: d.aid,
    cid,
    title: d.title,
    desc: d.desc,
    pic: d.pic,
    pubdate: d.pubdate,
    owner: d.owner,
    stat: d.stat,
    duration: d.duration,
    pages: Array.isArray(d.pages) ? d.pages.length : 1,
    dash: dash ? { video: dash.video || [], audio: dash.audio || [] } : null,
    durl: durl || null
  };
  putJson(bucket, ctx, key, data);
  return { data, cached: false };
}

// src/hybrid/crawler.js
function detectPlatform(url) {
  if (url.includes("bilibili") || url.includes("b23.tv") || url.includes("bili2233") || /BV[0-9A-Za-z]{10}/.test(url)) return "bilibili";
  return null;
}
async function resolvePlatformId(url) {
  if (/\/proxy\?/.test(url) || /[?&]kind=/.test(url)) {
    throw new HTTPException(400, { message: "\u8FD9\u662F\u89E3\u6790\u7ED3\u679C\u94FE\u63A5\uFF0C\u8BF7\u7C98\u8D34 B \u7AD9\u539F\u59CB\u89C6\u9891\u94FE\u63A5 / \u5206\u4EAB\u53E3\u4EE4" });
  }
  if (!detectPlatform(url)) throw new HTTPException(400, { message: "Not a Bilibili URL (need bilibili.com / b23.tv / BV\u2026)" });
  return { platform: "bilibili", id: await getBvId(url) };
}
async function fetchRawById(ctx, platform, id, refresh = false) {
  const { raw } = { raw: (await fetchBiliCached(ctx, id, refresh)).data };
  return { raw };
}
function toMinimal(platform, videoId, data) {
  const v = data.dash?.video?.[0]?.baseUrl || null;
  const a = data.dash?.audio?.[0]?.baseUrl || null;
  const mp4 = data.durl?.[0]?.url || null;
  return {
    type: "video",
    platform: "bilibili",
    video_id: videoId,
    desc: data.title,
    create_time: null,
    author: data.owner || null,
    music: null,
    statistics: data.stat || null,
    duration: data.duration || null,
    cover_data: { cover: data.pic || null },
    video_data: {
      mp4_url: mp4,
      // combined, playable
      video_url: v,
      // DASH hi-res video (no audio)
      audio_url: a
      // DASH audio
    }
  };
}
async function hybridParseSingleVideo(ctx, url, minimal = false, refresh = false) {
  const { platform, id } = await resolvePlatformId(url);
  const { raw } = await fetchRawById(ctx, platform, id, refresh);
  if (!minimal) return raw;
  return toMinimal(platform, id, raw);
}
function mediaCandidates(platform, raw, kind) {
  const out = [];
  const push = (u) => {
    if (typeof u === "string" && u) out.push(u);
  };
  const pushStream = (s) => {
    if (s) {
      push(s.baseUrl || s.base_url);
      for (const b of s.backupUrl || s.backup_url || []) push(b);
    }
  };
  if (kind === "mp4") {
    for (const d of raw.durl || []) {
      push(d.url);
      for (const b of d.backup_url || []) push(b);
    }
  } else if (kind === "video") {
    for (const s of raw.dash?.video || []) pushStream(s);
  } else if (kind === "audio") {
    for (const s of raw.dash?.audio || []) pushStream(s);
  } else if (kind === "cover") {
    push(raw.pic);
  } else if (kind === "avatar") {
    push(raw.owner?.face);
  }
  return [...new Set(out.map((u) => u.replace(/^http:/, "https:")))];
}

// src/utils/proxy-link.js
function proxyBase(request, ctx) {
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || u.host;
  return `${proto}://${host}${ctx.config.http.prefix}`;
}
function proxyLink(request, ctx, platform, id, kind, expSec) {
  const secret = ctx.config.auth.token;
  const params = new URLSearchParams({ platform, id: String(id), kind });
  if (expSec) {
    const exp = Math.floor(Date.now() / 1e3) + expSec;
    params.set("exp", String(exp));
    params.set("auth", sign(`${canonical("proxy", platform, id)}${exp}`, secret));
  } else {
    params.set("auth", sign(canonical("proxy", platform, id), secret));
  }
  return `${proxyBase(request, ctx)}/proxy?${params.toString()}`;
}
function rewriteMinimalToProxy(minimal, request, ctx, expSec) {
  const { platform, video_id: id } = minimal;
  const L = (kind) => proxyLink(request, ctx, platform, id, kind, expSec);
  if (minimal.video_data) {
    minimal.video_data = {
      mp4_url: minimal.video_data.mp4_url ? L("mp4") : null,
      video_url: minimal.video_data.video_url ? L("video") : null,
      audio_url: minimal.video_data.audio_url ? L("audio") : null
    };
  }
  if (minimal.cover_data) {
    minimal.cover_data = { ...minimal.cover_data, cover: minimal.cover_data.cover ? L("cover") : null };
  }
  return minimal;
}

// src/utils/db.js
var schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
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
  )`).run();
  for (const col of ["duration INTEGER", "extra TEXT", "create_time INTEGER", "author_id TEXT"]) {
    try {
      await db.prepare(`ALTER TABLE queries ADD COLUMN ${col}`).run();
    } catch {
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS authors (
    platform TEXT NOT NULL,
    author_id TEXT NOT NULL,
    name TEXT,
    avatar TEXT,
    extra TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(platform, author_id)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    stats TEXT
  )`).run();
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_stats_vid ON stats_history (platform, video_id, ts)").run();
  } catch {
  }
  schemaReady = true;
}
var COLS = "platform, video_id, type, author, author_id, description, original_url, cover, play, duration, create_time, extra, hits, created_at, updated_at";
var parseRow = (r) => {
  if (r && typeof r.extra === "string") {
    try {
      r.extra = JSON.parse(r.extra);
    } catch {
      r.extra = null;
    }
  }
  return r;
};
async function logQuery(ctx, row) {
  const db = ctx.config.d1;
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    const extra = row.extra ? JSON.stringify(row.extra) : null;
    const authorId = row.authorInfo?.id || null;
    await db.prepare(`INSERT INTO queries
      (platform, video_id, type, author, author_id, description, original_url, cover, play, duration, create_time, extra, hits, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(platform, video_id) DO UPDATE SET
        hits = hits + 1, updated_at = ?, type = ?, author = ?, author_id = ?,
        description = ?, original_url = ?, cover = ?, play = ?, duration = ?, create_time = ?, extra = ?`).bind(
      row.platform,
      row.video_id,
      row.type,
      row.author,
      authorId,
      row.description,
      row.original_url,
      row.cover,
      row.play,
      row.duration ?? null,
      row.create_time ?? null,
      extra,
      now,
      now,
      now,
      row.type,
      row.author,
      authorId,
      row.description,
      row.original_url,
      row.cover,
      row.play,
      row.duration ?? null,
      row.create_time ?? null,
      extra
    ).run();
    if (authorId) {
      const a = row.authorInfo;
      const aExtra = a.extra ? JSON.stringify(a.extra) : null;
      await db.prepare(`INSERT INTO authors (platform, author_id, name, avatar, extra, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, author_id) DO UPDATE SET name = ?, avatar = ?, extra = ?, updated_at = ?`).bind(row.platform, authorId, a.name ?? null, a.avatar ?? null, aExtra, now, a.name ?? null, a.avatar ?? null, aExtra, now).run();
    }
    if (row.stats && Object.keys(row.stats).length) {
      const statsStr = JSON.stringify(row.stats);
      const last = await db.prepare("SELECT ts, stats FROM stats_history WHERE platform = ? AND video_id = ? ORDER BY ts DESC LIMIT 1").bind(row.platform, row.video_id).all();
      const prev = last?.results?.[0];
      const fresh = prev && now - prev.ts < 3e5 && prev.stats === statsStr;
      if (!fresh) {
        await db.prepare("INSERT INTO stats_history (platform, video_id, ts, stats) VALUES (?, ?, ?, ?)").bind(row.platform, row.video_id, now, statsStr).run();
      }
    }
  } catch (e) {
    try {
      console.error("[d1] logQuery failed", e?.message || e);
    } catch {
    }
  }
}
async function getWork(ctx, platform, videoId) {
  const db = ctx.config.d1;
  if (!db) return null;
  try {
    await ensureSchema(db);
    const q2 = await db.prepare(`SELECT ${COLS} FROM queries WHERE platform = ? AND video_id = ?`).bind(platform, videoId).all();
    const row = parseRow(q2?.results?.[0]);
    if (!row) return null;
    let author = null;
    if (row.author_id) {
      const a = await db.prepare("SELECT platform, author_id, name, avatar, extra, updated_at FROM authors WHERE platform = ? AND author_id = ?").bind(platform, row.author_id).all();
      author = parseRow(a?.results?.[0]) || null;
    }
    const h = await db.prepare("SELECT ts, stats FROM stats_history WHERE platform = ? AND video_id = ? ORDER BY ts ASC LIMIT 500").bind(platform, videoId).all();
    const history = (h?.results || []).map((r) => {
      let s = {};
      try {
        s = JSON.parse(r.stats);
      } catch {
      }
      return { ts: r.ts, stats: s };
    });
    return { work: row, author, history };
  } catch (e) {
    try {
      console.error("[d1] getWork failed", e?.message || e);
    } catch {
    }
    return null;
  }
}
async function pageQueries(ctx, order, limit, offset) {
  const db = ctx.config.d1;
  if (!db) return { rows: [], total: 0 };
  try {
    await ensureSchema(db);
    const res = await db.prepare(`SELECT ${COLS} FROM queries ORDER BY ${order} LIMIT ? OFFSET ?`).bind(limit, offset).all();
    const cnt = await db.prepare("SELECT COUNT(*) AS n FROM queries").all();
    return { rows: (res?.results || []).map(parseRow), total: cnt?.results?.[0]?.n || 0 };
  } catch (e) {
    try {
      console.error("[d1] pageQueries failed", e?.message || e);
    } catch {
    }
    return { rows: [], total: 0 };
  }
}
var recentQueries = (ctx, limit = 10, offset = 0) => pageQueries(ctx, "updated_at DESC", limit, offset);
var discoverQueries = (ctx, sort = "recent", limit = 12, offset = 0) => pageQueries(ctx, sort === "hot" ? "hits DESC, updated_at DESC" : "updated_at DESC", limit, offset);
async function rateLimitHit(ctx, ip, limit, windowSec) {
  if (ctx.config.kv) return rateLimitKV(ctx.config.kv, ip, limit, windowSec);
  if (ctx.config.d1) return rateLimitD1(ctx.config.d1, ip, limit, windowSec);
  return { allowed: false, reason: "no-store" };
}
async function rateLimitKV(kv, ip, limit, windowSec) {
  try {
    const nowSec = Math.floor(Date.now() / 1e3);
    const bucket = Math.floor(nowSec / windowSec);
    const key = `rl:${ip}:${bucket}`;
    let n = 0;
    try {
      const v = await kv.get(key);
      if (v) n = parseInt(v, 10) || 0;
    } catch {
    }
    n += 1;
    await kv.put(key, String(n), { expirationTtl: Math.max(60, windowSec) });
    return { allowed: n <= limit, count: n, limit, resetSec: (bucket + 1) * windowSec - nowSec };
  } catch (e) {
    try {
      console.error("[kv] rateLimitHit failed", e?.message || e);
    } catch {
    }
    return { allowed: false, reason: "error" };
  }
}
var rateSchemaReady = false;
async function rateLimitD1(db, ip, limit, windowSec) {
  try {
    if (!rateSchemaReady) {
      await db.prepare("CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip, bucket))").run();
      rateSchemaReady = true;
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    const bucket = Math.floor(nowSec / windowSec);
    await db.prepare("INSERT INTO rate (ip, bucket, n) VALUES (?, ?, 1) ON CONFLICT(ip, bucket) DO UPDATE SET n = n + 1").bind(ip, bucket).run();
    const res = await db.prepare("SELECT n FROM rate WHERE ip = ? AND bucket = ?").bind(ip, bucket).all();
    const count = res?.results?.[0]?.n || 1;
    return { allowed: count <= limit, count, limit, resetSec: (bucket + 1) * windowSec - nowSec };
  } catch (e) {
    try {
      console.error("[d1] rateLimitHit failed", e?.message || e);
    } catch {
    }
    return { allowed: false, reason: "error" };
  }
}

// src/service/hybrid.js
var PLATFORM2 = "bilibili";
var truthy = (v) => ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
async function hybridService(route, request, ctx) {
  if (request.method === "GET" && route === "video_data") {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) throw new HTTPException(400, { message: "Missing query param: url" });
    const authed = isAuthorised(request, ctx, PLATFORM2, "video_data", target);
    let guest = false;
    if (!authed) {
      const g = ctx.config.guest;
      if (!g.enabled) throw new HTTPException(401, { message: "Unauthorized: pass ?token=<secret>" });
      const rl = await rateLimitHit(ctx, getClientIp(request), g.limit, g.windowSec);
      if (rl.reason === "no-store") {
        throw new HTTPException(503, { message: "\u6E38\u5BA2\u6A21\u5F0F\u9700\u8981 KV \u6216 D1 \u624D\u80FD\u9650\u6D41\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u7ED1\u5B9A / guest mode needs a KV or D1 binding" });
      }
      if (!rl.allowed) {
        return new Response(JSON.stringify({ code: 429, message: `\u6E38\u5BA2\u6BCF ${Math.round(g.windowSec / 60)} \u5206\u949F\u9650 ${g.limit} \u6B21\uFF0C\u8BF7 ${rl.resetSec}s \u540E\u518D\u8BD5\u6216\u586B\u5165\u8BBF\u95EE\u5BC6\u94A5` }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(rl.resetSec || g.windowSec) }
        });
      }
      guest = true;
    }
    const minimal = guest ? true : truthy(url.searchParams.get("minimal") ?? "false");
    const proxy = guest ? true : truthy(url.searchParams.get("proxy") ?? "false");
    const refresh = guest ? false : truthy(url.searchParams.get("refresh") ?? "false");
    const linkTtl = guest ? ctx.config.guest.linkTtlSec : void 0;
    const { platform, id } = await resolvePlatformId(target);
    const { raw } = await fetchRawById(ctx, platform, id, refresh);
    const min = toMinimal(platform, id, raw);
    const o = min.author || {};
    const s = min.statistics || {};
    await logQuery(ctx, {
      platform,
      video_id: id,
      type: "video",
      author: o.name || null,
      authorInfo: o.mid ? {
        id: String(o.mid),
        name: o.name || null,
        avatar: proxyLink(request, ctx, platform, id, "avatar"),
        extra: { mid: o.mid }
      } : null,
      create_time: raw.pubdate || null,
      stats: {
        play: s.view,
        digg: s.like,
        comment: s.reply,
        share: s.share,
        danmaku: s.danmaku,
        coin: s.coin,
        collect: s.favorite
      },
      description: min.desc || null,
      original_url: target,
      cover: proxyLink(request, ctx, platform, id, "cover"),
      play: proxyLink(request, ctx, platform, id, "mp4"),
      duration: raw.duration || null,
      extra: { stats: min.statistics || null }
    });
    let data = minimal ? min : raw;
    if (minimal && proxy) data = rewriteMinimalToProxy(data, request, ctx, linkTtl);
    return jsonResponse(data, { router: "hybrid/video_data", params: { url: target, minimal, proxy, guest } });
  }
  if (request.method === "POST" && route === "update_cookie") {
    throw new HTTPException(501, { message: "update_cookie is not supported \u2014 set the BILI_COOKIE env binding instead." });
  }
  throw new HTTPException(404, { message: `Unknown hybrid route: ${route}` });
}
async function downloadService(request, ctx) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) throw new HTTPException(400, { message: "Missing query param: url" });
  requireAuthOrThrow(request, ctx, target);
  const data = await hybridParseSingleVideo(ctx, target, true);
  const fileUrl = data.video_data.mp4_url || data.video_data.video_url;
  if (!fileUrl) throw new HTTPException(404, { message: "No downloadable URL found" });
  const upstream = await fetch(fileUrl, {
    headers: { "User-Agent": ctx.config.bili.userAgent, Referer: "https://www.bilibili.com/" }
  });
  if (!upstream.ok || !upstream.body) throw new HTTPException(502, { message: `Failed to fetch media (${upstream.status})` });
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "video/mp4");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", `attachment; filename="bilibili_${data.video_id}.mp4"`);
  return new Response(upstream.body, { status: 200, headers });
}
function requireAuthOrThrow(request, ctx, target) {
  if (!isAuthorised(request, ctx, "bilibili", "download", target)) {
    throw new HTTPException(401, { message: "Unauthorized: pass ?token=<secret> or ?auth=" });
  }
}

// src/service/proxy.js
var BUFFER_CAP = 20 * 1024 * 1024;
var MIN_CACHE_BYTES = 1024;
var minSizeForKind = (kind) => kind === "cover" || kind === "avatar" ? 256 : 1e4;
var KIND_CT = { mp4: "video/mp4", video: "video/mp4", audio: "audio/mp4", cover: "image/jpeg", avatar: "image/jpeg" };
var KIND_EXT = { mp4: "mp4", video: "m4s", audio: "m4s", cover: "jpeg", avatar: "jpeg" };
async function proxyService(request, ctx) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") || "bilibili";
  const id = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind") || "mp4";
  if (platform !== "bilibili") throw new HTTPException(400, { message: "platform must be bilibili" });
  if (!id) throw new HTTPException(400, { message: "Missing query param: id" });
  if (!KIND_CT[kind]) throw new HTTPException(400, { message: `Unknown kind: ${kind}` });
  requireProxyAuth(request, ctx, platform, id);
  const refresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh")).toLowerCase());
  const download = ["1", "true", "yes"].includes(String(url.searchParams.get("download")).toLowerCase());
  const bucket = ctx.config.mediaR2;
  const key = mediaKey(platform, id, kind);
  const contentType = KIND_CT[kind];
  const ext = KIND_EXT[kind];
  if (bucket && !refresh) {
    const hit = await serveFromR2(bucket, request, key, void 0, minSizeForKind(kind));
    if (hit) return withDisposition(hit, download, platform, id, kind, ext);
  }
  const { raw } = await fetchRawById(ctx, platform, id, refresh);
  const candidates = mediaCandidates(platform, raw, kind);
  if (!candidates.length) throw new HTTPException(404, { message: `No media url for kind=${kind}` });
  const reqHeaders = { "User-Agent": ctx.config.bili.userAgent, Referer: "https://www.bilibili.com/" };
  const rangeHeader = request.headers.get("range");
  let upstream = null;
  let usedUrl = null;
  for (const u of candidates) {
    let r;
    try {
      r = await fetch(u, { headers: rangeHeader ? { ...reqHeaders, range: rangeHeader } : reqHeaders });
    } catch {
      continue;
    }
    if (looksLikeMedia(r, kind, !!rangeHeader)) {
      upstream = r;
      usedUrl = u;
      break;
    }
    try {
      await r.body?.cancel();
    } catch {
    }
  }
  if (!upstream) throw new HTTPException(502, { message: `All ${candidates.length} candidate url(s) failed for kind=${kind}` });
  if (rangeHeader) {
    if (bucket && ctx?.waitUntil && rangeStartOf(rangeHeader) === 0) {
      ctx.waitUntil(r2PutRetry(bucket, key, async () => {
        const f = await fetch(usedUrl, { headers: reqHeaders });
        if (!f.ok || !f.body) throw new Error("warm fetch not ok");
        return f.body;
      }, { httpMetadata: { contentType } }, 1));
    }
    return withDisposition(wrapMedia(upstream, contentType, "upstream-range"), download, platform, id, kind, ext);
  }
  if (!bucket) {
    return withDisposition(wrapMedia(upstream, contentType, "upstream-plain"), download, platform, id, kind, ext);
  }
  const cl = Number(upstream.headers.get("content-length") || 0);
  if (cl > BUFFER_CAP) {
    return withDisposition(teeIntoCache(bucket, ctx, key, upstream, contentType), download, platform, id, kind, ext);
  }
  const buf = await upstream.arrayBuffer();
  const size = buf.byteLength;
  if (size >= MIN_CACHE_BYTES && ctx?.waitUntil) {
    ctx.waitUntil(r2PutRetry(bucket, key, () => new Response(buf).body, { httpMetadata: { contentType } }, 2));
  }
  const out = new Headers({
    "content-type": contentType,
    "content-length": String(size),
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=300",
    "x-cache-source": "upstream-buffer"
  });
  return withDisposition(new Response(buf, { status: 200, headers: out }), download, platform, id, kind, ext);
}
function looksLikeMedia(resp, kind, isRange) {
  if (!resp.ok || !resp.body) return false;
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/json") || ct.includes("text/xml") || ct.includes("text/plain")) return false;
  if (!isRange) {
    const len = Number(resp.headers.get("content-length") || 0);
    if (len && len < minSizeForKind(kind)) return false;
  }
  return true;
}
function rangeStartOf(header) {
  const m = String(header || "").match(/bytes=(\d+)-/);
  return m ? Number(m[1]) : 0;
}
function wrapMedia(upstream, contentType, source) {
  const out = new Headers();
  out.set("content-type", upstream.headers.get("content-type") || contentType || "application/octet-stream");
  const cl = upstream.headers.get("content-length");
  if (cl) out.set("content-length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("content-range", cr);
  out.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  out.set("cache-control", "public, max-age=300");
  out.set("x-cache-source", source);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
function withDisposition(resp, download, platform, id, kind, ext) {
  if (!download) return resp;
  const headers = new Headers(resp.headers);
  headers.set("content-disposition", `attachment; filename="bilibili_${id}_${kind}.${ext}"`);
  return new Response(resp.body, { status: resp.status, headers });
}

// src/service/admin.js
async function adminRecentService(request, ctx) {
  const url = new URL(request.url);
  if ((url.searchParams.get("token") || "") !== ctx.config.auth.token) {
    throw new HTTPException(401, { message: "token required" });
  }
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 10));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const { rows, total } = await recentQueries(ctx, limit, (page - 1) * limit);
  return rawJsonResponse({ code: 200, page, limit, total, pages: Math.ceil(total / limit) || 1, count: rows.length, data: rows });
}
async function adminPageService(request, ctx) {
  return new Response(ADMIN_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
var ADMIN_HTML = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u6863\u6848 \xB7 \u8FD1\u671F\u89E3\u7801</title>
<style>
:root{
  --bg:#15141b;--panel:#1d1b25;--panel2:#221f2a;--line:#36313f;
  --ink:#ece7db;--muted:#938da0;--faint:#615b6e;--coral:#ff5d6c;--teal:#3fe0c5;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#221f2c 0%,transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);padding:max(20px,4vh) 18px 60px;-webkit-font-smoothing:antialiased}
.wrap{max-width:920px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--coral);margin:0 0 8px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(34px,9vw,60px);line-height:.95;margin:0;letter-spacing:.04em}
.bar{display:flex;gap:10px;align-items:center;margin:22px 0 18px;flex-wrap:wrap}
.bar input{flex:1;min-width:180px;background:var(--panel);border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:13px;padding:10px 13px;border-radius:9px}
.bar a,.bar button{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-decoration:none;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);padding:10px 14px;border-radius:8px}
.bar a:hover,.bar button:hover{border-color:var(--teal);color:var(--teal)}
input:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:0 2px 16px;min-height:1.3em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.item{display:flex;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
.thumb{flex:0 0 64px;width:64px;height:96px;border-radius:8px;object-fit:cover;background:#0e0d12;border:1px solid var(--line)}
.info{min-width:0;display:flex;flex-direction:column;gap:4px}
.info .top{display:flex;gap:8px;align-items:center}
.tag{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--teal);border:1px solid var(--line);border-radius:5px;padding:1px 6px}
.who{font-family:var(--serif);font-size:15px}
.dsc{color:var(--muted);font-size:12.5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.row{margin-top:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--faint)}
.row a{color:var(--muted);text-decoration:none}
.row a:hover{color:var(--teal)}
.pager{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:20px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.pager button{font-family:var(--mono);font-size:12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 14px;border-radius:8px}
.pager button:hover:not(:disabled){border-color:var(--teal);color:var(--teal)}
.pager button:disabled{opacity:.35;cursor:default}
footer{margin-top:30px;font-family:var(--mono);font-size:11px;color:var(--faint)}
footer a{color:var(--muted)}
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI \u6863\u6848</p>
  <h1>\u8FD1\u671F\u89E3\u7801</h1>
  <div class=bar>
    <input id=key type=password autocomplete=off placeholder="\u8BBF\u95EE\u5BC6\u94A5 (API Token)">
    <button id=refresh>\u5237\u65B0</button>
    <a href="/">\u2190 \u89E3\u6790\u53F0</a>
  </div>
  <p id=status class=status>\u8F93\u5165\u5BC6\u94A5\u540E\u81EA\u52A8\u52A0\u8F7D</p>
  <div id=grid class=grid></div>
  <div id=pager class=pager></div>
  <footer>\u81EA\u6258\u7BA1\u4E8E RandallFlare \xB7 \u6BCF\u9875 10 \u6761 \xB7 \u91CD\u590D\u89E3\u6790\u5408\u5E76\u8BA1\u6B21</footer>
</main>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var KEY='dt_key'
  var keyInput=$('#key'),statusEl=$('#status'),grid=$('#grid'),pager=$('#pager')
  try{var k=localStorage.getItem(KEY);if(k)keyInput.value=k}catch(e){}
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function ago(ms){var s=Math.floor((Date.now()-ms)/1000);if(s<60)return s+'\u79D2\u524D';if(s<3600)return Math.floor(s/60)+'\u5206\u524D';if(s<86400)return Math.floor(s/3600)+'\u65F6\u524D';return Math.floor(s/86400)+'\u5929\u524D'}
  async function load(page){
    page=page||1
    var key=(keyInput.value||'').trim()
    if(!key){statusEl.textContent='\u5148\u586B\u8BBF\u95EE\u5BC6\u94A5';return}
    try{localStorage.setItem(KEY,key)}catch(e){}
    statusEl.textContent='\u52A0\u8F7D\u4E2D\u2026';grid.innerHTML='';pager.innerHTML=''
    try{
      var r=await fetch('/api/admin/recent?limit=10&page='+page+'&token='+encodeURIComponent(key))
      if(r.status!==200){statusEl.textContent='\u52A0\u8F7D\u5931\u8D25 HTTP '+r.status;return}
      var j=await r.json();var rows=j.data||[]
      statusEl.textContent=j.total?('\u5171 '+j.total+' \u6761 \xB7 \u7B2C '+j.page+'/'+j.pages+' \u9875'):'\u8FD8\u6CA1\u6709\u67E5\u8BE2\u8BB0\u5F55'
      rows.forEach(function(row){grid.appendChild(card(row))})
      renderPager(j.page,j.pages)
    }catch(e){statusEl.textContent='\u7F51\u7EDC\u9519\u8BEF\uFF1A'+e.message}
  }
  function renderPager(page,pages){
    if(!pages||pages<=1)return
    var prev=el('button',null,'\u2190 \u4E0A\u4E00\u9875');prev.disabled=page<=1;prev.addEventListener('click',function(){load(page-1)})
    var info=el('span',null,page+' / '+pages)
    var next=el('button',null,'\u4E0B\u4E00\u9875 \u2192');next.disabled=page>=pages;next.addEventListener('click',function(){load(page+1)})
    pager.appendChild(prev);pager.appendChild(info);pager.appendChild(next)
  }
  function card(row){
    var it=el('div','item')
    var im=el('img','thumb');im.loading='lazy';if(row.cover)im.src=row.cover;im.alt='';it.appendChild(im)
    var info=el('div','info')
    var top=el('div','top');top.appendChild(el('span','tag',(row.platform||'')+' \xB7 '+(row.type==='image'?'\u56FE\u96C6':'\u89C6\u9891')));info.appendChild(top)
    info.appendChild(el('div','who',row.author||'\u672A\u77E5\u4F5C\u8005'))
    if(row.description)info.appendChild(el('div','dsc',row.description))
    var rowEl=el('div','row')
    rowEl.appendChild(el('span',null,'\xD7'+(row.hits||1)+' \xB7 '+ago(row.updated_at)))
    var re=el('a',null,'\u91CD\u89E3');re.href='/?u='+encodeURIComponent(row.original_url||'');rowEl.appendChild(re)
    if(row.play){var p=el('a',null,'\u770B\u89C6\u9891');p.href=row.play;p.target='_blank';p.rel='noopener';rowEl.appendChild(p)}
    if(row.original_url){var o=el('a',null,'\u539F\u94FE');o.href=row.original_url;o.target='_blank';o.rel='noopener';rowEl.appendChild(o)}
    info.appendChild(rowEl)
    it.appendChild(info)
    return it
  }
  $('#refresh').addEventListener('click',function(){load(1)})
  keyInput.addEventListener('keydown',function(e){if(e.key==='Enter')load(1)})
  if(keyInput.value)load(1)
})();
</script>
</body>
</html>`;

// src/service/discover.js
async function discoverApiService(request, ctx) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "hot" ? "hot" : "recent";
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get("limit")) || 12));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const { rows, total } = await discoverQueries(ctx, sort, limit, (page - 1) * limit);
  return rawJsonResponse({ code: 200, sort, page, limit, total, pages: Math.ceil(total / limit) || 1, count: rows.length, data: rows });
}
async function discoverPageService(request, ctx) {
  return new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
var PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u53D1\u73B0 \xB7 \u54D4\u54E9\u54D4\u54E9\u89E3\u6790</title>
<style>
:root{
  --bg:#11141a;--panel:#181d27;--panel2:#1e2430;--line:#2c3442;
  --ink:#e9edf3;--muted:#8b97a8;--faint:#586273;--pink:#fb7299;--blue:#46c4ff;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 560px at 50% -10%,#1a2230 0%,transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);padding:max(20px,4vh) 18px 60px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--pink);margin:0 0 8px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(36px,9vw,64px);line-height:.95;margin:0;letter-spacing:.04em}
.sub{color:var(--muted);font-size:14px;margin:12px 0 0}
.bar{display:flex;gap:8px;align-items:center;margin:22px 0 18px;flex-wrap:wrap}
.tab{font-family:var(--mono);font-size:12px;letter-spacing:.1em;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted);padding:8px 16px;border-radius:999px}
.tab.on{border-color:var(--pink);color:var(--pink)}
.spacer{flex:1}
.bar a{font-family:var(--mono);font-size:11px;color:var(--faint);text-decoration:none}
.bar a:hover{color:var(--blue)}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:0 2px 16px;min-height:1.3em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.card{display:block;text-decoration:none;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;transition:border-color .15s}
.card:hover{border-color:var(--blue)}
.thumb{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.hot{position:absolute;right:8px;top:8px;font-family:var(--mono);font-size:10px;background:rgba(251,114,153,.92);color:#2a0d16;font-weight:700;padding:2px 7px;border-radius:5px}
.dur{position:absolute;left:8px;bottom:8px;font-family:var(--mono);font-size:10px;background:rgba(17,20,26,.82);color:#cdd6e2;padding:2px 6px;border-radius:5px}
.datalink{position:absolute;right:8px;bottom:8px;font-size:13px;background:rgba(17,20,26,.82);padding:3px 7px;border-radius:6px;text-decoration:none;backdrop-filter:blur(4px)}
.datalink:hover{background:var(--blue)}
.info{padding:10px}
.who{font-family:var(--mono);font-size:11px;color:var(--blue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ttl{font-size:13px;margin-top:3px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.when{font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:6px}
.pager{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:24px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.pager button{font-family:var(--mono);font-size:12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 14px;border-radius:8px}
.pager button:disabled{opacity:.35;cursor:default}
.pager button:hover:not(:disabled){border-color:var(--blue);color:var(--blue)}
footer{margin-top:32px;font-family:var(--mono);font-size:11px;color:var(--faint)}
footer a{color:var(--muted)}
/* lightbox */
.lb{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(7,9,13,.92);backdrop-filter:blur(6px)}
.lb.on{display:flex}
.lb-stage{position:relative;max-width:min(1100px,95vw);max-height:90vh;display:flex;align-items:center;justify-content:center}
.lb-stage video,.lb-stage img{max-width:95vw;max-height:90vh;border-radius:10px;display:block;background:#000}
.lb-close{position:fixed;top:16px;right:18px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:20px;cursor:pointer;line-height:40px}
.lb-close:hover{background:var(--pink);color:#2a0d16}
.lb-nav{position:fixed;top:50%;transform:translateY(-50%);width:48px;height:64px;border:0;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-size:26px;cursor:pointer}
.lb-nav:hover{background:rgba(255,255,255,.18)}
.lb-prev{left:14px} .lb-next{right:14px}
.lb-idx{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:12px;color:#cdd6e2;background:rgba(7,9,13,.6);padding:4px 12px;border-radius:999px}
@media(max-width:560px){.lb-nav{width:40px;height:52px;font-size:20px}}
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI \u53D1\u73B0</p>
  <h1>\u5927\u5BB6\u5728\u89E3\u6790</h1>
  <p class=sub>\u6700\u8FD1\u88AB\u89E3\u6790\u7684\u89C6\u9891\uFF0C\u76F4\u63A5\u6765\u81EA\u7F13\u5B58\u2014\u2014\u70B9\u5F00\u5373\u770B\uFF0C\u4E0D\u518D\u6253\u6270\u539F\u7AD9\u3002</p>
  <div class=bar>
    <button class="tab on" data-sort=recent id=tabRecent>\u6700\u8FD1</button>
    <button class=tab data-sort=hot id=tabHot>\u70ED\u5EA6</button>
    <span class=spacer></span>
    <a href="/">\u2190 \u53BB\u89E3\u6790</a>
  </div>
  <p id=status class=status>\u52A0\u8F7D\u4E2D\u2026</p>
  <div id=grid class=grid></div>
  <div id=pager class=pager></div>
  <footer>\u81EA\u6258\u7BA1\u4E8E RandallFlare \xB7 <a href="/">\u89E3\u6790\u53F0</a> \xB7 <a href="/docs">\u63A5\u53E3</a></footer>
</main>
<div id=lb class=lb>
  <button class=lb-close id=lbClose aria-label=\u5173\u95ED>\xD7</button>
  <button class="lb-nav lb-prev" id=lbPrev aria-label=\u4E0A\u4E00\u5F20>\u2039</button>
  <div class=lb-stage id=lbStage></div>
  <button class="lb-nav lb-next" id=lbNext aria-label=\u4E0B\u4E00\u5F20>\u203A</button>
  <div class=lb-idx id=lbIdx></div>
</div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var grid=$('#grid'),statusEl=$('#status'),pager=$('#pager')
  var sort='recent',page=1
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function ago(ms){var s=Math.floor((Date.now()-ms)/1000);if(s<60)return s+'\u79D2\u524D';if(s<3600)return Math.floor(s/60)+'\u5206\u524D';if(s<86400)return Math.floor(s/3600)+'\u65F6\u524D';return Math.floor(s/86400)+'\u5929\u524D'}
  function dur(d){if(!d)return '';var m=Math.floor(d/60),s=d%60;return m+':'+(s<10?'0':'')+s}
  function card(row){
    var a=el('div','card');a.style.cursor='pointer';a.addEventListener('click',function(){openModal(row)})
    var th=el('div','thumb')
    if(row.cover){var im=el('img');im.loading='lazy';im.src=row.cover;im.alt='';th.appendChild(im)}
    th.appendChild(el('span','hot','\u{1F525}'+(row.hits||1)))
    var d=dur(row.duration);if(d)th.appendChild(el('span','dur',d))
    var dl=el('a','datalink','\u{1F4CA}');dl.href='/work?platform='+encodeURIComponent(row.platform)+'&id='+encodeURIComponent(row.video_id);dl.title='\u6570\u636E\u5206\u6790';dl.addEventListener('click',function(e){e.stopPropagation()});th.appendChild(dl)
    a.appendChild(th)
    var info=el('div','info')
    info.appendChild(el('div','who',row.author||'\u672A\u77E5\u4F5C\u8005'))
    info.appendChild(el('div','ttl',row.description||'(\u65E0\u6807\u9898)'))
    info.appendChild(el('div','when',ago(row.updated_at)))
    a.appendChild(info)
    return a
  }
  async function load(){
    statusEl.textContent='\u52A0\u8F7D\u4E2D\u2026';grid.innerHTML='';pager.innerHTML=''
    try{
      var r=await fetch('/api/discover?sort='+sort+'&page='+page+'&limit=12')
      var j=await r.json();var rows=j.data||[]
      statusEl.textContent=j.total?('\u5171 '+j.total+' \u6761 \xB7 \u7B2C '+j.page+'/'+j.pages+' \u9875'):'\u8FD8\u6CA1\u6709\u89E3\u6790\u8BB0\u5F55\uFF0C\u53BB\u89E3\u6790\u53F0\u8BD5\u8BD5'
      rows.forEach(function(row){grid.appendChild(card(row))})
      if(j.pages>1){
        var prev=el('button',null,'\u2190 \u4E0A\u4E00\u9875');prev.disabled=j.page<=1;prev.addEventListener('click',function(){page--;load()})
        var next=el('button',null,'\u4E0B\u4E00\u9875 \u2192');next.disabled=j.page>=j.pages;next.addEventListener('click',function(){page++;load()})
        pager.appendChild(prev);pager.appendChild(el('span',null,j.page+' / '+j.pages));pager.appendChild(next)
      }
    }catch(e){statusEl.textContent='\u52A0\u8F7D\u5931\u8D25\uFF1A'+e.message}
  }
  function setSort(s){if(sort===s)return;sort=s;page=1;$('#tabRecent').classList.toggle('on',s==='recent');$('#tabHot').classList.toggle('on',s==='hot');load()}
  $('#tabRecent').addEventListener('click',function(){setSort('recent')})
  $('#tabHot').addEventListener('click',function(){setSort('hot')})

  // lightbox
  var lb=$('#lb'),lbStage=$('#lbStage'),lbIdx=$('#lbIdx'),lbPrev=$('#lbPrev'),lbNext=$('#lbNext')
  var slides=[],cur=0
  function openModal(row){
    slides=[]
    if(row.play)slides=[{type:'video',url:row.play}]
    else if(row.extra&&row.extra.images&&row.extra.images.length)slides=row.extra.images.map(function(u){return{type:'image',url:u}})
    else if(row.cover)slides=[{type:'image',url:row.cover}]
    else{location.href='/?u='+encodeURIComponent(row.original_url||'');return}
    cur=0;renderSlide();lb.classList.add('on');document.body.style.overflow='hidden'
  }
  function renderSlide(){
    var s=slides[cur];lbStage.innerHTML=''
    if(s.type==='video'){var v=document.createElement('video');v.controls=true;v.autoplay=true;v.setAttribute('playsinline','');v.src=s.url;lbStage.appendChild(v)}
    else{var im=document.createElement('img');im.src=s.url;im.alt='';lbStage.appendChild(im)}
    var multi=slides.length>1
    lbPrev.style.display=multi?'':'none';lbNext.style.display=multi?'':'none'
    lbIdx.style.display=multi?'':'none';lbIdx.textContent=(cur+1)+' / '+slides.length
  }
  function go(d){if(slides.length<2)return;cur=(cur+d+slides.length)%slides.length;renderSlide()}
  function closeModal(){lb.classList.remove('on');lbStage.innerHTML='';document.body.style.overflow=''}
  lbPrev.addEventListener('click',function(e){e.stopPropagation();go(-1)})
  lbNext.addEventListener('click',function(e){e.stopPropagation();go(1)})
  $('#lbClose').addEventListener('click',closeModal)
  lb.addEventListener('click',function(e){if(e.target===lb)closeModal()})
  document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')closeModal();else if(e.key==='ArrowLeft')go(-1);else if(e.key==='ArrowRight')go(1)})
  var tx=0
  lb.addEventListener('touchstart',function(e){tx=e.changedTouches[0].clientX},{passive:true})
  lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)go(dx<0?1:-1)},{passive:true})

  load()
})();
</script>
</body>
</html>`;

// src/service/work.js
async function workApiService(request, ctx) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") || "";
  const id = url.searchParams.get("id") || "";
  if (!platform || !id) throw new HTTPException(400, { message: "platform and id required" });
  const data = await getWork(ctx, platform, id);
  if (!data) throw new HTTPException(404, { message: "not found (parse it first)" });
  return rawJsonResponse({ code: 200, ...data });
}
async function workPageService(request, ctx) {
  return new Response(PAGE2, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
var PAGE2 = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u4F5C\u54C1\u6570\u636E\u5206\u6790</title>
<style>
:root{
  --bg:#11141a;--panel:#181d27;--panel2:#1e2430;--line:#2c3442;
  --ink:#e9edf3;--muted:#8b97a8;--faint:#586273;--coral:#fb7299;--teal:#46c4ff;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 560px at 50% -10%,#221f2c 0%,transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);padding:max(20px,4vh) 18px 60px;-webkit-font-smoothing:antialiased}
.wrap{max-width:840px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--coral);margin:0}
a.back{font-family:var(--mono);font-size:11px;color:var(--faint);text-decoration:none}
a.back:hover{color:var(--teal)}
.head{display:flex;gap:18px;margin:14px 0 0;flex-wrap:wrap}
.frame{flex:0 0 200px;width:200px;aspect-ratio:3/4;border-radius:10px;overflow:hidden;background:#0e0d12;border:1px solid var(--line)}
.frame img,.frame video{width:100%;height:100%;object-fit:cover;display:block}
.meta{flex:1;min-width:240px}
.title{font-family:var(--serif);font-size:22px;line-height:1.3;margin:0}
.author{display:flex;align-items:center;gap:10px;margin:12px 0}
.author img{width:38px;height:38px;border-radius:50%;object-fit:cover;background:#0e0d12;border:1px solid var(--line)}
.author .nm{font-size:15px} .author .fo{font-family:var(--mono);font-size:11px;color:var(--faint)}
.facts{font-family:var(--mono);font-size:12px;color:var(--muted);line-height:1.9}
.acts{margin-top:12px;display:flex;gap:9px;flex-wrap:wrap}
.btn{display:inline-block;text-decoration:none;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);font-family:var(--mono);font-size:12px;padding:8px 13px;border-radius:8px}
.btn.go{border-color:var(--coral);background:var(--coral);color:#1a0c0f;font-weight:700}
.btn:hover{border-color:var(--teal);color:var(--teal)}
.now{display:flex;gap:22px;flex-wrap:wrap;margin:26px 0 0}
.kpi{display:flex;flex-direction:column}
.kpi b{font-family:var(--mono);font-size:22px}
.kpi i{font-style:normal;font-size:11px;color:var(--faint);letter-spacing:.08em}
h2{font-size:15px;margin:34px 0 6px;font-family:var(--serif);letter-spacing:.04em}
.chartwrap{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-family:var(--mono);font-size:11px}
.legend span{display:flex;align-items:center;gap:6px;color:var(--muted)}
.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
svg{width:100%;height:auto;display:block}
.hint{font-family:var(--mono);font-size:12px;color:var(--faint);margin-top:8px}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:20px 2px}
</style>
</head>
<body>
<main class=wrap>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <p class=eyebrow>\u4F5C\u54C1\u6570\u636E\u5206\u6790</p>
    <a class=back href="/discover">\u2190 \u53D1\u73B0</a>
  </div>
  <div id=app><p class=status>\u52A0\u8F7D\u4E2D\u2026</p></div>
</main>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var q=new URLSearchParams(location.search)
  var platform=q.get('platform'),id=q.get('id')
  var COLORS={play:'#3fe0c5',digg:'#ff5d6c',comment:'#e7b15a',share:'#7aa2ff',collect:'#c08bff',danmaku:'#5bd6a8',coin:'#ffd166'}
  var LABELS={play:'\u64AD\u653E',digg:'\u70B9\u8D5E',comment:'\u8BC4\u8BBA',share:'\u8F6C\u53D1',collect:'\u6536\u85CF',danmaku:'\u5F39\u5E55',coin:'\u6295\u5E01'}
  var SERIES=['play','digg','comment','share','danmaku','coin','collect']
  function fmt(n){n=Number(n)||0;return n>=10000?(n/10000).toFixed(1)+'w':String(n)}
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function tstr(ms){if(!ms)return '\u2014';var d=new Date(ms);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
  function datestr(sec){if(!sec)return '\u2014';return tstr(sec*1000).slice(0,10)}

  function lineChart(history){
    // pick series present in any snapshot
    var keys=SERIES.filter(function(k){return history.some(function(h){return h.stats&&h.stats[k]!=null})})
    var W=760,H=240,padL=8,padR=8,padT=12,padB=22
    var n=history.length
    var xs=function(i){return n<2?W/2:padL+(W-padL-padR)*i/(n-1)}
    var svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio=none>'
    // baseline
    svg+='<line x1='+padL+' y1='+(H-padB)+' x2='+(W-padR)+' y2='+(H-padB)+' stroke="#36313f" stroke-width=1/>'
    keys.forEach(function(k){
      var vals=history.map(function(h){return Number(h.stats&&h.stats[k])||0})
      var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals)
      var ys=function(v){var t=mx===mn?0.5:(v-mn)/(mx-mn);return padT+(H-padT-padB)*(1-t)}
      var d=''
      vals.forEach(function(v,i){d+=(i?'L':'M')+xs(i).toFixed(1)+' '+ys(v).toFixed(1)+' '})
      svg+='<path d="'+d+'" fill=none stroke="'+COLORS[k]+'" stroke-width=2 stroke-linejoin=round stroke-linecap=round/>'
      vals.forEach(function(v,i){svg+='<circle cx='+xs(i).toFixed(1)+' cy='+ys(v).toFixed(1)+' r=2.5 fill="'+COLORS[k]+'"/>'})
    })
    svg+='</svg>'
    var legend='<div class=legend>'+keys.map(function(k){var last=history[history.length-1].stats[k];return '<span><i style="background:'+COLORS[k]+'"></i>'+LABELS[k]+' '+fmt(last)+'</span>'}).join('')+'</div>'
    var axis='<div class=hint>'+tstr(history[0].ts)+' \u2192 '+tstr(history[history.length-1].ts)+' \xB7 '+n+' \u6B21\u5FEB\u7167</div>'
    return legend+svg+axis
  }

  async function load(){
    if(!platform||!id){$('#app').innerHTML='<p class=status>\u7F3A\u5C11 platform / id</p>';return}
    try{
      var r=await fetch('/api/work?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id))
      if(r.status!==200){var j=await r.json().catch(function(){return{}});$('#app').innerHTML='<p class=status>'+(j.message||('HTTP '+r.status))+'</p>';return}
      var d=await r.json();render(d)
    }catch(e){$('#app').innerHTML='<p class=status>\u52A0\u8F7D\u5931\u8D25\uFF1A'+e.message+'</p>'}
  }
  function render(d){
    var w=d.work||{},au=d.author||{},hist=d.history||[]
    var app=$('#app');app.innerHTML=''
    var head=el('div','head')
    var frame=el('div','frame')
    if(w.play){var v=document.createElement('video');v.controls=true;v.setAttribute('playsinline','');v.preload='metadata';if(w.cover)v.poster=w.cover;v.src=w.play;frame.appendChild(v)}
    else if(w.cover){var im=el('img');im.src=w.cover;frame.appendChild(im)}
    head.appendChild(frame)
    var meta=el('div','meta')
    meta.appendChild(el('div','title',w.description||'(\u65E0\u6807\u9898)'))
    var aex=au.extra||{}
    var ab=el('div','author')
    if(au.avatar){var av=el('img');av.src=au.avatar;ab.appendChild(av)}
    var ai=el('div')
    ai.appendChild(el('div','nm',(au.name||w.author||'\u672A\u77E5\u4F5C\u8005')))
    if(aex.follower!=null)ai.appendChild(el('div','fo','\u7C89\u4E1D '+fmt(aex.follower)))
    ab.appendChild(ai);meta.appendChild(ab)
    var facts=el('div','facts')
    facts.innerHTML='\u5E73\u53F0 '+w.platform+' \xB7 '+(w.type==='image'?'\u56FE\u96C6':'\u89C6\u9891')+'<br>\u53D1\u5E03 '+datestr(w.create_time)+(w.duration?(' \xB7 \u65F6\u957F '+w.duration+'s'):'')+'<br>\u89E3\u6790 '+w.hits+' \u6B21 \xB7 \u9996\u6B21 '+tstr(w.created_at)
    meta.appendChild(facts)
    var acts=el('div','acts')
    var go=el('a','btn go','\u91CD\u65B0\u89E3\u6790(\u52A0\u4E00\u4E2A\u6570\u636E\u70B9)');go.href='/?u='+encodeURIComponent(w.original_url||'');acts.appendChild(go)
    if(w.original_url){var o=el('a','btn','\u539F\u94FE');o.href=w.original_url;o.target='_blank';o.rel='noopener';acts.appendChild(o)}
    meta.appendChild(acts)
    head.appendChild(meta)
    app.appendChild(head)
    // current stats
    var cur=hist.length?hist[hist.length-1].stats:(w.extra&&w.extra.stats)||{}
    var now=el('div','now')
    ;SERIES.forEach(function(k){if(cur[k]!=null){var c=el('div','kpi');c.appendChild(el('b',null,fmt(cur[k])));c.appendChild(el('i',null,LABELS[k]));now.appendChild(c)}})
    if(now.children.length)app.appendChild(now)
    // chart
    app.appendChild(el('h2',null,'\u6570\u636E\u8D8B\u52BF'))
    var cw=el('div','chartwrap')
    if(hist.length<2){cw.innerHTML='<div class=hint>\u5DF2\u6709 '+hist.length+' \u4E2A\u6570\u636E\u70B9\u3002\u591A\u89E3\u6790\u51E0\u6B21\uFF08\u6216\u8FC7\u6BB5\u65F6\u95F4\u518D\u89E3\u6790\uFF09\u5373\u53EF\u5F62\u6210\u8D8B\u52BF\u66F2\u7EBF\u3002</div>'}
    else cw.innerHTML=lineChart(hist)
    app.appendChild(cw)
  }
  load()
})();
</script>
</body>
</html>`;

// src/service/app.js
async function appService(request, ctx) {
  return new Response(PAGE3, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
var PAGE3 = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>\u89E3\u6790\u53F0 \xB7 \u54D4\u54E9\u54D4\u54E9</title>
<style>
:root{
  --bg:#11141a; --panel:#181d27; --panel2:#1e2430; --line:#2c3442;
  --ink:#e9edf3; --muted:#8b97a8; --faint:#586273;
  --pink:#fb7299; --blue:#46c4ff;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:radial-gradient(1100px 560px at 50% -10%, #1a2230 0%, transparent 60%), var(--bg);
  color:var(--ink); font-family:var(--sans); line-height:1.55;
  min-height:100dvh; padding:max(20px,5vh) 18px 60px; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:760px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--pink);margin:0 0 10px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(40px,11vw,76px);line-height:.95;margin:0;letter-spacing:.04em}
.sub{color:var(--muted);margin:14px 0 0;font-size:15px}
.keyrow{display:flex;justify-content:flex-end;margin:20px 0 0}
.keylink{background:transparent;border:0;color:var(--faint);font-family:var(--mono);font-size:11px;letter-spacing:.22em;cursor:pointer;padding:4px 2px}
.keylink:hover{color:var(--blue)}
.keywrap{margin:10px 0 0}
.keywrap input{width:100%;background:var(--panel);border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:13px;padding:11px 13px;border-radius:9px;letter-spacing:.04em}
input:focus-visible,textarea:focus-visible{outline:2px solid var(--blue);outline-offset:1px;border-color:transparent}
.slot{position:relative;margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.slot::before{content:"\u94FE\u63A5\u6295\u9012\u53E3";position:absolute;top:0;left:0;right:0;height:34px;line-height:34px;padding:0 14px;font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--muted);background:repeating-linear-gradient(45deg,var(--panel2),var(--panel2) 9px,#222a36 9px,#222a36 18px);border-bottom:1px dashed var(--line)}
textarea{width:100%;min-height:120px;resize:vertical;border:0;background:transparent;color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.7;padding:46px 15px 56px;display:block}
textarea::placeholder{color:var(--faint)}
.slot .go{position:absolute;right:12px;bottom:12px;border:0;cursor:pointer;background:var(--pink);color:#2a0d16;font-family:var(--mono);font-weight:700;font-size:13px;letter-spacing:.12em;padding:9px 18px;border-radius:8px}
.slot .go:active{transform:translateY(1px)}
.status{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--muted);margin:14px 2px;min-height:1.4em}
.status::before{content:"\u203A ";color:var(--faint)}
.status.load,.status.ok{color:var(--blue)} .status.err{color:var(--pink)} .status.warn{color:#e7b15a}
#out{margin-top:6px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;animation:scan .42s cubic-bezier(.2,.7,.2,1)}
@keyframes scan{from{clip-path:inset(0 0 100% 0);opacity:.4}to{clip-path:inset(0 0 0 0);opacity:1}}
@media(prefers-reduced-motion:reduce){.card{animation:none}}
.frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#000;border:1px solid var(--line)}
.frame video,.frame img{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.nick{font-family:var(--serif);font-size:19px;margin-top:12px}
.desc{color:var(--muted);font-size:14px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
.stats{display:flex;gap:18px;flex-wrap:wrap;margin:12px 0 0}
.stat{display:flex;flex-direction:column;line-height:1.2}
.stat b{font-family:var(--mono);font-size:15px} .stat i{font-style:normal;font-size:11px;color:var(--faint);letter-spacing:.08em}
.acts{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}
.btn{display:inline-block;cursor:pointer;text-decoration:none;border:1px solid var(--pink);background:var(--pink);color:#2a0d16;font-family:var(--mono);font-weight:700;font-size:12px;letter-spacing:.06em;padding:9px 14px;border-radius:8px}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--blue);color:var(--blue)}
pre#raw{margin-top:14px;background:#0e1117;border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;font-family:var(--mono);font-size:11.5px;color:var(--muted);max-height:300px}
footer{margin-top:34px;font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.08em}
footer a{color:var(--muted)}
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI \u89E3\u7801</p>
  <h1>\u89E3\u6790\u53F0</h1>
  <p class=sub>\u7C98\u8D34\u54D4\u54E9\u54D4\u54E9\u89C6\u9891\u94FE\u63A5 / \u5206\u4EAB\u53E3\u4EE4\uFF0C\u53D6\u56DE\u89C6\u9891\u3001\u97F3\u9891\u4E0E\u5C01\u9762\u3002</p>
  <div class=keyrow><button id=keytoggle type=button class=keylink>\u5BC6\u94A5</button></div>
  <div id=keywrap class=keywrap hidden><input id=key type=password autocomplete=off spellcheck=false placeholder="\u8BBF\u95EE\u5BC6\u94A5"></div>
  <div class=slot>
    <textarea id=paste placeholder="\u628A B \u7AD9\u94FE\u63A5\u7C98\u5230\u8FD9\u91CC\uFF0C\u4E00\u7C98\u5C31\u89E3\u6790\u2026&#10;\u4F8B\uFF1Ahttps://www.bilibili.com/video/BVxxxxxxxxxx \u6216 https://b23.tv/xxxxxx"></textarea>
    <button id=go class=go>\u89E3\u6790</button>
  </div>
  <p id=status class=status>\u7B49\u5F85\u94FE\u63A5</p>
  <div id=out></div>
  <footer>\u81EA\u6258\u7BA1\u4E8E RandallFlare \xB7 <a href="/discover">\u53D1\u73B0</a> \xB7 <a href="/admin">\u6863\u6848</a> \xB7 <a href="/docs">\u63A5\u53E3\u6587\u6863</a></footer>
</main>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var KEY='bili_key'
  var keyInput=$('#key'),pasteBox=$('#paste'),statusEl=$('#status'),out=$('#out'),goBtn=$('#go')
  var keytoggle=$('#keytoggle'),keywrap=$('#keywrap')
  try{var k=localStorage.getItem(KEY);if(k){keyInput.value=k;keywrap.hidden=false}}catch(e){}
  keyInput.addEventListener('input',function(){try{localStorage.setItem(KEY,keyInput.value)}catch(e){}})
  keytoggle.addEventListener('click',function(){keywrap.hidden=!keywrap.hidden;if(!keywrap.hidden)keyInput.focus()})

  function extractUrl(t){var m=String(t||'').match(/https?:\\/\\/[^\\s]+/);if(m)return m[0];var b=String(t||'').match(/BV[0-9A-Za-z]{10}/);return b?b[0]:''}
  function setStatus(s,kind){statusEl.textContent=s;statusEl.className='status'+(kind?' '+kind:'')}
  function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
  function fmt(n){n=Number(n)||0;return n>=10000?(n/10000).toFixed(1)+'w':String(n)}

  var inflight=0,lastGuest=false
  async function parse(text){
    var url=extractUrl(text)
    if(!url){setStatus('\u6CA1\u627E\u5230\u94FE\u63A5\uFF0C\u786E\u8BA4\u7C98\u7684\u662F B \u7AD9\u94FE\u63A5','warn');return}
    var key=(keyInput.value||'').trim();lastGuest=!key
    var my=++inflight;setStatus('\u89E3\u7801\u4E2D\u2026'+(key?'':'\uFF08\u6E38\u5BA2\u6A21\u5F0F\uFF09'),'load');out.innerHTML=''
    try{
      var api='/api/hybrid/video_data?minimal=true&proxy=1&url='+encodeURIComponent(url)
      if(key)api+='&token='+encodeURIComponent(key)
      var r=await fetch(api);var j=await r.json()
      if(my!==inflight)return
      if(r.status===429){setStatus((j&&j.message)||'\u6E38\u5BA2\u6B21\u6570\u5DF2\u8FBE\u4E0A\u9650\uFF0C\u7A0D\u540E\u518D\u8BD5\u6216\u586B\u5165\u5BC6\u94A5','warn');return}
      if(r.status!==200){setStatus('\u5931\u8D25\uFF1A'+((j&&j.message)||('HTTP '+r.status)),'err');return}
      render(j.data);setStatus(key?'\u5DF2\u89E3\u7801':'\u5DF2\u89E3\u7801\uFF08\u6E38\u5BA2 \xB7 \u94FE\u63A5\u4E34\u65F6\u6709\u6548\uFF09','ok')
    }catch(e){if(my===inflight)setStatus('\u7F51\u7EDC\u9519\u8BEF\uFF1A'+e.message,'err')}
  }

  function withDownload(href){return href+(href.indexOf('?')>-1?'&':'?')+'download=1'}
  function dlBtn(href,label){var a=el('a','btn',label);a.href=withDownload(href);a.setAttribute('download','');return a}
  function copyBtn(text,label){var b=el('button','btn ghost',label);b.addEventListener('click',function(){navigator.clipboard.writeText(text).then(function(){var o=b.textContent;b.textContent='\u5DF2\u590D\u5236';setTimeout(function(){b.textContent=o},1200)})});return b}
  function stat(label,n){var w=el('span','stat');w.appendChild(el('b',null,fmt(n)));w.appendChild(el('i',null,label));return w}

  function render(d){
    out.innerHTML=''
    if(!d){setStatus('\u7A7A\u7ED3\u679C','warn');return}
    var vd=d.video_data||{}
    var card=el('div','card')
    var frame=el('div','frame')
    var cover=d.cover_data&&d.cover_data.cover?d.cover_data.cover:''
    if(vd.mp4_url){var v=el('video');v.controls=true;v.setAttribute('playsinline','');v.preload='metadata';if(cover)v.poster=cover;v.src=vd.mp4_url;frame.appendChild(v)}
    else if(cover){var im=el('img');im.src=cover;im.loading='lazy';frame.appendChild(im)}
    card.appendChild(frame)
    card.appendChild(el('div','nick',(d.author&&d.author.name)||'\u672A\u77E5\u4F5C\u8005'))
    if(d.desc)card.appendChild(el('div','desc',d.desc))
    if(d.statistics){var s=d.statistics,st=el('div','stats')
      st.appendChild(stat('\u64AD\u653E',s.view));st.appendChild(stat('\u5F39\u5E55',s.danmaku));st.appendChild(stat('\u70B9\u8D5E',s.like));st.appendChild(stat('\u6295\u5E01',s.coin));st.appendChild(stat('\u6536\u85CF',s.favorite))
      card.appendChild(st)}
    var acts=el('div','acts')
    if(vd.mp4_url)acts.appendChild(dlBtn(vd.mp4_url,'\u4E0B\u8F7D\u89C6\u9891(MP4)'))
    if(vd.video_url)acts.appendChild(dlBtn(vd.video_url,'\u9AD8\u6E05\u89C6\u9891(\u65E0\u97F3)'))
    if(vd.audio_url)acts.appendChild(dlBtn(vd.audio_url,'\u97F3\u9891'))
    if(vd.mp4_url)acts.appendChild(copyBtn(vd.mp4_url,'\u590D\u5236\u76F4\u94FE'))
    if(!lastGuest){var raw=el('button','btn ghost','\u539F\u59CB JSON');raw.addEventListener('click',function(){var p=$('#raw');if(!p){p=el('pre');p.id='raw';out.appendChild(p)}p.textContent=JSON.stringify(d,null,2)});acts.appendChild(raw)}
    card.appendChild(acts)
    out.appendChild(card)
  }

  pasteBox.addEventListener('paste',function(){setTimeout(function(){parse(pasteBox.value)},0)})
  goBtn.addEventListener('click',function(){parse(pasteBox.value)})
  pasteBox.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='Enter')parse(pasteBox.value)})
  var pre=new URLSearchParams(location.search).get('u');if(pre){pasteBox.value=pre;if((keyInput.value||'').trim())parse(pre)}
})();
</script>
</body>
</html>`;

// src/service/docs.js
async function docsService(request, ctx) {
  return new Response(DOCS_HTML.replace("{{TOKEN_SOURCE}}", ctx.config.auth.tokenSource), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
var DOCS_HTML = `<!doctype html>
<html lang=zh>
<head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Bilibili API</title>
<style>
  body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#1c1c1e;background:#fbfbfa}
  h1{font-size:24px;margin-bottom:4px} h2{font-size:17px;margin-top:30px;border-bottom:1px solid #e5e3df;padding-bottom:6px}
  code{background:#f0eeea;padding:1px 5px;border-radius:4px;font-size:13px}
  .route{margin:6px 0} .m{display:inline-block;width:42px;font-weight:600;color:#8a6d3b}
  .lock{color:#b94a48} small{color:#8a857c} a{color:#3b6ea5}
</style></head>
<body>
<h1>Bilibili API</h1>
<small>RandallFlare worker \xB7 token source: <code>{{TOKEN_SOURCE}}</code> \xB7 <a href="/">\u89E3\u6790\u53F0</a> \xB7 <a href="/admin">\u6863\u6848</a></small>

<h2>\u9274\u6743 / Auth</h2>
<p>\u5E26 <span class=lock>\u{1F512}</span> \u7684\u63A5\u53E3\u9700 <code>?token=&lt;BILI_API_TOKEN&gt;</code> \u6216 <code>?auth=HMAC-SHA1(secret,"{platform}{route}{primaryId}")</code>\uFF08hex\uFF09\u3002<br>
\u89E3\u6790\u63A5\u53E3 <code>/api/hybrid/video_data</code> \u5141\u8BB8\u6E38\u5BA2\uFF08\u65E0 token\uFF0C\u6309 IP \u9650\u6D41\uFF0C\u8FD4\u56DE\u4E34\u65F6\u4EE3\u7406\u94FE\u63A5\uFF0C\u62FF\u4E0D\u5230\u539F\u59CB JSON\uFF09\u3002</p>

<h2>Bilibili Web <small>/api/bilibili/web</small></h2>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_one_video?bv_id=</code> <small>\u89C6\u9891\u8BE6\u60C5(view)</small></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_video_playurl?bv_id=&cid=&qn=80&fnval=4048</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_video_parts?bv_id=</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_user_profile?uid=</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_user_post_videos?uid=&pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_com_popular?pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_video_comments?bv_id=&pn=1</code> \xB7 <code>/fetch_comment_reply?bv_id=&rpid=&pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/fetch_live_room_detail?room_id=</code></div>
<div class=route><span class=m>GET</span> <code>/bv_to_aid?bv_id=</code></div>

<h2>\u89E3\u6790 / Hybrid <small>/api/hybrid</small></h2>
<div class=route><span class=m>GET</span> <code>/video_data?url=&minimal=false&refresh=0&proxy=0</code> <small>\u6E38\u5BA2\u53EF\u7528</small></div>
<small>minimal=true \u8FD4\u56DE\u7CBE\u7B80\u7ED3\u6784\uFF08mp4_url \u5408\u5E76\u53EF\u64AD / video_url \u9AD8\u6E05\u65E0\u97F3 / audio_url \u97F3\u9891 / cover\uFF09\uFF1Bproxy=1 \u6539\u5199\u4E3A /proxy \u7F13\u5B58\u94FE\u63A5\u3002</small>

<h2>\u53CD\u4EE3 + \u7F13\u5B58 <small>/proxy</small></h2>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/proxy?platform=bilibili&id=&kind=mp4|video|audio|cover&download=0</code></div>
<small>\u6309 id \u7A33\u5B9A\u7F13\u5B58\u5230 R2\uFF08\u9700\u7ED1 <code>BILI_R2</code>\uFF09\uFF0C\u81EA\u52A8\u52A0 bilibili Referer \u9632\u76D7\u94FE\uFF0C\u652F\u6301 Range\u3002\u5143\u6570\u636E JSON \u7F13\u5B58\u5728 <code>meta/bilibili/{bvid}.json</code>\u3002</small>

<h2>\u4E0B\u8F7D / Download</h2>
<div class=route><span class=m>GET</span><span class=lock>\u{1F512}</span> <code>/download?url=</code> <small>\u5408\u5E76 MP4 \u76F4\u63A5\u4E0B\u8F7D</small></div>

</body></html>`;

// src/router.js
async function router(request, ctx) {
  const url = new URL(request.url);
  const prefix = ctx.config.http.prefix;
  let pathname = url.pathname;
  if (prefix && pathname.startsWith(prefix)) {
    pathname = pathname.slice(prefix.length);
  }
  if (pathname === "") pathname = "/";
  if (pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }
  if (pathname === "/" && request.method === "GET") {
    return appService(request, ctx);
  }
  if (pathname === "/docs" && request.method === "GET") {
    return docsService(request, ctx);
  }
  if (pathname === "/admin" && request.method === "GET") {
    return adminPageService(request, ctx);
  }
  if (pathname === "/api/admin/recent" && request.method === "GET") {
    return adminRecentService(request, ctx);
  }
  if (pathname === "/discover" && request.method === "GET") {
    return discoverPageService(request, ctx);
  }
  if (pathname === "/api/discover" && request.method === "GET") {
    return discoverApiService(request, ctx);
  }
  if (pathname === "/work" && request.method === "GET") {
    return workPageService(request, ctx);
  }
  if (pathname === "/api/work" && request.method === "GET") {
    return workApiService(request, ctx);
  }
  if (pathname.startsWith("/api/bilibili/web/")) {
    return bilibiliWebService(pathname.slice("/api/bilibili/web/".length), request, ctx);
  }
  if (pathname.startsWith("/api/hybrid/")) {
    return hybridService(pathname.slice("/api/hybrid/".length), request, ctx);
  }
  if (pathname === "/download") {
    return downloadService(request, ctx);
  }
  if (pathname === "/proxy") {
    return proxyService(request, ctx);
  }
  throw new HTTPException(404, { message: `No route for ${pathname}` });
}

// src/config.js
var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};
function buildConfig(env) {
  env = env || {};
  return {
    http: {
      prefix: env.HTTP_PREFIX || ""
    },
    auth: {
      token: env.BILI_API_TOKEN || "token",
      tokenSource: env.BILI_API_TOKEN ? "env" : "default"
    },
    bili: {
      // Bilibili cookie — strongly recommended (wbi + higher quality
      // playurl). Without it, view works but playurl is limited.
      cookie: env.BILI_COOKIE || "",
      userAgent: env.DEFAULT_USER_AGENT || DEFAULT_UA
    },
    // R2 bucket binding for caching media bytes + metadata JSON.
    mediaR2: env.BILI_R2 || env.MEDIA_R2 || null,
    // D1 database binding for the query log (/admin).
    d1: env.BILI_D1 || env.DB || null,
    // KV namespace binding for guest rate limiting (preferred over D1).
    kv: env.BILI_KV || env.KV || null,
    cache: {
      metaTtl: toNumber(env.META_CACHE_TTL, 3600)
    },
    guest: {
      enabled: !["0", "false", "no", "off"].includes(String(env.GUEST_ENABLED ?? "").toLowerCase()),
      limit: toNumber(env.GUEST_RATE_LIMIT, 20),
      windowSec: toNumber(env.GUEST_RATE_WINDOW, 3600),
      linkTtlSec: toNumber(env.GUEST_LINK_TTL, 7200)
    },
    log: {
      level: env.LOG_LEVEL || "info"
    },
    rawEnv: env
  };
}
var config_default = buildConfig({});

// src/worker.js
var CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "access-control-max-age": "86400"
};
function addCorsHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
var handler = withRequestLogger(withErrorHandler(router));
var worker_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const config = buildConfig(env);
    const innerCtx = {
      config,
      env,
      waitUntil: typeof ctx?.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : null
    };
    const response = await handler(request, innerCtx);
    return addCorsHeaders(response);
  }
};
export {
  worker_default as default,
  logger
};
