// Author page — profile + follower trend + the author's parsed works.
// Public, read-only from D1 (no upstream, no token).
import { rawJsonResponse } from '../utils/respond.js'
import { getAuthor } from '../utils/db.js'
import { HTTPException } from '../utils/http-exception.js'

export async function authorApiService (request, ctx) {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') || ''
  const id = url.searchParams.get('id') || ''
  if (!platform || !id) throw new HTTPException(400, { message: 'platform and id required' })
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 24))
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const data = await getAuthor(ctx, platform, id, limit, (page - 1) * limit)
  if (!data) throw new HTTPException(404, { message: 'author not found (parse one of their works first)' })
  return rawJsonResponse({ code: 200, page, limit, pages: Math.ceil(data.total / limit) || 1, ...data })
}

export async function authorPageService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>作者主页</title>
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
.wrap{max-width:1000px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--coral);margin:0}
a.back{font-family:var(--mono);font-size:11px;color:var(--faint);text-decoration:none}
a.back:hover{color:var(--teal)}
.hd{display:flex;gap:18px;align-items:center;margin:16px 0 0;flex-wrap:wrap}
.hd .av{width:84px;height:84px;border-radius:50%;object-fit:cover;background:#0e0d12;border:1px solid var(--line);flex:0 0 84px}
.hd .nm{font-family:var(--serif);font-size:26px;margin:0}
.hd .sub{font-family:var(--mono);font-size:12px;color:var(--muted);margin-top:6px}
.hd .sig{font-size:13px;color:var(--muted);margin-top:8px;max-width:560px;white-space:pre-wrap}
.trend{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:22px}
.trend .cap{font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:8px}
svg{width:100%;height:170px;display:block}
h2{font-size:15px;margin:30px 0 12px;font-family:var(--serif);letter-spacing:.04em}
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
.who{font-family:var(--mono);font-size:11px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ttl{font-size:13px;margin-top:3px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pager{display:flex;gap:10px;justify-content:center;margin-top:24px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.pager button{font-family:var(--mono);font-size:12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 14px;border-radius:8px}
.pager button:disabled{opacity:.35}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:20px 2px}
.lb{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(8,7,11,.92);backdrop-filter:blur(6px)}
.lb.on{display:flex}
.lb-stage{position:relative;max-width:min(1000px,94vw);max-height:90vh;display:flex;align-items:center;justify-content:center}
.lb-stage video,.lb-stage img{max-width:94vw;max-height:90vh;border-radius:10px;display:block;background:#000}
.lb-close{position:fixed;top:16px;right:18px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:20px;cursor:pointer}
.lb-nav{position:fixed;top:50%;transform:translateY(-50%);width:48px;height:64px;border:0;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-size:26px;cursor:pointer}
.lb-prev{left:14px}.lb-next{right:14px}
.lb-idx{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:12px;color:#cdd6e2;background:rgba(8,7,11,.6);padding:4px 12px;border-radius:999px}
</style>
</head>
<body>
<main class=wrap>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <p class=eyebrow>作者主页</p>
    <a class=back href="/discover">← 发现</a>
  </div>
  <div id=app><p class=status>加载中…</p></div>
</main>
<div id=lb class=lb><button class=lb-close id=lbClose>×</button><button class="lb-nav lb-prev" id=lbPrev>‹</button><div class=lb-stage id=lbStage></div><button class="lb-nav lb-next" id=lbNext>›</button><div class=lb-idx id=lbIdx></div></div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var q=new URLSearchParams(location.search)
  var platform=q.get('platform'),id=q.get('id'),page=Math.max(1,Number(q.get('page'))||1)
  function fmt(n){n=Number(n)||0;return n>=10000?(n/10000).toFixed(1)+'w':String(n)}
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function tstr(ms){if(!ms)return '—';var d=new Date(ms);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
  function followerChart(fh){
    var vals=fh.map(function(p){return Number(p.follower)||0}),n=fh.length
    var W=760,H=150,padL=8,padR=8,padT=12,padB=18
    var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals)
    var xs=function(i){return n<2?W/2:padL+(W-padL-padR)*i/(n-1)}
    var ys=function(v){var t=mx===mn?0.5:(v-mn)/(mx-mn);return padT+(H-padT-padB)*(1-t)}
    var d='';vals.forEach(function(v,i){d+=(i?'L':'M')+xs(i).toFixed(1)+' '+ys(v).toFixed(1)+' '})
    var svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio=none>'
    svg+='<path d="'+d+'" fill=none stroke="#ff5d6c" stroke-width=2 stroke-linejoin=round/>'
    vals.forEach(function(v,i){svg+='<circle cx='+xs(i).toFixed(1)+' cy='+ys(v).toFixed(1)+' r=2.5 fill="#ff5d6c"/>'})
    svg+='</svg>'
    return '<div class=cap>粉丝趋势 '+tstr(fh[0].ts)+' → '+tstr(fh[n-1].ts)+' · 当前 '+fmt(vals[n-1])+'</div>'+svg
  }
  function card(row){
    var a=el('div','card');a.addEventListener('click',function(){openModal(row)})
    var th=el('div','thumb')
    if(row.cover){var im=el('img');im.loading='lazy';im.src=row.cover;th.appendChild(im)}
    th.appendChild(el('span','badge',row.type==='image'?'图集':'视频'))
    th.appendChild(el('span','hot','🔥'+(row.hits||1)))
    var dl=el('a','datalink','📊');dl.href='/work?platform='+encodeURIComponent(row.platform)+'&id='+encodeURIComponent(row.video_id);dl.addEventListener('click',function(e){e.stopPropagation()});th.appendChild(dl)
    a.appendChild(th)
    var info=el('div','info');info.appendChild(el('div','who',tstr((row.create_time||0)*1000)));info.appendChild(el('div','ttl',row.description||'(无标题)'));a.appendChild(info)
    return a
  }
  async function load(){
    if(!platform||!id){$('#app').innerHTML='<p class=status>缺少 platform / id</p>';return}
    try{
      var r=await fetch('/api/author?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id)+'&page='+page+'&limit=24')
      if(r.status!==200){var j=await r.json().catch(function(){return{}});$('#app').innerHTML='<p class=status>'+(j.message||('HTTP '+r.status))+'</p>';return}
      render(await r.json())
    }catch(e){$('#app').innerHTML='<p class=status>加载失败：'+e.message+'</p>'}
  }
  function render(d){
    var au=d.author||{},ex=au.extra||{},works=d.works||[],fh=d.follower_history||[]
    var app=$('#app');app.innerHTML=''
    var hd=el('div','hd')
    if(au.avatar){var av=el('img','av');av.src=au.avatar;hd.appendChild(av)}
    var box=el('div')
    box.appendChild(el('div','nm',au.name||'未知作者'))
    var sub='平台 '+platform+(ex.follower!=null?(' · 粉丝 '+fmt(ex.follower)):'')+' · 站内收录 '+d.total+' 个作品'
    box.appendChild(el('div','sub',sub))
    if(ex.signature)box.appendChild(el('div','sig',ex.signature))
    hd.appendChild(box);app.appendChild(hd)
    if(fh.length>=2){var tr=el('div','trend');tr.innerHTML=followerChart(fh);app.appendChild(tr)}
    app.appendChild(el('h2',null,'作品 ('+d.total+')'))
    var grid=el('div','grid');works.forEach(function(w){grid.appendChild(card(w))});app.appendChild(grid)
    if(d.pages>1){var pg=el('div','pager')
      var pv=el('button',null,'← 上一页');pv.disabled=page<=1;pv.addEventListener('click',function(){location.search='?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id)+'&page='+(page-1)})
      var nx=el('button',null,'下一页 →');nx.disabled=page>=d.pages;nx.addEventListener('click',function(){location.search='?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id)+'&page='+(page+1)})
      pg.appendChild(pv);pg.appendChild(el('span',null,page+' / '+d.pages));pg.appendChild(nx);app.appendChild(pg)}
  }
  // lightbox
  var lb=$('#lb'),lbStage=$('#lbStage'),lbIdx=$('#lbIdx'),lbPrev=$('#lbPrev'),lbNext=$('#lbNext'),slides=[],cur=0
  function openModal(row){slides=[];if(row.play)slides=[{type:'video',url:row.play}];else if(row.extra&&row.extra.images&&row.extra.images.length)slides=row.extra.images.map(function(u){return{type:'image',url:u}});else if(row.cover)slides=[{type:'image',url:row.cover}];else return;cur=0;rs();lb.classList.add('on');document.body.style.overflow='hidden'}
  function rs(){var s=slides[cur];lbStage.innerHTML='';if(s.type==='video'){var v=document.createElement('video');v.controls=true;v.setAttribute('playsinline','');v.autoplay=true;v.src=s.url;lbStage.appendChild(v)}else{var im=document.createElement('img');im.src=s.url;lbStage.appendChild(im)}var m=slides.length>1;lbPrev.style.display=m?'':'none';lbNext.style.display=m?'':'none';lbIdx.style.display=m?'':'none';lbIdx.textContent=(cur+1)+' / '+slides.length}
  function go(dr){if(slides.length<2)return;cur=(cur+dr+slides.length)%slides.length;rs()}
  function close(){lb.classList.remove('on');lbStage.innerHTML='';document.body.style.overflow=''}
  lbPrev.addEventListener('click',function(e){e.stopPropagation();go(-1)});lbNext.addEventListener('click',function(e){e.stopPropagation();go(1)})
  $('#lbClose').addEventListener('click',close);lb.addEventListener('click',function(e){if(e.target===lb)close()})
  document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')go(-1);else if(e.key==='ArrowRight')go(1)})
  var tx=0;lb.addEventListener('touchstart',function(e){tx=e.changedTouches[0].clientX},{passive:true});lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)go(dx<0?1:-1)},{passive:true})
  load()
})();
</script>
</body>
</html>`
