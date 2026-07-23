# -*- coding: utf-8 -*-
"""
build_appjs.py — 从 v1 gen_website.py 的 HTML_BODY 脚本生成第二版 assets/app.js。
策略：复用 v1 全部渲染/交互逻辑（保证视觉与行为与第一版一致），仅替换数据层：
  - 删除内嵌的 INDEX/LAWS/READ/LAW_TITLES（改为启动 fetch manifest.json）
  - 检索视图懒加载 search.json（INDEX -> searchData）
  - openLaw / exportCurrent / downloadLibrary 改为按需 fetch 法规 md 并 parseMd 渲染
  - 新增 parseMd（md -> READ 兼容结构）、ensureSearch、boot
"""
import os, re

BASE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(BASE, '..', 'law-knowledge-base', 'scripts', 'gen_website.py')
OUT = os.path.join(BASE, 'assets', 'app.js')

src = open(GEN, encoding='utf-8').read()
marker = "HTML_BODY = r'''"
i = src.index(marker) + len(marker)
j = src.index("'''", i)
html_body = src[i:j]
js = html_body[html_body.index('<script>')+len('<script>'): html_body.rindex('</script>')]

# ---- 1) 全局替换 INDEX -> searchData ----
js = js.replace('INDEX', 'searchData')

# ---- 2) 头部声明块（数据全局 + 第二版新增函数） ----
PREAMBLE = r'''
/* ===== 第二版：数据加载层（替代 v1 内嵌数据） ===== */
let LAWS=[], LAW_TITLES=[], READ={}, LAW_BY_TITLE={}, searchData=null, searchLoading=null;
const RE_ART_MD=/^###\s*第[一二三四五六七八九十百零0-9]+[条款]/;
function fetchLawMd(law){
  return fetch(encodeURI('./'+law.file), {cache:'force-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); });
}
function parseMd(md){
  const lines = md.split(/\r?\n/);
  let i=0;
  if(lines[0] && lines[0].trim()==='---'){ for(i=1;i<lines.length;i++){ if(lines[i].trim()==='---'){ i++; break; } } }
  const chapters=[]; let curCh=null; let curArt=null; let buf=[]; const topNotes=[]; let inBody=false;
  function pushLead(){ if(curArt) return; if(buf.length){ const lead=buf.join('\n').trim(); if(lead){ if(!curCh) curCh={title:'（未分章）',articles:[]}; curCh.articles.push({article:'', content:lead, section:true}); } buf=[]; } }
  function flushArt(){ pushLead(); if(curArt){ curArt.content=buf.join('\n').trim(); curCh.articles.push(curArt); curArt=null; } buf=[]; }
  function flushCh(){ if(curArt) flushArt(); else pushLead(); if(curCh) chapters.push(curCh); curCh=null; buf=[]; }
  for(;i<lines.length;i++){
    let line=lines[i];
    if(line.startsWith('>')){ const t=line.replace(/^>\s?/,''); if(!inBody) topNotes.push(t); else if(curArt!==null) buf.push(line); continue; }
    if(line.startsWith('###')){ inBody=true; const m=line.trim(); flushArt(); if(!curCh) curCh={title:'（未分章）',articles:[]}; curArt={article:m.slice(3).trim(), content:'', section: !RE_ART_MD.test(m)}; continue; }
    if(line.startsWith('##')){ inBody=true; flushCh(); curCh={title:line.trim().slice(2).trim(), articles:[]}; continue; }
    if(line.startsWith('#')){ continue; }
    buf.push(line);
  }
  flushCh();
  return {chapters:chapters, topNotes:topNotes};
}
async function getScopeMds(){
  const titles=dlScopeTitles();
  const out={};
  await Promise.all(titles.map(async function(t){
    try{ const law=LAW_BY_TITLE[t]; if(!law) return; out[t]=await fetchLawMd(law); }catch(e){}
  }));
  return out;
}
async function ensureSearch(){
  if(searchData) return searchData;
  if(searchLoading) return searchLoading;
  searchLoading = fetch(encodeURI('./data/search.json'), {cache:'force-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(d){ searchData=d; return d; });
  return searchLoading;
}
async function boot(){
  try{
    const r=await fetch(encodeURI('./data/manifest.json'), {cache:'force-cache'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    LAWS=await r.json();
  }catch(e){
    const v=document.getElementById('view'); if(v) v.innerHTML='<div class="law-fetch-err">⚠️ 无法加载 manifest.json：'+(e&&e.message?e.message:e)+'<br>请通过本地服务器或 GitHub Pages 访问（直接双击打开 file:// 会被浏览器安全策略拦截，无法读取 md）。</div>';
    return;
  }
  LAW_TITLES=LAWS.map(function(l){return l.title;});
  LAW_BY_TITLE={}; LAWS.forEach(function(l){ LAW_BY_TITLE[l.title]=l; });
  toggleCollapseAll(); renderSidebar();
  const qs=new URLSearchParams(location.search);
  const q=qs.get('q');
  if(q){ const t=document.getElementById('topq'); if(t) t.value=q; if(qs.get('ai')){ doAI(); } else { doSearch(); } return; }
  if(location.hash){ try{ const t=decodeURIComponent(location.hash.slice(1)); if(LAW_BY_TITLE[t]){ openLaw(t); return; } }catch(e){} }
  renderHome();
}
'''

# ---- 3) openLaw 改写（async fetch + parseMd） ----
OLD_OPENLAW = '''function openLaw(title){
  state.law=title; state.view='read';
  tocExpandedCh.clear(); tocAllExpanded=false;
  // 定位：自动展开当前法规所在的层级与地区
  const lw=getLaw(title);
  if(lw){
    treeCollapsed.delete(lw.level);
    if(lw.region){ const rp=lw.region.split('/'); let acc=''; rp.forEach(p=>{ acc=acc?acc+'/'+p:p; regionCollapsed.delete(acc); }); }
  }
  renderSidebar();
  renderRead(title);
  const bsInp=document.getElementById('bodySearch'); if(bsInp) bsInp.value='';
  const bsCnt=document.getElementById('bsCount'); if(bsCnt) bsCnt.textContent='';
  renderToc(title);          // 填充右侧大纲
  startScrollSpy();          // 滚动高亮当前章节
  showToc('docked', false);  // 阅读时默认停靠显示大纲
  window.scrollTo(0,0);
  // 左侧树滚动到当前法规位置
  const cur=document.querySelector('.tnode.law.cur'); if(cur) cur.scrollIntoView({block:'nearest'});
}'''
NEW_OPENLAW = '''async function openLaw(title){
  state.law=title; state.view='read';
  tocExpandedCh.clear(); tocAllExpanded=false;
  const lw=getLaw(title);
  if(lw){
    treeCollapsed.delete(lw.level);
    if(lw.region){ const rp=lw.region.split('/'); let acc=''; rp.forEach(p=>{ acc=acc?acc+'/'+p:p; regionCollapsed.delete(acc); }); }
  }
  renderSidebar();
  const v=document.getElementById('view');
  v.innerHTML='<div class="loading">⏳ 正在加载法规正文…</div>';
  try{
    const law=LAW_BY_TITLE[title];
    const md=await fetchLawMd(law);
    const parsed=parseMd(md);
    READ[title]={ meta:{doc_number:law.doc_number, publisher:law.publisher, publish_date:law.publish_date, effective_date:law.effective_date, revise_date:law.revise_date, status:law.status, source_url:law.source_url}, chapters:parsed.chapters, topNotes:parsed.topNotes };
    renderRead(title);
    const bsInp=document.getElementById('bodySearch'); if(bsInp) bsInp.value='';
    const bsCnt=document.getElementById('bsCount'); if(bsCnt) bsCnt.textContent='';
    renderToc(title);
    startScrollSpy();
    showToc('docked', false);
    window.scrollTo(0,0);
    const cur=document.querySelector('.tnode.law.cur'); if(cur) cur.scrollIntoView({block:'nearest'});
  }catch(e){
    v.innerHTML='<div class="law-fetch-err">⚠️ 加载失败：'+(e&&e.message?e.message:e)+'<br>请确认通过本地服务器或 GitHub Pages 访问（直接双击打开 file:// 会被浏览器安全策略拦截，无法读取 md）。</div>';
  }
}'''
assert OLD_OPENLAW in js, 'openLaw old not found'
js = js.replace(OLD_OPENLAW, NEW_OPENLAW)

# ---- 4) doSearch 改写 ----
OLD_DOSEARCH = '''function doSearch(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='search'; state.law=null;
  hideRightPanel();
  recomputeMatches();
  renderSearch(); renderSidebar(); window.scrollTo(0,0);
}'''
NEW_DOSEARCH = '''async function doSearch(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='search'; state.law=null;
  hideRightPanel();
  try{ await ensureSearch(); }catch(e){}
  recomputeMatches();
  renderSearch(); renderSidebar(); window.scrollTo(0,0);
}'''
assert OLD_DOSEARCH in js, 'doSearch old not found'
js = js.replace(OLD_DOSEARCH, NEW_DOSEARCH)

# ---- 5) doAI 改写 ----
OLD_DOAI = '''function doAI(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='ai'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={};
  hideRightPanel();
  renderAI(); renderSidebar();
  if(q){ const ta=document.getElementById('aique'); if(ta) ta.value=q; askAI(); }
  window.scrollTo(0,0);
}'''
NEW_DOAI = '''async function doAI(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='ai'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={};
  hideRightPanel();
  renderAI(); renderSidebar();
  if(q){ try{ await ensureSearch(); }catch(e){} const ta=document.getElementById('aique'); if(ta) ta.value=q; askAI(); }
  window.scrollTo(0,0);
}'''
assert OLD_DOAI in js, 'doAI old not found'
js = js.replace(OLD_DOAI, NEW_DOAI)

# ---- 6) exportCurrent 改写 ----
OLD_EXPORT = '''function exportCurrent(fmt){
  var t=state.law; if(!t||!READ[t]){ alert('请先在左侧选择一部法规'); return; }
  var m=READ[t].meta||{}, ch=READ[t].chapters||[];
  if(fmt==='md'){
    var md=buildReadMD(t,m,ch);
    downloadBlob(md, safeName(t)+'.md', 'text/markdown');
  } else {
    var doc=buildReadExportHtml(t,m,ch);
    if(fmt==='doc'){
      downloadBlob(doc, safeName(t)+'.doc', 'application/msword');
    } else if(fmt==='pdf'){
      var w=window.open('','_blank');
      if(!w){ alert('浏览器拦截了打印窗口，请允许弹出窗口后重试'); return; }
      w.document.open(); w.document.write(doc); w.document.close();
      w.focus(); setTimeout(function(){ try{ w.print(); }catch(e){} }, 500);
    }
  }
  var mm=document.getElementById('expMenu'); if(mm) mm.classList.remove('show');
}'''
NEW_EXPORT = '''async function exportCurrent(fmt){
  const t=state.law; if(!t||!LAW_BY_TITLE[t]){ alert('请先在左侧选择一部法规'); return; }
  const law=LAW_BY_TITLE[t];
  let md; try{ md=await fetchLawMd(law); }catch(e){ alert('获取正文失败：'+(e&&e.message?e.message:e)); return; }
  if(fmt==='md'){ downloadBlob(md, safeName(t)+'.md', 'text/markdown'); }
  else {
    const parsed=parseMd(md);
    const m={doc_number:law.doc_number, publisher:law.publisher, publish_date:law.publish_date, effective_date:law.effective_date, revise_date:law.revise_date, status:law.status, source_url:law.source_url};
    const doc=buildReadExportHtml(t,m,parsed.chapters);
    if(fmt==='doc'){ downloadBlob(doc, safeName(t)+'.doc', 'application/msword'); }
    else if(fmt==='pdf'){ const w=window.open('','_blank'); if(!w){ alert('浏览器拦截了打印窗口，请允许弹出窗口后重试'); return; } w.document.open(); w.document.write(doc); w.document.close(); w.focus(); setTimeout(function(){ try{ w.print(); }catch(e){} }, 500); }
  }
  const mm=document.getElementById('expMenu'); if(mm) mm.classList.remove('show');
}'''
assert OLD_EXPORT in js, 'exportCurrent old not found'
js = js.replace(OLD_EXPORT, NEW_EXPORT)

# ---- 7) downloadLibrary 改写 ----
OLD_DL = '''function downloadLibrary(fmt){
  closeMenus();
  const titles=dlScopeTitles();
  if(!titles.length){ alert('当前范围没有可下载的法规'); return; }
  const scopeName = state.browseLevel || (state.library? (LIB_DEFS[state.library]||'总库') : '总库');
  const nm='工建法研-'+scopeName+'-'+today();
  if(fmt==='zip'){
    const files=titles.map(t=>({name: safeName(t)+'.md', content: buildReadMD(t, READ[t].meta, READ[t].chapters)}));
    saveBlob(new Blob([makeZip(files)], {type:'application/zip'}), nm+'.zip');
  } else if(fmt==='md'){
    const md=titles.map(t=> buildReadMD(t, READ[t].meta, READ[t].chapters)).join('\\n\\n---\\n\\n');
    downloadBlob(md, nm+'.md', 'text/markdown');
  } else {
    let html='';
    titles.forEach(t=>{ html += buildReadExportHtml(t, READ[t].meta, READ[t].chapters); });
    if(fmt==='doc') downloadBlob(html, nm+'.doc', 'application/msword');
    else if(fmt==='pdf'){ const w=window.open('','_blank'); if(!w){ alert('浏览器拦截了打印窗口，请允许弹出窗口后重试'); return; } w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>{ try{ w.print(); }catch(e){} }, 600); }
  }
}'''
NEW_DL = '''async function downloadLibrary(fmt){
  closeMenus();
  const titles=dlScopeTitles();
  if(!titles.length){ alert('当前范围没有可下载的法规'); return; }
  const scopeName = state.browseLevel || (state.library? (LIB_DEFS[state.library]||'总库') : '总库');
  const nm='工建法研-'+scopeName+'-'+today();
  const mds=await getScopeMds();
  const avail=titles.filter(function(t){return mds[t];});
  if(!avail.length){ alert('获取正文失败'); return; }
  if(fmt==='zip'){
    const files=avail.map(function(t){ return {name: safeName(t)+'.md', content: mds[t]}; });
    saveBlob(new Blob([makeZip(files)], {type:'application/zip'}), nm+'.zip');
  } else if(fmt==='md'){
    const md=avail.map(function(t){return mds[t];}).join('\\n\\n---\\n\\n');
    downloadBlob(md, nm+'.md', 'text/markdown');
  } else {
    let html='';
    avail.forEach(function(t){
      const parsed=parseMd(mds[t]);
      const law=LAW_BY_TITLE[t];
      const m={doc_number:law.doc_number, publisher:law.publisher, publish_date:law.publish_date, effective_date:law.effective_date, revise_date:law.revise_date, status:law.status, source_url:law.source_url};
      html += buildReadExportHtml(t, m, parsed.chapters);
    });
    if(fmt==='doc') downloadBlob(html, nm+'.doc', 'application/msword');
    else if(fmt==='pdf'){ const w=window.open('','_blank'); if(!w){ alert('浏览器拦截了打印窗口，请允许弹出窗口后重试'); return; } w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(function(){ try{ w.print(); }catch(e){} }, 600); }
  }
}'''
assert OLD_DL in js, 'downloadLibrary old not found'
js = js.replace(OLD_DL, NEW_DL)

# ---- 8) renderContent 增加 blockquote 处理 ----
OLD_RC_TAIL = '''  const tail=raw.slice(lastEnd).trim();
  if(tail){
    tail.split('\\n').map(s=>s.trim()).filter(Boolean).forEach(ln=>{
      const m=itemRe.exec(ln);
      if(m){ if(!inList){ html+='<ol class="subitems">'; inList=true; } html+='<li>'+esc(m[2])+'</li>'; }
      else { flush(); html+='<p>'+esc(ln)+'</p>'; }
    });
  }'''
NEW_RC_TAIL = '''  const tail=raw.slice(lastEnd).trim();
  if(tail){
    tail.split('\\n').map(s=>s.trim()).filter(Boolean).forEach(ln=>{
      if(ln.charAt(0)==='>'){ flush(); html+='<blockquote>'+esc(ln.replace(/^>\\s?/,''))+'</blockquote>'; return; }
      const m=itemRe.exec(ln);
      if(m){ if(!inList){ html+='<ol class="subitems">'; inList=true; } html+='<li>'+esc(m[2])+'</li>'; }
      else { flush(); html+='<p>'+esc(ln)+'</p>'; }
    });
  }'''
assert OLD_RC_TAIL in js, 'renderContent tail not found'
js = js.replace(OLD_RC_TAIL, NEW_RC_TAIL)

# ---- 9) 末尾 init 改为 boot() ----
OLD_INIT = '''toggleCollapseAll();   // 默认左侧目录树折叠（仅显示层级）
renderSidebar();
(function(){
  const qs=new URLSearchParams(location.search);
  const q=qs.get('q');
  if(q){ const t=document.getElementById('topq'); if(t) t.value=q; if(qs.get('ai')){ doAI(); } else { doSearch(); } return; }
  if(location.hash){ try{ const t=decodeURIComponent(location.hash.slice(1)); if(READ[t]){ openLaw(t); return; } }catch(e){} }
  renderHome();
})();'''
NEW_INIT = '''boot();'''
assert OLD_INIT in js, 'init block not found'
js = js.replace(OLD_INIT, NEW_INIT)

# ---- 10) 拼接 preamble + 修改后的 js ----
out = PREAMBLE + "\n" + js
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(out)
print('app.js bytes:', len(out))
print('contains boot():', 'async function boot(' in out)
print('contains INDEX leftover:', 'searchData' in out and 'const INDEX' not in out)
