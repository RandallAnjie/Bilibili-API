// Parser front-end — "解析台" (Bilibili). Paste a B站 link / share text;
// it parses via /api/hybrid/video_data (same origin), plays the combined
// mp4 inline and offers video / audio / cover downloads. The access key
// (BILI_API_TOKEN) is optional — without it you're a rate-limited guest.

export default async function appService (request, ctx) {
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang=zh>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>解析台 · 哔哩哔哩</title>
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
.slot::before{content:"链接投递口";position:absolute;top:0;left:0;right:0;height:34px;line-height:34px;padding:0 14px;font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--muted);background:repeating-linear-gradient(45deg,var(--panel2),var(--panel2) 9px,#222a36 9px,#222a36 18px);border-bottom:1px dashed var(--line)}
textarea{width:100%;min-height:120px;resize:vertical;border:0;background:transparent;color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.7;padding:46px 15px 56px;display:block}
textarea::placeholder{color:var(--faint)}
.slot .go{position:absolute;right:12px;bottom:12px;border:0;cursor:pointer;background:var(--pink);color:#2a0d16;font-family:var(--mono);font-weight:700;font-size:13px;letter-spacing:.12em;padding:9px 18px;border-radius:8px}
.slot .go:active{transform:translateY(1px)}
.status{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--muted);margin:14px 2px;min-height:1.4em}
.status::before{content:"› ";color:var(--faint)}
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
  <p class=eyebrow>BILIBILI 解码</p>
  <h1>解析台</h1>
  <p class=sub>粘贴哔哩哔哩视频链接 / 分享口令，取回视频、音频与封面。</p>
  <div class=keyrow><button id=keytoggle type=button class=keylink>密钥</button></div>
  <div id=keywrap class=keywrap hidden><input id=key type=password autocomplete=off spellcheck=false placeholder="访问密钥"></div>
  <div class=slot>
    <textarea id=paste placeholder="把 B 站链接粘到这里，一粘就解析…&#10;例：https://www.bilibili.com/video/BVxxxxxxxxxx 或 https://b23.tv/xxxxxx"></textarea>
    <button id=go class=go>解析</button>
  </div>
  <p id=status class=status>等待链接</p>
  <div id=out></div>
  <footer>自托管于 RandallFlare · <a href="/admin">档案</a> · <a href="/docs">接口文档</a></footer>
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
    if(!url){setStatus('没找到链接，确认粘的是 B 站链接','warn');return}
    var key=(keyInput.value||'').trim();lastGuest=!key
    var my=++inflight;setStatus('解码中…'+(key?'':'（游客模式）'),'load');out.innerHTML=''
    try{
      var api='/api/hybrid/video_data?minimal=true&proxy=1&url='+encodeURIComponent(url)
      if(key)api+='&token='+encodeURIComponent(key)
      var r=await fetch(api);var j=await r.json()
      if(my!==inflight)return
      if(r.status===429){setStatus((j&&j.message)||'游客次数已达上限，稍后再试或填入密钥','warn');return}
      if(r.status!==200){setStatus('失败：'+((j&&j.message)||('HTTP '+r.status)),'err');return}
      render(j.data);setStatus(key?'已解码':'已解码（游客 · 链接临时有效）','ok')
    }catch(e){if(my===inflight)setStatus('网络错误：'+e.message,'err')}
  }

  function withDownload(href){return href+(href.indexOf('?')>-1?'&':'?')+'download=1'}
  function dlBtn(href,label){var a=el('a','btn',label);a.href=withDownload(href);a.setAttribute('download','');return a}
  function copyBtn(text,label){var b=el('button','btn ghost',label);b.addEventListener('click',function(){navigator.clipboard.writeText(text).then(function(){var o=b.textContent;b.textContent='已复制';setTimeout(function(){b.textContent=o},1200)})});return b}
  function stat(label,n){var w=el('span','stat');w.appendChild(el('b',null,fmt(n)));w.appendChild(el('i',null,label));return w}

  function render(d){
    out.innerHTML=''
    if(!d){setStatus('空结果','warn');return}
    var vd=d.video_data||{}
    var card=el('div','card')
    var frame=el('div','frame')
    var cover=d.cover_data&&d.cover_data.cover?d.cover_data.cover:''
    if(vd.mp4_url){var v=el('video');v.controls=true;v.setAttribute('playsinline','');v.preload='metadata';if(cover)v.poster=cover;v.src=vd.mp4_url;frame.appendChild(v)}
    else if(cover){var im=el('img');im.src=cover;im.loading='lazy';frame.appendChild(im)}
    card.appendChild(frame)
    card.appendChild(el('div','nick',(d.author&&d.author.name)||'未知作者'))
    if(d.desc)card.appendChild(el('div','desc',d.desc))
    if(d.statistics){var s=d.statistics,st=el('div','stats')
      st.appendChild(stat('播放',s.view));st.appendChild(stat('弹幕',s.danmaku));st.appendChild(stat('点赞',s.like));st.appendChild(stat('投币',s.coin));st.appendChild(stat('收藏',s.favorite))
      card.appendChild(st)}
    var acts=el('div','acts')
    if(vd.mp4_url)acts.appendChild(dlBtn(vd.mp4_url,'下载视频(MP4)'))
    if(vd.video_url)acts.appendChild(dlBtn(vd.video_url,'高清视频(无音)'))
    if(vd.audio_url)acts.appendChild(dlBtn(vd.audio_url,'音频'))
    if(vd.mp4_url)acts.appendChild(copyBtn(vd.mp4_url,'复制直链'))
    if(!lastGuest){var raw=el('button','btn ghost','原始 JSON');raw.addEventListener('click',function(){var p=$('#raw');if(!p){p=el('pre');p.id='raw';out.appendChild(p)}p.textContent=JSON.stringify(d,null,2)});acts.appendChild(raw)}
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
</html>`
