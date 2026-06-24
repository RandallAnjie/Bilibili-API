// Work detail — richer source info for one parsed work: author, publish
// time, current stats, and a line chart of stats captured across parses
// (作品数据分析). Public, read-only from D1 (no upstream, no token).
import { rawJsonResponse } from '../utils/respond.js'
import { getWork } from '../utils/db.js'
import { HTTPException } from '../utils/http-exception.js'

export async function workApiService (request, ctx) {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') || ''
  const id = url.searchParams.get('id') || ''
  if (!platform || !id) throw new HTTPException(400, { message: 'platform and id required' })
  const data = await getWork(ctx, platform, id)
  if (!data) throw new HTTPException(404, { message: 'not found (parse it first)' })
  return rawJsonResponse({ code: 200, ...data })
}

export async function workPageService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>作品数据分析</title>
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
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
.chip{font-family:var(--mono);font-size:11px;color:var(--teal);border:1px solid var(--line);border-radius:999px;padding:2px 9px;text-decoration:none}
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
svg{width:100%;height:220px;display:block}
.hint{font-family:var(--mono);font-size:12px;color:var(--faint);margin-top:8px}
.status{font-family:var(--mono);font-size:12px;color:var(--muted);margin:20px 2px}
.cmts{display:flex;flex-direction:column;gap:12px;margin-top:8px}
.cmt{display:flex;gap:10px}
.cmt img{width:32px;height:32px;border-radius:50%;object-fit:cover;background:#0e0d12;border:1px solid var(--line);flex:0 0 32px}
.cmt .cb{min-width:0}
.cmt .ca{font-family:var(--mono);font-size:12px;color:var(--teal)}
.cmt .ct{font-size:14px;margin:2px 0;word-break:break-word}
.cmt .cm{font-family:var(--mono);font-size:11px;color:var(--faint)}
.creps{margin:8px 0 2px;padding-left:12px;border-left:2px solid var(--line);display:flex;flex-direction:column;gap:10px}
.creps .cmt img{width:26px;height:26px;flex:0 0 26px}
</style>
</head>
<body>
<main class=wrap>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <p class=eyebrow>作品数据分析</p>
    <a class=back href="/discover">← 发现</a>
  </div>
  <div id=app><p class=status>加载中…</p></div>
</main>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}
  var q=new URLSearchParams(location.search)
  var platform=q.get('platform'),id=q.get('id')
  var COLORS={play:'#3fe0c5',digg:'#ff5d6c',comment:'#e7b15a',share:'#7aa2ff',collect:'#c08bff',danmaku:'#5bd6a8',coin:'#ffd166'}
  var LABELS={play:'播放',digg:'点赞',comment:'评论',share:'转发',collect:'收藏',danmaku:'弹幕',coin:'投币'}
  var SERIES=['play','digg','comment','share','danmaku','coin','collect']
  function fmt(n){n=Number(n)||0;return n>=10000?(n/10000).toFixed(1)+'w':String(n)}
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function tstr(ms){if(!ms)return '—';var d=new Date(ms);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
  function datestr(sec){if(!sec)return '—';return tstr(sec*1000).slice(0,10)}

  function lineChart(history){
    var allKeys=SERIES.filter(function(k){return history.some(function(h){return Number(h.stats&&h.stats[k])>0})})
    if(!allKeys.length)return '<div class=hint>暂无可用数据</div>'
    // merge all snapshots within the same hour into one point (latest wins)
    var hist=[],lastB=null
    history.forEach(function(h){var b=Math.floor(h.ts/3600000);if(b===lastB)hist[hist.length-1]=h;else{hist.push(h);lastB=b}})
    // keep only metrics that actually move
    var keys=allKeys.filter(function(k){var vs=hist.map(function(h){return Number(h.stats&&h.stats[k])||0});return Math.min.apply(null,vs)!==Math.max.apply(null,vs)})
    if(hist.length<2||!keys.length)return '<div class=hint>数据暂无明显变化（'+hist.length+' 个不同快照）。等数值随时间变化后会出现趋势曲线。</div>'
    var W=760,H=220,padL=8,padR=8,padT=14,padB=18,inner=H-padT-padB
    var n=hist.length
    var t0=hist[0].ts,tN=hist[n-1].ts,span=tN-t0
    var xs=function(i){return n<2?W/2:(span>0?padL+(W-padL-padR)*((hist[i].ts-t0)/span):padL+(W-padL-padR)*i/(n-1))}
    var svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio=none>'
    svg+='<line x1='+padL+' y1='+(H-padB)+' x2='+(W-padR)+' y2='+(H-padB)+' stroke="#36313f" stroke-width=1 />'
    keys.forEach(function(k){
      var vals=hist.map(function(h){return Number(h.stats&&h.stats[k])||0})
      var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals)
      var ys=function(v){var t=mx===mn?0.5:(v-mn)/(mx-mn);return padT+inner*(1-t)}
      var d=''
      vals.forEach(function(v,i){d+=(i?'L':'M')+xs(i).toFixed(1)+' '+ys(v).toFixed(1)+' '})
      svg+='<path d="'+d+'" fill=none stroke="'+COLORS[k]+'" stroke-width=2 stroke-linejoin=round stroke-linecap=round />'
      vals.forEach(function(v,i){svg+='<circle cx='+xs(i).toFixed(1)+' cy='+ys(v).toFixed(1)+' r=2.5 fill="'+COLORS[k]+'" />'})
    })
    svg+='</svg>'
    var legend='<div class=legend>'+keys.map(function(k){return '<span><i style="background:'+COLORS[k]+'"></i>'+LABELS[k]+' '+fmt(hist[n-1].stats[k])+'</span>'}).join('')+'</div>'
    var axis='<div class=hint>'+tstr(hist[0].ts)+' → '+tstr(hist[n-1].ts)+' · '+n+' 个有变化的数据点（每条线按各自范围缩放）</div>'
    return legend+svg+axis
  }

  async function load(){
    if(!platform||!id){$('#app').innerHTML='<p class=status>缺少 platform / id</p>';return}
    try{
      var r=await fetch('/api/work?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id))
      if(r.status!==200){var j=await r.json().catch(function(){return{}});$('#app').innerHTML='<p class=status>'+(j.message||('HTTP '+r.status))+'</p>';return}
      var d=await r.json();render(d)
    }catch(e){$('#app').innerHTML='<p class=status>加载失败：'+e.message+'</p>'}
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
    meta.appendChild(el('div','title',w.description||'(无标题)'))
    var aex=au.extra||{}
    var ab=el('div','author')
    if(au.avatar){var av=el('img');av.src=au.avatar;ab.appendChild(av)}
    var ai=el('div')
    if(w.author_id){var na=el('a','nm',(au.name||w.author||'未知作者'));na.href='/author?platform='+encodeURIComponent(w.platform)+'&id='+encodeURIComponent(w.author_id);na.style.color='var(--ink)';na.style.textDecoration='none';ai.appendChild(na)}
    else ai.appendChild(el('div','nm',(au.name||w.author||'未知作者')))
    if(aex.follower!=null)ai.appendChild(el('div','fo','粉丝 '+fmt(aex.follower)))
    ab.appendChild(ai);meta.appendChild(ab)
    var facts=el('div','facts')
    facts.innerHTML='平台 '+w.platform+' · '+(w.type==='image'?'图集':'视频')+'<br>发布 '+datestr(w.create_time)+(w.duration?(' · 时长 '+w.duration+'s'):'')+'<br>解析 '+w.hits+' 次 · 首次 '+tstr(w.created_at)
    meta.appendChild(facts)
    if(Array.isArray(w.parts)&&w.parts.length>1)meta.appendChild(el('div','facts','分P '+w.parts.length+' 个'))
    if(Array.isArray(w.tags)&&w.tags.length){var tg=el('div','chips');w.tags.slice(0,15).forEach(function(t){var c=el('a','chip','#'+t);c.href='/search?q='+encodeURIComponent(t);tg.appendChild(c)});meta.appendChild(tg)}
    var acts=el('div','acts')
    var go=el('a','btn go','重新解析(加一个数据点)');go.href='/?u='+encodeURIComponent(w.original_url||'');acts.appendChild(go)
    if(w.original_url){var o=el('a','btn','原链');o.href=w.original_url;o.target='_blank';o.rel='noopener';acts.appendChild(o)}
    meta.appendChild(acts)
    head.appendChild(meta)
    app.appendChild(head)
    // current stats
    var cur=hist.length?hist[hist.length-1].stats:(w.extra&&w.extra.stats)||{}
    var now=el('div','now')
    ;SERIES.forEach(function(k){if(cur[k]!=null){var c=el('div','kpi');c.appendChild(el('b',null,fmt(cur[k])));c.appendChild(el('i',null,LABELS[k]));now.appendChild(c)}})
    if(now.children.length)app.appendChild(now)
    // chart
    app.appendChild(el('h2',null,'数据趋势'))
    var cw=el('div','chartwrap')
    if(hist.length<2){cw.innerHTML='<div class=hint>已有 '+hist.length+' 个数据点。多解析几次（或过段时间再解析）即可形成趋势曲线。</div>'}
    else cw.innerHTML=lineChart(hist)
    app.appendChild(cw)
    // comments
    app.appendChild(el('h2',null,'热门评论'))
    var cm=el('div','cmts');cm.id='cmts';cm.appendChild(el('div','hint','加载中…'));app.appendChild(cm)
    loadComments(w.platform,w.video_id)
  }
  async function loadComments(platform,id){
    var box=$('#cmts');if(!box)return
    try{
      var r=await fetch('/api/comments?platform='+encodeURIComponent(platform)+'&id='+encodeURIComponent(id)+'&limit=30')
      var j=await r.json();var rows=j.data||[]
      box.innerHTML=''
      if(!rows.length){box.appendChild(el('div','hint','暂无评论（或正在抓取，稍后刷新）'));return}
      function cmt(c){
        var it=el('div','cmt')
        if(c.avatar){var im=el('img');im.referrerPolicy='no-referrer';im.src=c.avatar;im.loading='lazy';it.appendChild(im)}
        var b=el('div','cb')
        b.appendChild(el('div','ca',c.author||'匿名'))
        b.appendChild(el('div','ct',c.text||''))
        b.appendChild(el('div','cm','赞 '+fmt(c.likes)+(c.ctime?(' · '+datestr(c.ctime)):'')))
        if(c.replies&&c.replies.length){var rep=el('div','creps');c.replies.forEach(function(s){rep.appendChild(cmt(s))});b.appendChild(rep)}
        it.appendChild(b);return it
      }
      rows.forEach(function(c){box.appendChild(cmt(c))})
    }catch(e){box.innerHTML='<div class=hint>评论加载失败：'+e.message+'</div>'}
  }
  load()
})();
</script>
</body>
</html>`
