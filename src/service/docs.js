// Root docs page — plain-HTML index of the Bilibili API.

export default async function docsService (request, ctx) {
  return new Response(DOCS_HTML.replace('{{TOKEN_SOURCE}}', ctx.config.auth.tokenSource), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
}

const DOCS_HTML = `<!doctype html>
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
<small>RandallFlare worker · token source: <code>{{TOKEN_SOURCE}}</code> · <a href="/">解析台</a> · <a href="/admin">档案</a></small>

<h2>鉴权 / Auth</h2>
<p>带 <span class=lock>🔒</span> 的接口需 <code>?token=&lt;BILI_API_TOKEN&gt;</code> 或 <code>?auth=HMAC-SHA1(secret,"{platform}{route}{primaryId}")</code>（hex）。<br>
解析接口 <code>/api/hybrid/video_data</code> 允许游客（无 token，按 IP 限流，返回临时代理链接，拿不到原始 JSON）。</p>

<h2>Bilibili Web <small>/api/bilibili/web</small></h2>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_one_video?bv_id=</code> <small>视频详情(view)</small></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_video_playurl?bv_id=&cid=&qn=80&fnval=4048</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_video_parts?bv_id=</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_user_profile?uid=</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_user_post_videos?uid=&pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_com_popular?pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_video_comments?bv_id=&pn=1</code> · <code>/fetch_comment_reply?bv_id=&rpid=&pn=1</code></div>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/fetch_live_room_detail?room_id=</code></div>
<div class=route><span class=m>GET</span> <code>/bv_to_aid?bv_id=</code></div>

<h2>解析 / Hybrid <small>/api/hybrid</small></h2>
<div class=route><span class=m>GET</span> <code>/video_data?url=&minimal=false&refresh=0&proxy=0</code> <small>游客可用</small></div>
<small>minimal=true 返回精简结构（mp4_url 合并可播 / video_url 高清无音 / audio_url 音频 / cover）；proxy=1 改写为 /proxy 缓存链接。</small>

<h2>反代 + 缓存 <small>/proxy</small></h2>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/proxy?platform=bilibili&id=&kind=mp4|video|audio|cover&download=0</code></div>
<small>按 id 稳定缓存到 R2（需绑 <code>BILI_R2</code>），自动加 bilibili Referer 防盗链，支持 Range。元数据 JSON 缓存在 <code>meta/bilibili/{bvid}.json</code>。</small>

<h2>下载 / Download</h2>
<div class=route><span class=m>GET</span><span class=lock>🔒</span> <code>/download?url=</code> <small>合并 MP4 直接下载</small></div>

</body></html>`
