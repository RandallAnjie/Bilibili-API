// Public in-site search over the D1 aggregation index (title/author/tags).
import { rawJsonResponse } from '../utils/respond.js'
import { searchQueries } from '../utils/db.js'

export async function searchApiService (request, ctx) {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim()
  const platform = url.searchParams.get('platform') || ''
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 12))
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  if (!q) return rawJsonResponse({ code: 200, q, page, total: 0, pages: 1, data: [] })
  const { rows, total } = await searchQueries(ctx, q, platform || undefined, limit, (page - 1) * limit)
  return rawJsonResponse({ code: 200, q, page, limit, total, pages: Math.ceil(total / limit) || 1, count: rows.length, data: rows })
}

export async function searchPageService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>搜索 · Bilibili 解析</title>
<style>
:root{
  --bg:#11141a;--panel:#181d27;--panel2:#1e2430;--line:#2c3442;
  --ink:#e9edf3;--muted:#8b97a8;--faint:#586273;--coral:#fb7299;--teal:#46c4ff;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#221f2c 0%,transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);padding:max(20px,4vh) 18px 60px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--coral);margin:0 0 8px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(34px,9vw,60px);line-height:.95;margin:0;letter-spacing:.04em}
.box{display:flex;gap:8px;margin:22px 0 18px}
.box input{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--ink);font-size:15px;padding:12px 15px;border-radius:10px}
.box input:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
.box button{border:1px solid var(--coral);background:var(--coral);color:#1a0c0f;font-family:var(--mono);font-weight:700;font-size:13px;padding:0 20px;border-radius:10px;cursor:pointer}
.bar a{font-family:var(--mono);font-size:11px;color:var(--faint);text-decoration:none;margin-right:14px}
.bar a:hover{color:var(--teal)}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:6px 2px 16px;min-height:1.3em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.card{display:block;cursor:pointer;text-decoration:none;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.card:hover{border-color:var(--teal)}
.thumb{position:relative;width:100%;aspect-ratio:3/4;background:#0e0d12;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.badge{position:absolute;left:8px;top:8px;font-family:var(--mono);font-size:10px;background:rgba(20,18,26,.8);color:var(--teal);padding:2px 7px;border-radius:5px}
.hot{position:absolute;right:8px;top:8px;font-family:var(--mono);font-size:10px;background:rgba(255,93,108,.9);color:#1a0c0f;font-weight:700;padding:2px 7px;border-radius:5px}
.datalink{position:absolute;right:8px;bottom:8px;font-size:13px;background:rgba(20,18,26,.8);padding:3px 7px;border-radius:6px;text-decoration:none}
.datalink:hover{background:var(--teal)}
.info{padding:10px}
.who{font-family:var(--mono);font-size:11px;color:var(--teal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ttl{font-size:13px;margin-top:3px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pager{display:flex;gap:10px;justify-content:center;margin-top:24px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.pager button{font-family:var(--mono);font-size:12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 14px;border-radius:8px}
.pager button:disabled{opacity:.35}
.lb{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(8,7,11,.92);backdrop-filter:blur(6px)}
.lb.on{display:flex}
.lb-stage{position:relative;max-width:min(1000px,94vw);max-height:90vh;display:flex;align-items:center;justify-content:center}
.lb-stage video,.lb-stage img{max-width:94vw;max-height:90vh;border-radius:10px;display:block;background:#000}
.lb-close{position:fixed;top:16px;right:18px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:20px;cursor:pointer}
.lb-nav{position:fixed;top:50%;transform:translateY(-50%);width:48px;height:64px;border:0;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-size:26px;cursor:pointer}
.lb-prev{left:14px}.lb-next{right:14px}
.lb-idx{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:12px;color:#cdd6e2;background:rgba(8,7,11,.6);padding:4px 12px;border-radius:999px}
footer{margin-top:30px;font-family:var(--mono);font-size:11px;color:var(--faint)}
footer a{color:var(--muted)}
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI 搜索</p>
  <h1>站内搜索</h1>
  <div class=box><input id=q placeholder="搜标题 / UP主 / 分区…" autofocus><button id=go>搜索</button></div>
  <div class=bar><a href="/discover">发现</a><a href="/">解析台</a></div>
  <p id=status class=status></p>
  <div id=grid class=grid></div>
  <div id=pager class=pager></div>
  <footer>自托管于 RandallFlare · 仅搜索站内已解析的内容</footer>
</main>
<div id=lb class=lb><button class=lb-close id=lbClose>×</button><button class="lb-nav lb-prev" id=lbPrev>‹</button><div class=lb-stage id=lbStage></div><button class="lb-nav lb-next" id=lbNext>›</button><div class=lb-idx id=lbIdx></div></div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var grid=$('#grid'),statusEl=$('#status'),pager=$('#pager'),qIn=$('#q')
  var q='',page=1
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function card(row){
    var a=el('div','card');a.addEventListener('click',function(){openModal(row)})
    var th=el('div','thumb')
    if(row.cover){var im=el('img');im.loading='lazy';im.src=row.cover;th.appendChild(im)}
    th.appendChild(el('span','badge',row.type==='image'?'图集':'视频'))
    th.appendChild(el('span','hot','🔥'+(row.hits||1)))
    var dl=el('a','datalink','📊');dl.href='/work?platform='+encodeURIComponent(row.platform)+'&id='+encodeURIComponent(row.video_id);dl.addEventListener('click',function(e){e.stopPropagation()});th.appendChild(dl)
    a.appendChild(th)
    var info=el('div','info')
    if(row.author_id){var wa=el('a','who',row.author||'未知作者');wa.href='/author?platform='+encodeURIComponent(row.platform)+'&id='+encodeURIComponent(row.author_id);wa.style.textDecoration='none';wa.addEventListener('click',function(e){e.stopPropagation()});info.appendChild(wa)}
    else info.appendChild(el('div','who',row.author||'未知作者'))
    info.appendChild(el('div','ttl',row.description||'(无标题)'));a.appendChild(info)
    return a
  }
  async function run(p){
    page=p||1;q=(qIn.value||'').trim()
    if(!q){statusEl.textContent='输入关键词搜索';grid.innerHTML='';pager.innerHTML='';return}
    history.replaceState(null,'','/search?q='+encodeURIComponent(q))
    statusEl.textContent='搜索中…';grid.innerHTML='';pager.innerHTML=''
    try{
      var r=await fetch('/api/search?q='+encodeURIComponent(q)+'&page='+page+'&limit=12')
      var jj=await r.json();var rows=jj.data||[]
      statusEl.textContent=jj.total?('“'+q+'” 共 '+jj.total+' 条 · 第 '+jj.page+'/'+jj.pages+' 页'):'没搜到“'+q+'”，换个词或先去解析'
      rows.forEach(function(row){grid.appendChild(card(row))})
      if(jj.pages>1){var pv=el('button',null,'← 上一页');pv.disabled=jj.page<=1;pv.addEventListener('click',function(){run(page-1)});var nx=el('button',null,'下一页 →');nx.disabled=jj.page>=jj.pages;nx.addEventListener('click',function(){run(page+1)});pager.appendChild(pv);pager.appendChild(el('span',null,jj.page+' / '+jj.pages));pager.appendChild(nx)}
    }catch(e){statusEl.textContent='搜索失败：'+e.message}
  }
  $('#go').addEventListener('click',function(){run(1)})
  qIn.addEventListener('keydown',function(e){if(e.key==='Enter')run(1)})
  // lightbox (shared shape with discover)
  var lb=$('#lb'),lbStage=$('#lbStage'),lbIdx=$('#lbIdx'),lbPrev=$('#lbPrev'),lbNext=$('#lbNext'),slides=[],cur=0
  function openModal(row){slides=[];if(row.play)slides=[{type:'video',url:row.play}];else if(row.extra&&row.extra.images&&row.extra.images.length)slides=row.extra.images.map(function(u){return{type:'image',url:u}});else if(row.cover)slides=[{type:'image',url:row.cover}];else return;cur=0;rs();lb.classList.add('on');document.body.style.overflow='hidden'}
  function rs(){var s=slides[cur];lbStage.innerHTML='';if(s.type==='video'){var v=document.createElement('video');v.controls=true;v.setAttribute('playsinline','');v.autoplay=true;v.src=s.url;lbStage.appendChild(v)}else{var im=document.createElement('img');im.src=s.url;lbStage.appendChild(im)}var m=slides.length>1;lbPrev.style.display=m?'':'none';lbNext.style.display=m?'':'none';lbIdx.style.display=m?'':'none';lbIdx.textContent=(cur+1)+' / '+slides.length}
  function go(d){if(slides.length<2)return;cur=(cur+d+slides.length)%slides.length;rs()}
  function close(){lb.classList.remove('on');lbStage.innerHTML='';document.body.style.overflow=''}
  lbPrev.addEventListener('click',function(e){e.stopPropagation();go(-1)});lbNext.addEventListener('click',function(e){e.stopPropagation();go(1)})
  $('#lbClose').addEventListener('click',close);lb.addEventListener('click',function(e){if(e.target===lb)close()})
  document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')go(-1);else if(e.key==='ArrowRight')go(1)})
  var tx=0;lb.addEventListener('touchstart',function(e){tx=e.changedTouches[0].clientX},{passive:true});lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)go(dx<0?1:-1)},{passive:true})
  // init from ?q=
  var pre=new URLSearchParams(location.search).get('q');if(pre){qIn.value=pre;run(1)}
})();
</script>
</body>
</html>`
