// Public B站热榜 — the per-region 排行榜 (ranking/v2). Each category is a
// list of ~100 real videos; clicking one runs the guest parse (storing the
// work to D1 + warming media into R2) and plays it. Symmetric with the
// Douyin worker's /hot. To avoid abuse, the upstream ranking fetch runs ONLY
// in cron (refreshHotBoards), which stores each category's list in D1; the
// public API reads D1 only and never hits upstream on a cache miss.
import { rawJsonResponse } from '../utils/respond.js'
import { metaGet, metaSet } from '../utils/db.js'
import { imgProxyLink } from '../utils/proxy-link.js'
import * as bili from '../bilibili/crawler.js'

// rid -> display name. These are the stable ranking/v2 regions.
const CATS = [
  { rid: 0, name: '全站' }, { rid: 1, name: '动画' }, { rid: 3, name: '音乐' },
  { rid: 4, name: '游戏' }, { rid: 188, name: '科技' }, { rid: 119, name: '鬼畜' },
  { rid: 129, name: '舞蹈' }, { rid: 160, name: '生活' }, { rid: 181, name: '影视' },
  { rid: 168, name: '国创' }
]
const RIDS = new Set(CATS.map(c => c.rid))
const keyFor = (rid) => `hot:bili:rank:${rid}`

async function buildRanking (ctx, rid) {
  const resp = await bili.fetchRanking(ctx, rid)
  const list = resp?.data?.list || []
  return list.map((v, i) => ({
    rank: i + 1,
    bvid: v.bvid || '',
    title: v.title || '',
    up: v.owner?.name || '',
    view: v.stat?.view || 0,
    duration: v.duration || 0,
    cover: v.pic || null
  })).filter(x => x.bvid)
}

// Cron-only: refresh every category's ranking into D1. Returns the count of
// categories successfully stored. The public API never calls this path.
export async function refreshHotBoards (ctx) {
  let ok = 0
  for (const c of CATS) {
    try {
      const videos = await buildRanking(ctx, c.rid)
      if (videos.length) { await metaSet(ctx, keyFor(c.rid), JSON.stringify(videos)); ok++ }
    } catch {}
  }
  return ok
}

export async function hotApiService (request, ctx) {
  const url = new URL(request.url)
  let rid = Number(url.searchParams.get('rid'))
  if (!RIDS.has(rid)) rid = 0
  const isAdmin = url.searchParams.get('token') === ctx.config.auth.token
  let videos, updated
  const cached = await metaGet(ctx, keyFor(rid))
  if (cached) {
    try { videos = JSON.parse(cached.v); updated = cached.ts } catch {}
  }
  // Cache miss: only an admin (master token) may trigger a live fetch.
  if (!videos && isAdmin) {
    videos = await buildRanking(ctx, rid)
    updated = Date.now()
    if (videos.length) await metaSet(ctx, keyFor(rid), JSON.stringify(videos))
  }
  if (!videos) {
    return rawJsonResponse({ code: 200, rid, pending: true, updated: 0, cats: CATS, videos: [] })
  }
  const rw = (x) => ({ ...x, cover: x.cover ? imgProxyLink(request, ctx, x.cover) : null })
  return rawJsonResponse({ code: 200, rid, updated, cats: CATS, videos: videos.map(rw) })
}

export async function hotPageService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>排行榜 · 哔哩哔哩解析</title>
<style>
:root{
  --bg:#10141c;--panel:#181d28;--panel2:#1d2330;--line:#2b3342;
  --ink:#e7edf5;--muted:#8b97a8;--faint:#5a6473;--pink:#fb7299;--blue:#23ade5;--gold:#f5c451;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#1a2230 0%,transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);padding:max(20px,4vh) 18px 60px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--pink);margin:0 0 8px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(36px,9vw,64px);line-height:.95;margin:0;letter-spacing:.04em}
.sub{color:var(--muted);font-size:14px;margin:12px 0 0}
.cats{display:flex;gap:8px;align-items:center;margin:22px 0 8px;flex-wrap:wrap}
.cat{font-family:var(--mono);font-size:12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted);padding:7px 14px;border-radius:999px}
.cat.on{border-color:var(--pink);color:var(--pink)}
.nav{display:flex;gap:14px;margin:0 0 16px}
.nav a{font-family:var(--mono);font-size:11px;color:var(--faint);text-decoration:none}
.nav a:hover{color:var(--blue)}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:0 2px 16px;min-height:1.3em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.card{cursor:pointer;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;transition:border-color .15s}
.card:hover{border-color:var(--blue)}
.thumb{position:relative;width:100%;aspect-ratio:16/10;background:#0b0e14;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .rk{position:absolute;left:8px;top:8px;font-family:var(--serif);font-weight:700;font-size:15px;min-width:24px;text-align:center;background:rgba(11,14,20,.78);color:var(--ink);padding:1px 6px;border-radius:6px}
.card:nth-child(-n+3) .thumb .rk{background:var(--pink);color:#1a0c0f}
.thumb .dur{position:absolute;right:8px;bottom:8px;font-family:var(--mono);font-size:10px;background:rgba(11,14,20,.8);color:#cfd8e3;padding:1px 6px;border-radius:5px}
.thumb .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;color:rgba(255,255,255,.85);opacity:0;transition:opacity .15s}
.card:hover .play{opacity:1}
.cinfo{padding:9px 11px}
.cinfo .cd{font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cinfo .meta{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{margin-top:32px;font-family:var(--mono);font-size:11px;color:var(--faint)}
footer a{color:var(--muted)}
.lb{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,.92);backdrop-filter:blur(6px)}
.lb.on{display:flex}
.lb-stage{position:relative;max-width:min(1000px,94vw);max-height:90vh;display:flex;align-items:center;justify-content:center}
.lb-stage video,.lb-stage img{max-width:94vw;max-height:90vh;border-radius:10px;display:block;background:#000}
.lb-msg{font-family:var(--mono);font-size:13px;color:#cdd6e2}
.lb-close{position:fixed;top:16px;right:18px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:20px;cursor:pointer;line-height:40px}
.lb-close:hover{background:var(--pink);color:#1a0c0f}
.lb-cap{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);max-width:90vw;font-family:var(--mono);font-size:12px;color:#cdd6e2;background:rgba(6,8,12,.6);padding:6px 14px;border-radius:999px;text-align:center}
.lb-cap a{color:var(--blue);text-decoration:none}
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI 排行榜</p>
  <h1>正在被刷</h1>
  <p class=sub>B 站各分区此刻的排行榜。点开任意一支，自动解析入库——之后就从我们自己的库里看。</p>
  <div id=cats class=cats></div>
  <div class=nav><a href="/discover">发现</a><a href="/search">搜索</a><a href="/">← 去解析</a></div>
  <p id=status class=status>加载中…</p>
  <div id=grid class=grid></div>
  <footer>自托管于 RandallFlare · <span id=upd></span> · <a href="/">解析台</a></footer>
</main>
<div id=lb class=lb>
  <button class=lb-close id=lbClose aria-label=关闭>×</button>
  <div class=lb-stage id=lbStage></div>
  <div class=lb-cap id=lbCap></div>
</div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var grid=$('#grid'),statusEl=$('#status'),catsEl=$('#cats'),rid=0,cats=null
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function fmt(n){n=Number(n)||0;if(n>=1e8)return (n/1e8).toFixed(1)+'亿';if(n>=1e4)return (n/1e4).toFixed(1)+'万';return String(n)}
  function dur(d){d=Number(d)||0;var m=Math.floor(d/60),s=d%60;return m+':'+(s<10?'0':'')+s}
  function card(r){
    var c=el('div','card');c.addEventListener('click',function(){openVideo(r)})
    var th=el('div','thumb')
    if(r.cover){var im=el('img');im.loading='lazy';im.src=r.cover;im.alt='';th.appendChild(im)}
    th.appendChild(el('span','rk',r.rank))
    if(r.duration)th.appendChild(el('span','dur',dur(r.duration)))
    th.appendChild(el('span','play','▶'))
    c.appendChild(th)
    var info=el('div','cinfo')
    info.appendChild(el('div','cd',r.title||'(无标题)'))
    info.appendChild(el('div','meta',(r.up||'未知 UP')+' · '+fmt(r.view)+' 播放'))
    c.appendChild(info)
    return c
  }
  function renderCats(){
    catsEl.innerHTML=''
    cats.forEach(function(c){
      var b=el('button','cat'+(c.rid===rid?' on':''),c.name)
      b.addEventListener('click',function(){if(rid===c.rid)return;rid=c.rid;renderCats();load()})
      catsEl.appendChild(b)
    })
  }
  async function load(){
    statusEl.textContent='加载中…';grid.innerHTML=''
    try{
      var j=await (await fetch('/api/bilibili/hot?rid='+rid)).json()
      if(!cats){cats=j.cats||[];renderCats()}
      var rows=j.videos||[]
      if(j.updated){var d=new Date(j.updated);$('#upd').textContent='更新于 '+d.getHours()+':'+('0'+d.getMinutes()).slice(-2)}
      statusEl.textContent=rows.length?('共 '+rows.length+' 支 · 点开即自动解析入库'):(j.pending?'榜单随定时任务刷新，首次生成中，稍后再来':'暂时拉不到这个榜单，待会儿再来')
      rows.forEach(function(r){grid.appendChild(card(r))})
    }catch(e){statusEl.textContent='加载失败：'+e.message}
  }
  // Lightbox — clicking a video triggers a guest parse (stores to D1 + warms
  // media into R2), then plays the combined mp4.
  var lb=$('#lb'),lbStage=$('#lbStage'),lbCap=$('#lbCap')
  function closeLb(){lb.classList.remove('on');lbStage.innerHTML='';lbCap.innerHTML='';document.body.style.overflow=''}
  $('#lbClose').addEventListener('click',closeLb)
  lb.addEventListener('click',function(e){if(e.target===lb)closeLb()})
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&lb.classList.contains('on'))closeLb()})
  async function openVideo(r){
    lb.classList.add('on');document.body.style.overflow='hidden'
    lbStage.innerHTML='<div class=lb-msg>解析并入库中…</div>';lbCap.innerHTML=''
    try{
      var u='https://www.bilibili.com/video/'+encodeURIComponent(r.bvid)
      var j=await (await fetch('/api/hybrid/video_data?url='+encodeURIComponent(u)+'&minimal=1&proxy=1')).json()
      var o=j.data||{};var vd=o.video_data||{}
      var src=vd.mp4_url||vd.video_url||o.play
      var work='/work?platform=bilibili&id='+encodeURIComponent(r.bvid)
      lbStage.innerHTML=''
      if(src){var v=document.createElement('video');v.controls=true;v.autoplay=true;v.setAttribute('playsinline','');v.src=src;lbStage.appendChild(v)}
      else{var c=o.cover_data&&o.cover_data.cover;if(c){var ci=document.createElement('img');ci.src=c;lbStage.appendChild(ci)}else lbStage.innerHTML='<div class=lb-msg>已入库，但暂时拿不到可播放地址</div>'}
      lbCap.innerHTML='已入库 · <a href="'+work+'">查看数据分析 →</a>'
    }catch(e){lbStage.innerHTML='<div class=lb-msg>解析失败：'+(e.message||e)+'</div>'}
  }
  load()
})();
</script>
</body>
</html>`
