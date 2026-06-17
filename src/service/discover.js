// Public "发现" gallery — recent parses straight from the D1 log (no
// upstream re-request, no token). Sortable by 热度 (hits) or 最近.
// Thumbnails/links are the cached /proxy URLs stored at parse time.
import { rawJsonResponse } from '../utils/respond.js'
import { discoverQueries } from '../utils/db.js'

export async function discoverApiService (request, ctx) {
  const url = new URL(request.url)
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'recent'
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 12))
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const { rows, total } = await discoverQueries(ctx, sort, limit, (page - 1) * limit)
  return rawJsonResponse({ code: 200, sort, page, limit, total, pages: Math.ceil(total / limit) || 1, count: rows.length, data: rows })
}

export async function discoverPageService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>发现 · 哔哩哔哩解析</title>
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
.dur{position:absolute;right:8px;bottom:8px;font-family:var(--mono);font-size:10px;background:rgba(17,20,26,.82);color:#cdd6e2;padding:2px 6px;border-radius:5px}
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
</style>
</head>
<body>
<main class=wrap>
  <p class=eyebrow>BILIBILI 发现</p>
  <h1>大家在解析</h1>
  <p class=sub>最近被解析的视频，直接来自缓存——点开即看，不再打扰原站。</p>
  <div class=bar>
    <button class="tab on" data-sort=recent id=tabRecent>最近</button>
    <button class=tab data-sort=hot id=tabHot>热度</button>
    <span class=spacer></span>
    <a href="/">← 去解析</a>
  </div>
  <p id=status class=status>加载中…</p>
  <div id=grid class=grid></div>
  <div id=pager class=pager></div>
  <footer>自托管于 RandallFlare · <a href="/">解析台</a> · <a href="/docs">接口</a></footer>
</main>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var grid=$('#grid'),statusEl=$('#status'),pager=$('#pager')
  var sort='recent',page=1
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function ago(ms){var s=Math.floor((Date.now()-ms)/1000);if(s<60)return s+'秒前';if(s<3600)return Math.floor(s/60)+'分前';if(s<86400)return Math.floor(s/3600)+'时前';return Math.floor(s/86400)+'天前'}
  function dur(d){if(!d)return '';var m=Math.floor(d/60),s=d%60;return m+':'+(s<10?'0':'')+s}
  function card(row){
    var href=row.play||('/?u='+encodeURIComponent(row.original_url||''))
    var a=el('a','card');a.href=href;if(row.play){a.target='_blank';a.rel='noopener'}
    var th=el('div','thumb')
    if(row.cover){var im=el('img');im.loading='lazy';im.src=row.cover;im.alt='';th.appendChild(im)}
    th.appendChild(el('span','hot','🔥'+(row.hits||1)))
    var d=dur(row.duration);if(d)th.appendChild(el('span','dur',d))
    a.appendChild(th)
    var info=el('div','info')
    info.appendChild(el('div','who',row.author||'未知作者'))
    info.appendChild(el('div','ttl',row.description||'(无标题)'))
    info.appendChild(el('div','when',ago(row.updated_at)))
    a.appendChild(info)
    return a
  }
  async function load(){
    statusEl.textContent='加载中…';grid.innerHTML='';pager.innerHTML=''
    try{
      var r=await fetch('/api/discover?sort='+sort+'&page='+page+'&limit=12')
      var j=await r.json();var rows=j.data||[]
      statusEl.textContent=j.total?('共 '+j.total+' 条 · 第 '+j.page+'/'+j.pages+' 页'):'还没有解析记录，去解析台试试'
      rows.forEach(function(row){grid.appendChild(card(row))})
      if(j.pages>1){
        var prev=el('button',null,'← 上一页');prev.disabled=j.page<=1;prev.addEventListener('click',function(){page--;load()})
        var next=el('button',null,'下一页 →');next.disabled=j.page>=j.pages;next.addEventListener('click',function(){page++;load()})
        pager.appendChild(prev);pager.appendChild(el('span',null,j.page+' / '+j.pages));pager.appendChild(next)
      }
    }catch(e){statusEl.textContent='加载失败：'+e.message}
  }
  function setSort(s){if(sort===s)return;sort=s;page=1;$('#tabRecent').classList.toggle('on',s==='recent');$('#tabHot').classList.toggle('on',s==='hot');load()}
  $('#tabRecent').addEventListener('click',function(){setSort('recent')})
  $('#tabHot').addEventListener('click',function(){setSort('hot')})
  load()
})();
</script>
</body>
</html>`
