
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


const LEVEL_ORDER = {'法律':0,'司法解释':1,'中央行政法规':2,'中央部门规章':3,'中央规范性文件':4,'地方行政法规':5,'地方规章':6,'地方规范性文件':7,'标准规范':8,'司法案例':9,'行政案例':10,'政策解读':11};
const LEVEL_NAMES = ['法律','司法解释','中央行政法规','中央部门规章','中央规范性文件','地方行政法规','地方规章','地方规范性文件','标准规范','司法案例','行政案例','政策解读'];
let state = { view:'home', law:null, q:'', status:'全部', homeView:'table', levelFilter:null, matchedLevels:null, matchedLaws:{}, browseLevel:null, library:null, customLib:null, sort:'time_desc' };
let tocState='hidden';   // docked(停靠) | floating(悬浮) | hidden(隐藏)
let tocPeek=false;       // 是否处于「边界感应悬浮」状态（鼠标离开即收起）
let tocHideTimer=null;   // 收起延时，避免边界抖动
let tocExpandedCh=new Set();   // 右栏大纲中展开的章节索引
let tocAllExpanded=false;      // 右栏大纲「全部展开」状态（仅用于图标切换参考）
let spyObserver=null;    // 滚动高亮观察者（保留以兼容 closeLaw / resetBodyMarks 的解绑）
let spyRaf=null, spyScrollAttached=false, tocGoal=-1, tocUserTimer=null, spyTocRaf=null, tocFollowTarget=null;  // 连续滚动跟随状态（tocGoal=程序化滚动目标值，用于区分用户手动滚动）
let readBodyHtml='';     // 当前阅读视图 .read-body 的原始 HTML（用于复位高亮）
let bodyMarks=[];        // 正文搜索命中的 <mark> 元素集合
let bsCur=-1;            // 当前定位的命中项索引

function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function tokenize(q){return (q||'').trim().split(/\s+/).filter(Boolean);}
/* 空格不敏感：去掉所有空白后再比较（尤其数字+单位，如「400万」↔「400 万」） */
function normSpace(s){ return (s||'').replace(/\s+/g,''); }
/* 高亮用：关键词各字符之间允许任意空白，使「400万」也能高亮「400 万元」 */
function kwRe(k){ const parts=[...k].map(ch=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')); return new RegExp('('+parts.join('\\s*')+')','gi'); }
function hl(text,kws){
  let t=esc(text);
  kws.forEach(k=>{ if(!k) return; try{ const re=kwRe(k); t=t.replace(re,'<mark>$1</mark>'); }catch(e){} });
  return t;
}
function lvClass(lv){return (lv||'').replace(/[（）()]/g,'');}
function lawTag(e){
  return '<span class="tag '+lvClass(e.level)+'">'+e.level+'</span>'+
    '<span class="tag field">'+e.field+'</span>'+
    (e.status==='已废止'?'<span class="tag abol">已废止</span>':'<span class="tag live">现行</span>');
}
function statusTag(l){
  // 列表只展示效力状态（现行/已废止）
  return (l.status==='已废止') ? '<span class="tag abol">已废止</span>' : '<span class="tag live">现行</span>';
}

/* ============ 层级浏览筛选 / 库筛选 / 排序 / 下载 ============ */
/* 库定义与判定规则（规则自动归类，无需改数据） */
const LIB_DEFS = {'zong':'法规总库','zhujian':'住建库','shizheng':'市政给排水库','jiaotong':'交通库','zhaobiao':'招投标库','jianshe':'建设单位常用库','shigong':'施工单位常用库','difang':'地方库','custom':'自选库'};
function libMatch(key, l, custom){
  const f=(l.field||''); const title=(l.title||''); const hay=f+' '+title; const region=l.region||'';
  switch(key){
    case 'zong': return true;
    case 'zhujian': return /住建|住房|城乡建设|房地产|建筑市场|施工|工程质量|市政|城市更新|好房子/.test(hay);
    case 'shizheng': return /排水|给水|供水|防水|水务|污水|海绵|燃气|园林绿化/.test(hay);
    case 'jiaotong': return /交通|公路|桥梁|铁路|轨道/.test(hay);
    case 'zhaobiao': return /招投标|招标|投标|采购/.test(hay);
    case 'jianshe': return /招投标|招标|投标|采购|合同|造价|用地|规划|立项|发包|房地产|前期/.test(hay);
    case 'shigong': return /施工|安全|质量|资质|分包|劳务|特种作业|技术|工程总承包/.test(hay);
    case 'difang': return region && region!=='国家级';
    case 'custom':
      if(!custom) return true;
      if(custom.levels && custom.levels.size && !custom.levels.has(l.level)) return false;
      if(custom.regions && custom.regions.size && !custom.regions.has(region)) return false;
      if(custom.kw && custom.kw.trim()){ const ks=custom.kw.trim().split(/\s+/); if(!ks.some(k=>hay.indexOf(k)>=0)) return false; }
      return true;
    default: return true;
  }
}
/* 库命中数量（用于菜单展示与透明提示） */
function libCount(key){
  if(key==='zong') return LAWS.length;
  if(key==='custom') return state.customLib? LAWS.filter(l=>libMatch('custom',l,state.customLib)).length : LAWS.length;
  return LAWS.filter(l=>libMatch(key,l,null)).length;
}
/* 当前可见法规（受 层级 + 库 双重筛选） */
function currentLaws(){
  let list = LAWS.slice();
  if(state.browseLevel) list = list.filter(l=>l.level===state.browseLevel);
  if(state.library) list = list.filter(l=>libMatch(state.library, l, state.customLib));
  return list;
}
/* 左树层级点击 → 高亮该层级并筛选中间列表显示该层级；左树其余层级保持可见（不消失） */
function applyBrowseLevel(lv){
  state.browseLevel = (state.browseLevel===lv)? null : lv;
  state.view='home'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={};
  hideRightPanel(); renderHome(); renderSidebar(); window.scrollTo(0,0);
}
function clearBrowseLevel(){
  if(!state.browseLevel) return;
  state.browseLevel=null; state.view='home'; state.law=null; hideRightPanel(); renderHome(); renderSidebar();
}
/* 时间 / 相关性 / 名称 排序 */
function ymd(v){ if(!v) return 0; const d=(''+v).replace(/\D/g,''); return d.length>=8? parseInt(d.slice(0,8),10):0; }
/* 日期取值：优先级 修订日期 > 施行日期 > 发布日期（兼容 v1 eff_date/pub_date 与 v2 effective_date/publish_date 字段名） */
function revDate(l){ return l.revise_date || ''; }
function effDate(l){ return l.effective_date || l.eff_date || ''; }
function pubDate(l){ return l.publish_date || l.pub_date || ''; }
function sortDate(l){ return revDate(l) || effDate(l) || pubDate(l); }
function effLabel(l){
  if(revDate(l)) return {date:revDate(l), tag:'修订', cls:'dt-xiu'};
  if(effDate(l)) return {date:effDate(l), tag:'施行', cls:'dt-shi'};
  if(pubDate(l)) return {date:pubDate(l), tag:'发布', cls:'dt-fa'};
  return {date:'—', tag:'', cls:''};
}
const CORE_KW = ['建设工程','施工','招投标','招标','投标','采购','造价','工程','住建','城乡建设','住房','质量安全','安全','资质','合同','工程总承包','建筑','房地产','市政','城市更新','标准'];
function relScore(l){
  const lw={'法律':5,'中央行政法规':5,'中央部门规章':5,'中央规范性文件':4,'标准规范':5,'地方行政法规':3,'地方规章':3,'地方规范性文件':3,'司法解释':2,'司法案例':2,'行政案例':2,'政策解读':2};
  let s=(lw[l.level]||2);
  const hay=(l.field||'')+' '+(l.title||'');
  CORE_KW.forEach(k=>{ if(hay.indexOf(k)>=0) s+=2; });
  return s;
}
function sortLaws(list){
  const arr=list.slice(); const s=state.sort;
  if(s==='time_desc') arr.sort((a,b)=> ymd(sortDate(b))-ymd(sortDate(a)));
  else if(s==='time_asc') arr.sort((a,b)=> ymd(sortDate(a))-ymd(sortDate(b)));
  else if(s==='relevance') arr.sort((a,b)=> relScore(b)-relScore(a));
  else if(s==='name') arr.sort((a,b)=> a.title.localeCompare(b.title,'zh'));
  return arr;
}
/* 库菜单 */
function toggleLibMenu(e){ if(e) e.stopPropagation(); closeMenus(); const m=document.getElementById('libMenu'); if(!m) return; if(m.dataset.built!=='1'){ let h='<div class="lib-t">选择法规库（单击选定）</div>'; Object.keys(LIB_DEFS).forEach(k=>{ const c=libCount(k); const checked=(state.library===k||(k==='zong'&&!state.library))?'checked':''; h+='<label class="lib-opt"><input type="checkbox" '+checked+' onchange="selectLibrary(\''+k+'\')"> '+LIB_DEFS[k]+' <span class="lib-cnt">'+c+'</span></label>'; }); m.innerHTML=h; m.dataset.built='1'; } m.classList.toggle('show'); }
function selectLibrary(k){ closeMenus(); if(k==='custom'){ openCustomLib(); return; } state.library=(k==='zong'?null:k); if(state.view!=='home'){ state.view='home'; state.law=null; hideRightPanel(); } renderHome(); renderSidebar(); }
function openCustomLib(){
  const m=document.getElementById('customModal'); if(!m) return;
  const levels=LEVEL_NAMES.slice();
  const regions=[...new Set(LAWS.map(l=>l.region).filter(r=>r&&r!=='国家级'))].sort();
  let h='<div class="cm-overlay" onclick="closeCustomLib()"></div><div class="cm-box">'+
    '<div class="cm-title">自选库 · 勾选范围（并集生效）</div>'+
    '<div class="cm-sec"><div class="cm-h">效力层级</div><div class="cm-chks" id="cmLevels">';
  levels.forEach(lv=>{ h+='<label><input type="checkbox" value="'+lv+'"> '+lv+'</label>'; });
  h+='</div></div><div class="cm-sec"><div class="cm-h">地区</div><div class="cm-chks" id="cmRegions">';
  regions.forEach(r=>{ h+='<label><input type="checkbox" value="'+esc(r)+'"> '+esc(r)+'</label>'; });
  h+='</div></div><div class="cm-sec"><div class="cm-h">关键词（空格分隔，命中标题或领域）</div><input id="cmKw" class="cm-kw" placeholder="如：招标 施工"></div>'+
    '<div class="cm-actions"><button onclick="closeCustomLib()">取消</button><button class="primary" onclick="applyCustomLib()">确定并应用</button></div></div>';
  m.innerHTML=h; m.style.display='flex';
}
function closeCustomLib(){ const m=document.getElementById('customModal'); if(m) m.style.display='none'; }
function applyCustomLib(){
  const levels=new Set([...document.querySelectorAll('#cmLevels input:checked')].map(x=>x.value));
  const regions=new Set([...document.querySelectorAll('#cmRegions input:checked')].map(x=>x.value));
  const kw=document.getElementById('cmKw').value.trim();
  state.customLib={levels: levels.size?levels:null, regions: regions.size?regions:null, kw:kw};
  state.library='custom';
  closeCustomLib(); if(state.view!=='home'){ state.view='home'; state.law=null; hideRightPanel(); } renderHome(); renderSidebar();
}
/* 下载当前范围（md / word / pdf / zip） */
function closeMenus(){ ['dlMenu','libMenu','expMenu'].forEach(id=>{ const e=document.getElementById(id); if(e){ e.classList.remove('show'); } }); }
function toggleDlMenu(e){ if(e) e.stopPropagation(); closeMenus(); const m=document.getElementById('dlMenu'); if(!m) return; const n=dlScopeTitles().length;
  m.innerHTML='<div class="exp-menu-t">下载当前范围（'+n+' 部）</div>'+
    '<a onclick="downloadLibrary(\'zip\')">📦 每部独立 .md（打包 ZIP）</a>'+
    '<a onclick="downloadLibrary(\'md\')">📄 合并为单个 .md</a>'+
    '<a onclick="downloadLibrary(\'doc\')">📝 合并为 Word 文档</a>'+
    '<a onclick="downloadLibrary(\'pdf\')">🖨️ 合并为 PDF（打印）</a>';
  m.classList.toggle('show'); }
function dlScopeTitles(){
  if(state.view==='search'){ const s=new Set(filterEntries().map(e=>e.law_title)); return [...s]; }
  return [...new Set(currentLaws().map(l=>l.title))];
}
function today(){ const d=new Date(); const p=n=>(''+n).padStart(2,'0'); return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate()); }
function makeZip(files){
  const enc=new TextEncoder();
  const u16=(a,n)=>{ a.push(n&0xff,(n>>8)&0xff); };
  const u32=(a,n)=>{ a.push(n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff); };
  const crc32buf=(buf)=>{ let c=0xffffffff; for(let i=0;i<buf.length;i++){ c^=buf[i]; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); } return (c^0xffffffff)>>>0; };
  const locals=[]; const centrals=[]; let offset=0;
  files.forEach(f=>{
    const nameBytes=enc.encode(f.name); const dataBytes=enc.encode(f.content);
    const crc=crc32buf(dataBytes); const sz=dataBytes.length;
    const lh=[]; u32(lh,0x04034b50); u16(lh,20); u16(lh,0x0800); u16(lh,0); u16(lh,0); u16(lh,0);
    u32(lh,crc); u32(lh,sz); u32(lh,sz); u16(lh,nameBytes.length); u16(lh,0);
    nameBytes.forEach(b=>lh.push(b)); dataBytes.forEach(b=>lh.push(b));
    const lo=offset; offset+=lh.length; locals.push(lh);
    const cd=[]; u32(cd,0x02014b50); u16(cd,20); u16(cd,20); u16(cd,0x0800); u16(cd,0); u16(cd,0); u16(cd,0);
    u32(cd,crc); u32(cd,sz); u32(cd,sz); u16(cd,nameBytes.length); u16(cd,0);
    u16(cd,0); u16(cd,0); u16(cd,0); u32(cd,0); u32(cd,lo);
    nameBytes.forEach(b=>cd.push(b)); centrals.push(cd);
  });
  const csLen=centrals.reduce((s,a)=>s+a.length,0); const cenOffset=offset; const end=[];
  u32(end,0x06054b50); u16(end,0); u16(end,0); u16(end,files.length); u16(end,files.length);
  u32(end,csLen); u32(end,cenOffset); u16(end,0);
  const total=offset+csLen+end.length; const out=new Uint8Array(total); let p=0;
  locals.forEach(a=>{ out.set(a,p); p+=a.length; });
  centrals.forEach(a=>{ out.set(a,p); p+=a.length; });
  out.set(end,p);
  return out;
}
function saveBlob(blob, filename){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }
async function downloadLibrary(fmt){
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
    const md=avail.map(function(t){return mds[t];}).join('\n\n---\n\n');
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
}

/* ============ 左侧树状目录 ============ */
let treeCollapsed = new Set();   // 折叠的层级
let treeExpanded = new Set();    // 展开(显示章)的法规
let regionCollapsed = new Set(); // 折叠的 省 / 省/市 节点
let treeFilterText='';
function lpHeadHTML(){
  const cur = state.library? (LIB_DEFS[state.library]||'自选库') : '法规总库';
  return '<button class="lp-lib" id="libBtn" onclick="toggleLibMenu(event)" title="选择法规库">'+esc(cur)+'<span class="caret">▾</span></button>'+
    '<span class="lp-count" id="lpCount"></span>'+
    '<span class="lp-acts">'+
      '<button class="lp-btn" title="下载当前范围" onclick="toggleDlMenu(event)">⬇</button>'+
      '<button class="lp-btn" id="collapseAllBtn" title="全部折叠/展开" onclick="toggleCollapseAll()">⊟</button>'+
    '</span>'+
    '<div id="dlMenu" class="dl-menu"></div>'+
    '<div id="libMenu" class="lib-menu"></div>';
}
function renderSidebar(){
  const sb=document.getElementById('sidebar');
  if(!sb) return;
  // 检索态：左侧树变为「层级筛选器」
  if(state.view==='search' && state.q){ renderSearchSidebar(sb); return; }
  // 浏览态：恢复常规表头
  const lph=document.getElementById('lpHead');
  if(lph) lph.innerHTML=lpHeadHTML();
  const filt=treeFilterText.trim().toLowerCase();
  const hasFilter=!!filt;
  const curLaw=(state.law)?getLaw(state.law):null;
  const curLv=curLaw?curLaw.level:null;
  const curReg=curLaw?curLaw.region||'':'';
  let html='';
  const levels=[...new Set(LAWS.map(l=>l.level))].sort((a,b)=>(LEVEL_ORDER[a]??9)-(LEVEL_ORDER[b]??9));
  levels.forEach(lv=>{
    const list=LAWS.filter(l=>l.level===lv && libMatch(state.library||'zong', l, state.customLib) && (!hasFilter || l.title.toLowerCase().includes(filt)));
    if(!list.length && hasFilter) return; // 过滤层级时不折叠显示全部
    if(!list.length) return;
    const collapsed=treeCollapsed.has(lv);   // 筛选态下也尊重折叠状态，允许折叠层级
    const active=(state.browseLevel===lv)?' active':'';
    const lvsel=(curLv===lv)?' lv-sel':'';
    html+='<div class="tnode lv'+active+lvsel+'"><span class="tw" onclick="toggleLevel(\''+lv+'\')">'+(collapsed?'▸':'▾')+'</span> <span class="lv-label" onclick="applyBrowseLevel(\''+lv+'\')">'+esc(lv)+'</span><span class="tc">'+list.length+'</span></div>';
    if(!collapsed){
      if(lv.startsWith('地方')){
        html+=renderRegionTree(list, curReg);
      } else {
        list.forEach(l=>{ html+=lawNode(l); });
      }
    }
  });
  if(hasFilter && !html) html='<div class="empty" style="padding:20px 10px;font-size:12px">无匹配法规</div>';
  sb.innerHTML=html;
  const lc=document.getElementById('lpCount');
  if(lc) lc.textContent=((state.browseLevel||state.library)? currentLaws().length : LAWS.length)+' 部';
  updateCollapseAllBtn();
}
/* 法规节点 */
function lawNode(l){
  const idx=LAW_TITLES.indexOf(l.title);
  const cur=(state.law===l.title)?' cur':'';
  return '<div class="tnode law'+cur+'"><a href="javascript:;" onclick="openLaw(LAW_TITLES['+idx+'])" title="'+esc(l.title)+'">'+esc(l.title)+'</a></div>';
}
/* 地方性法规：按 省 → 市 → 县… 多级递归分组 */
function buildRegionTree(list){
  const root={children:{}, laws:[]};
  list.forEach(l=>{
    const parts=(l.region||'其他').split('/').filter(Boolean);
    let node=root, acc='';
    parts.forEach((p,i)=>{
      acc = acc? acc+'/'+p : p;
      if(!node.children[p]) node.children[p]={children:{}, laws:[], key:acc, name:p};
      node=node.children[p];
      if(i===parts.length-1) node.laws.push(l);   // 仅叶子节点持有法规
    });
  });
  return root;
}
function regionCount(node){
  let n=node.laws.length;
  for(const k in node.children) n+=regionCount(node.children[k]);
  return n;
}
function renderRegionNode(node, depth, curReg){
  let h='';
  node.laws.forEach(l=>{ h+=lawNode(l); });
  Object.keys(node.children).sort().forEach(cn=>{
    const child=node.children[cn];
    const col=regionCollapsed.has(child.key);
    const cls = depth===0? 'rg' : (depth===1? 'rg2' : 'rg3');
    const cnt=regionCount(child);
    const sel = (curReg && (curReg===child.key || curReg.indexOf(child.key+'/')===0)) ? ' rg-sel' : '';
    h+='<div class="tnode lv '+cls+sel+'"><span class="tw" onclick="toggleRegion(\''+esc(child.key)+'\')">'+(col?'▸':'▾')+'</span> '+esc(cn)+'<span class="tc">'+cnt+'</span></div>';
    if(!col) h+=renderRegionNode(child, depth+1, curReg);
  });
  return h;
}
function renderRegionTree(list, curReg){
  return renderRegionNode(buildRegionTree(list), 0, curReg||'');
}
function toggleRegion(key){ if(regionCollapsed.has(key)) regionCollapsed.delete(key); else regionCollapsed.add(key); renderSidebar(); }

/* 检索态左侧树：层级复选框 + 命中高亮 + 命中条数 */
function renderSearchSidebar(sb){
  // 检索态头部与浏览态完全一致：法规库下拉 ⬇下载 ⊞折叠/展开；不显示"检索结果"也不加清除按钮
  const lph=document.getElementById('lpHead');
  if(lph) lph.innerHTML=lpHeadHTML();
  updateCollapseAllBtn();
  const filt=treeFilterText.trim().toLowerCase();
  const curLaw=(state.law)?getLaw(state.law):null;
  const curLv=curLaw?curLaw.level:null;
  const curReg=curLaw?curLaw.region||'':'';
  let html='';
  const levels=[...new Set(LAWS.map(l=>l.level))].sort((a,b)=>(LEVEL_ORDER[a]??9)-(LEVEL_ORDER[b]??9));
  levels.forEach(lv=>{
    const mset=state.matchedLaws[lv]||new Set();
    if(!mset.size) return;                        // 仅显示有命中的层级
    const included = state.levelFilter ? state.levelFilter.has(lv) : true;
    let list=LAWS.filter(l=> l.level===lv && mset.has(l.title) && (!filt || l.title.toLowerCase().includes(filt)));
    if(!list.length) return;
    const collapsed=treeCollapsed.has('s:'+lv);    // 检索态使用独立折叠键，避免与浏览态互扰
    const lvsel=(curLv===lv)?' lv-sel':'';
    const arrow = included
      ? '<span class="tw" onclick="toggleSearchLevel(\''+lv+'\')">'+(collapsed?'▸':'▾')+'</span>'
      : '<span class="tw" style="visibility:hidden">▾</span>';
    html+='<div class="tnode lv'+lvsel+'">'+arrow+
      ' <span class="lv-label" onclick="toggleLevelFilter(\''+lv+'\')" title="点击：纳入 / 排除该层级的检索结果">'+esc(lv)+'</span>'+
      '<span class="tc">'+mset.size+'</span></div>';
    if(!collapsed && included){
      if(lv.startsWith('地方')){ html+=renderRegionTree(list, curReg); }
      else { list.forEach(l=>{ html+=lawNode(l); }); }
    }
  });
  if(!html) html='<div class="empty" style="padding:20px 10px;font-size:12px">无匹配法规</div>';
  sb.innerHTML=html;
  const lc=document.getElementById('lpCount');
  if(lc) lc.textContent=((state.browseLevel||state.library)? currentLaws().length : LAWS.length)+' 部';
}
function toggleSearchLevel(lv){ if(treeCollapsed.has('s:'+lv)) treeCollapsed.delete('s:'+lv); else treeCollapsed.add('s:'+lv); renderSidebar(); }
function toggleLevel(lv){ if(treeCollapsed.has(lv)) treeCollapsed.delete(lv); else treeCollapsed.add(lv); renderSidebar(); }
// 法规展开已移除（左树仅到法规名）
function filterTree(v){ treeFilterText=v; renderSidebar(); }
function getLaw(title){ return LAWS.find(l=>l.title===title); }
function toggleCollapseAll(){
  const searching = (state.view==='search' && state.q);
  const prefix = searching ? 's:' : '';
  const levels=[...new Set(LAWS.map(l=>l.level))];
  // 检索态只针对「有命中的层级」生效（其余层级根本不显示）
  const relevant = searching ? levels.filter(lv=> (state.matchedLaws[lv]||new Set()).size>0) : levels;
  const allCollapsed = relevant.length>0 && relevant.every(lv=>treeCollapsed.has(prefix+lv)) && treeExpanded.size===0;
  if(allCollapsed){ relevant.forEach(lv=>treeCollapsed.delete(prefix+lv)); if(!searching) regionCollapsed.clear(); }   // 全部展开（显示法规名）
  else { relevant.forEach(lv=>treeCollapsed.add(prefix+lv)); treeExpanded.clear(); if(!searching) regionCollapsed.clear(); }  // 全部折叠（仅留层级）
  renderSidebar();
}
/* 左树「全部折叠/展开」图标随状态同步：全部展开→⊟(可收起)，否则→⊞(可展开)，与右栏大纲按钮一致；检索态使用 s: 前缀键 */
function updateCollapseAllBtn(){
  const b=document.getElementById('collapseAllBtn'); if(!b) return;
  const searching = (state.view==='search' && state.q);
  const prefix = searching ? 's:' : '';
  const levels=[...new Set(LAWS.map(l=>l.level))];
  const relevant = searching ? levels.filter(lv=> (state.matchedLaws[lv]||new Set()).size>0) : levels;
  const allOpen = relevant.length>0 && relevant.every(lv=>!treeCollapsed.has(prefix+lv));
  b.textContent = allOpen ? '⊟' : '⊞';
}

/* ============ 视图切换 ============ */
function hideRightPanel(){
  const rp=document.getElementById('rightPanel'); if(rp) rp.classList.add('hidden');
  const pill=document.getElementById('tocPill'); if(pill) pill.style.display='none';
  const e=document.getElementById('tocEdge'); if(e) e.style.display='none';
  if(spyObserver){ spyObserver.disconnect(); spyObserver=null; }
}
function switchView(v){
  state.view=v; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; state.browseLevel=null;
  if(v!=='read') hideRightPanel();
  if(v==='home') renderHome();
  renderSidebar();
  window.scrollTo(0,0);
}
/* 右上角：原文检索 —— 全文搜索 */
async function doSearch(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='search'; state.law=null;
  hideRightPanel();
  try{ await ensureSearch(); }catch(e){}
  recomputeMatches();
  renderSearch(); renderSidebar(); window.scrollTo(0,0);
}
/* 右上角：AI 问答 —— 检索增强（有输入框则预填并自动回答） */
async function doAI(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='ai'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={};
  hideRightPanel();
  renderAI(); renderSidebar();
  if(q){ try{ await ensureSearch(); }catch(e){} const ta=document.getElementById('aique'); if(ta) ta.value=q; askAI(); }
  window.scrollTo(0,0);
}
function clearSearch(){ const t=document.getElementById('topq'); if(t) t.value=''; state.q=''; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; switchView('home'); }

/* ============ 首页：法规框架目录 ============ */
function renderHome(){
  const v=document.getElementById('view');
  let html = '<div class="hero"><h1>工建法研 · 工程建设法规库</h1>'+
    '<p class="hero-sub">按效力层级整理的工程建设法规学习地图 · 点开逐条精读，或右上角「原文检索 / AI 问答」。</p></div>';
  // 视图 / 排序 工具条
  html += '<div class="home-tools">'+
    '<label class="tool">视图 <select onchange="state.homeView=this.value;renderHome()">'+
      '<option value="table"'+(state.homeView==='table'?' selected':'')+'>列表</option>'+
      '<option value="cards"'+(state.homeView==='cards'?' selected':'')+'>卡片</option></select></label>'+
    '<label class="tool">排序 <select onchange="state.sort=this.value;renderHome()">'+
      '<option value="time_desc"'+(state.sort==='time_desc'?' selected':'')+'>时间（新→旧）</option>'+
      '<option value="time_asc"'+(state.sort==='time_asc'?' selected':'')+'>时间（旧→新）</option>'+
      '<option value="relevance"'+(state.sort==='relevance'?' selected':'')+'>相关性</option>'+
      '<option value="name"'+(state.sort==='name'?' selected':'')+'>名称（A→Z）</option></select></label>';
  const scopeLabel = (state.browseLevel?('层级：'+state.browseLevel):'') + (state.library?((state.browseLevel?' · ':'')+'库：'+(LIB_DEFS[state.library]||'自定义')):'');
  html += '<span class="tool-info">'+(scopeLabel||'当前：法规总库')+'</span></div>';

  const presentLevels = [...new Set(LAWS.map(l=>l.level))].sort((a,b)=>(LEVEL_ORDER[a]??9)-(LEVEL_ORDER[b]??9));
  presentLevels.forEach(lv=>{
    let list=LAWS.filter(l=>l.level===lv);
    list=list.filter(l=>libMatch(state.library||'zong', l, state.customLib));
    if(state.browseLevel && state.browseLevel!==lv) return;
    list=sortLaws(list);
    if(!list.length) return;
    const desc = lv==='法律' ? '全国人大及其常委会制定，工程建设合规的顶层依据。' :
                 lv==='司法解释' ? '最高人民法院司法解释、全国人大常委会立法解释，裁判与执法的直接依据。' :
                 lv==='中央行政法规' ? '国务院制定，细化法律、具普遍约束力的条例与规定。' :
                 lv==='中央部门规章' ? '国务院部委制定，招投标、施工、造价等管理的具体规则。' :
                 lv==='中央规范性文件' ? '部委发布的通知、意见、办法等执行口径（全国适用）。' :
                 lv==='地方行政法规' ? '省级人大/政府制定，本地适用的地方性法规与条例。' :
                 lv==='地方规章' ? '省级政府规章，地方工程建设管理的细化规定。' :
                 lv==='地方规范性文件' ? '省市发布的规范性文件，本地执行口径。' :
                 lv==='标准规范' ? 'GB/JGJ 等强制性及推荐性技术标准，质量安全的底线。' :
                 lv==='司法案例' ? '最高人民法院指导性案例及参考性案例，同案同判的参照。' :
                 lv==='行政案例' ? '住建部等行政部门通报的违法违规典型案例与执法实践。' :
                 '部委对重要规章、标准的官方政策解读。';
    html += '<div class="zone"><h2>'+lv+' <span class="badge">'+list.length+' 部</span></h2><div class="desc">'+desc+'</div>';
    if(state.homeView==='cards'){
      html += '<div class="cards">';
      list.forEach(l=>{
        const el=effLabel(l);
        html += '<div class="lcard" onclick="openLaw(\''+l.title.replace(/'/g,"\\'")+'\')">'+
          '<div class="lt">'+esc(l.title)+'</div>'+
          '<div class="meta">'+lawTag(l)+
          '<span class="mfi">'+esc(l.doc_number||'—')+'</span>'+
          '<span class="mfi">'+esc(l.publisher||'')+'</span>'+
          '<span class="mfi">'+esc(el.date)+(el.tag?'<span class="dtag '+el.cls+'">'+el.tag+'</span>':'')+'</span>'+
          '<span class="cnt">'+l.count+' 条</span></div></div>';
      });
      html += '</div>';
    } else {
      html += '<table class="lawtable"><thead><tr>'+
        '<th style="width:36%">法规名称</th><th style="width:16%">法规文号</th><th style="width:18%">发布机关</th><th style="width:15%">日期</th><th style="width:15%">状态</th></tr></thead><tbody>';
      list.forEach(l=>{
        const el=effLabel(l);
        html += '<tr onclick="openLaw(\''+l.title.replace(/'/g,"\\'")+'\')">'+
          '<td><div class="nm">'+esc(l.title)+'</div></td>'+
          '<td>'+esc(l.doc_number||'—')+'</td>'+
          '<td>'+esc(l.publisher||'—')+'</td>'+
          '<td class="dt">'+esc(el.date)+(el.tag?'<span class="dtag '+el.cls+'">'+el.tag+'</span>':'')+'</td>'+
          '<td class="status-td">'+statusTag(l)+'</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
  });
  v.innerHTML=html;
}

/* ============ 阅读视图 ============ */
async function openLaw(title){
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
}
function renderRead(title){
  const v=document.getElementById('view');
  const data=READ[title];
  if(!data){ v.innerHTML='<div class="empty">未找到该法规</div>'; return; }
  const m=data.meta;
  const arts=data.chapters.reduce((s,c)=>s+c.articles.length,0);
  const words=data.chapters.reduce((s,c)=>s+c.articles.reduce((a,ar)=>a+(ar.content?ar.content.length:0),0),0);
  const amendYear=(title.match(/[（(]([0-9]{4})/)||[])[1];
  const lw=getLaw(title);
  let h='<div class="crumb"><a onclick="switchView(\'home\')">目录</a> › <a onclick="switchView(\'home\')">'+esc(lw?lw.level:'')+'</a> › <b>'+esc(title)+'</b></div>';
  h+='<div class="read-head"><h1>'+esc(title)+'</h1></div>';
  // 语雀式发布信息表
  h+='<table class="info-table">';
  h+='<tr><td class="label">文号</td><td class="value">'+esc(m.doc_number||'—')+'</td>'+
     '<td class="label">发布机关</td><td class="value">'+esc(m.publisher||'—')+'</td></tr>';
  h+='<tr><td class="label">颁布时间</td><td class="value">'+esc(m.publish_date||'—')+'</td>'+
     '<td class="label">实施时间</td><td class="value">'+esc(m.effective_date||'—')+'</td></tr>';
  h+='<tr><td class="label">修订时间</td><td class="value">'+(m.revise_date?m.revise_date:(amendYear?amendYear+'-01-01':'—'))+'</td>'+
     '<td class="label">是否有效</td><td class="value">'+(m.status==='已废止'?'已废止':'现行有效')+'</td></tr>';
  const srcName=esc(m.publisher||'');
  const srcUrl=(m.source_url||'').trim();
  const srcHtml=srcName+(srcUrl?' ｜ <a class="src-link" href="'+esc(srcUrl)+'" target="_blank" rel="noopener">官方原文 ↗</a>':'');
  h+='<tr><td class="label">来源</td><td class="value" colspan="3">'+srcHtml+'</td></tr>';
  h+='</table>';
  // 文档统计行已移除（仅保留文末字数）
  h+='<div class="read-body">';
  data.chapters.forEach((c,i)=>{
    const isUntitled = !c.title || c.title==='（未分章）';
    const isLead = isUntitled && i===0;
    h+='<div class="chapter'+(isLead?' lead':'')+'" id="ch'+i+'">';
    if(!isUntitled) h+='<h3>'+esc(c.title)+'</h3>';
    let sj=0;
    c.articles.forEach((a)=>{
      const isAbol=(a.status==='已废止');
      const isNote=/^[（(](原|注|说明|注：|备注)/.test(a.content||'');
      const anHtml = a.article ? '<div class="an">'+esc(a.article)+'</div>' : '';
      const cls='article'+(isAbol?' abol':'')+(isNote?' note':'');
      const aid = a.article ? ' id="art-'+i+'-'+sj+'"' : '';
      h+='<div class="'+cls+'"'+aid+'>'+anHtml+'<div class="ac">'+renderContent(a.content)+'</div>'+
        (isAbol&&a.superseded_by?'<div class="sup">⚠️ 已废止 ｜ 替代：'+esc(a.superseded_by)+'</div>':'');
      h+='</div>';
      if(a.article) sj++;
    });
    h+='</div>';
  });
  h+='</div>';
  h+='<div class="doc-end">📄 本文约 <b>'+words+'</b> 字</div>';
  v.innerHTML=h;
  readBodyHtml = v.querySelector('.read-body') ? v.querySelector('.read-body').innerHTML : '';
}

function safeName(s){ s=(s==null?'法规':(''+s)); var out=''; for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if(c===92||c===47||c===58||c===42||c===63||c===34||c===60||c===62||c===124) out+='_'; else out+=s[i]; } return out.split('  ').join(' ').trim().slice(0,60); }
function downloadBlob(content, filename, mime){
  var blob=new Blob([content], {type:(mime||'text/plain')+';charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
function toggleExpMenu(e){ e.stopPropagation(); var m=document.getElementById('expMenu'); if(m) m.classList.toggle('show'); }
document.addEventListener('click', function(){ var m=document.getElementById('expMenu'); if(m) m.classList.remove('show'); closeMenus(); });
function buildReadMD(title, m, chapters){
  var L=[]; L.push('# '+title); L.push('');
  function line(k,v){ return '- **'+k+'**：'+(v||'—'); }
  L.push(line('发文字号', m.doc_number));
  L.push(line('发布机关', m.publisher));
  L.push(line('发布日期', m.publish_date));
  L.push(line('施行日期', m.effective_date));
  L.push(line('效力状态', m.status));
  if(m.source_url) L.push(line('来源', m.source_url));
  L.push(''); L.push('---'); L.push('');
  (chapters||[]).forEach(function(c){
    L.push('## '+(c.title||'')); L.push('');
    (c.articles||[]).forEach(function(a){
      if(a.article) L.push('### '+a.article);
      L.push((a.content||'').trim());
      if(a.status==='abolished' && a.superseded_by) L.push('> 已废止，替代：'+a.superseded_by);
      L.push('');
    });
  });
  L.push('');
  L.push('> 本导出由「工建法研 · 工程建设法规库」生成，仅供学习参考，正式引用请以官方公报为准。');
  return L.join('\n');
}
var EXPORT_DOC_CSS='body{font-family:"Microsoft YaHei","SimSun",serif;color:#1a1a1a;line-height:1.8;margin:32px;max-width:820px}.doc-title{font-size:24px;font-weight:700;text-align:center;padding:14px 0 18px;border-bottom:3px double #1677ff;margin-bottom:18px}table.meta{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13.5px}table.meta th{background:#f0f7ff;color:#1677ff;text-align:left;width:120px;padding:7px 12px;border:1px solid #d6e4ff;font-weight:600}table.meta td{padding:7px 12px;border:1px solid #e8e8e8}h2.ch{font-size:18px;color:#1677ff;border-left:5px solid #1677ff;padding:6px 0 6px 12px;margin:26px 0 14px;background:#f7fbff}.article{margin-bottom:16px;padding:12px 16px;border:1px solid #eee;border-radius:10px;background:#fff}.article.abol{background:#fff7f7;border-color:#ffd6d6}.an{font-weight:700;color:#262626;margin-bottom:6px;font-size:15px}.ac{font-size:14.5px;color:#333}.ac p{margin:6px 0}.ac table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}.ac th,.ac td{border:1px solid #d9d9d9;padding:6px 10px}.ac th{background:#fafafa}.ac ul{margin:6px 0;padding-left:22px}.sup{margin-top:6px;color:#cf1322;font-size:13px;background:#fff1f0;border:1px solid #ffccc7;border-radius:8px;padding:6px 10px}.doc-end{margin-top:28px;padding-top:14px;border-top:1px solid #eee;font-size:12.5px;color:#999;text-align:center}@media print{body{margin:14mm}}';
function buildReadExportHtml(title, m, chapters){
  var h='';
  h+='<div class="doc-title">'+esc(title)+'</div>';
  h+='<table class="meta"><tbody>';
  function row(k,v){ return '<tr><th>'+k+'</th><td>'+(v?esc(v):'—')+'</td></tr>'; }
  h+=row('发文字号', m.doc_number)+row('发布机关', m.publisher)+row('发布日期', m.publish_date)+row('施行日期', m.effective_date)+row('效力状态', m.status);
  if(m.source_url) h+=row('来源', m.source_url);
  h+='</tbody></table>';
  (chapters||[]).forEach(function(c){
    h+='<h2 class="ch">'+esc(c.title||'')+'</h2>';
    (c.articles||[]).forEach(function(a){
      var isAbol=a.status==='abolished';
      h+='<div class="article'+(isAbol?' abol':'')+'">';
      if(a.article) h+='<div class="an">'+esc(a.article)+'</div>';
      h+='<div class="ac">'+renderContent(a.content)+'</div>';
      if(isAbol&&a.superseded_by) h+='<div class="sup">已废止 ｜ 替代：'+esc(a.superseded_by)+'</div>';
      h+='</div>';
    });
  });
  h+='<div class="doc-end">本文由「工建法研 · 工程建设法规库」生成，仅供学习参考，正式引用请以官方公报为准。</div>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>'+EXPORT_DOC_CSS+'</style></head><body>'+h+'</body></html>';
}
async function exportCurrent(fmt){
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
}

/* 渲染条文正文：保留换行、子条目(1. /（1）)成列表、自动转义 */
function renderContent(text){
  const raw=(text||'').trim();
  if(!raw) return '';
  const itemRe=/^([（(]\d+[）)]|\d+[.、])\s*(.*)$/;
  const rowSegRe=/\|(?:[^|\n]*\|)+/g;
  const isDivider=s=>/^\s*\|[\s:|-]+\|?\s*$/.test(s) && s.replace(/\|/g,'').replace(/[\s:|-]/g,'').length===0;
  const splitRow=r=>r.replace(/^\|/,'').replace(/\|$/,'')/* 去首尾| */.split('|').map(c=>c.trim());
  const mergeTableRows=(rows)=>{
    if(rows.length<3 || !isDivider(rows[1])) return null;
    const hc=splitRow(rows[0]).length, dc=splitRow(rows[1]).length;
    if(hc!==dc) return null;
    return {head:splitRow(rows[0]), body:rows.slice(2).map(splitRow)};
  };
  let html='', inList=false;
  const flush=()=>{ if(inList){ html+='</ol>'; inList=false; } };
  const lines=raw.split('\n'); const lineStart=[]; let acc=0;
  lines.forEach(l=>{ lineStart.push(acc); acc+=l.length+1; });
  let mm, rowSegs=[];
  while((mm=rowSegRe.exec(raw))!==null){ rowSegs.push([mm.index, mm.index+mm[0].length, mm[0]]); }
  const rowOf=pos=>{ let lo=0,hi=lineStart.length-1; while(lo<hi){ const mid=(lo+hi+1)>>1; if(lineStart[mid]<=pos) lo=mid; else hi=mid-1; } return lo; };
  let i=0, lastEnd=0;
  while(i<rowSegs.length){
    let lnNo=rowOf(rowSegs[i][0]), start=rowSegs[i][0];
    let lineNo=lnNo, line=rowSegs[i][2], end=rowSegs[i][1]; let j=i+1;
    while(j<rowSegs.length && rowOf(rowSegs[j][0])===lineNo){ line+=' '+rowSegs[j][2].replace(/^\s*/,''); end=rowSegs[j][1]; j++; }
    let rows=[line];
    let k=j, expectLine=lnNo+1;
    while(k<rowSegs.length && rowOf(rowSegs[k][0])===expectLine){
      end=rowSegs[k][1]; const ln2=rowSegs[k][2]; let kk=k+1;
      while(kk<rowSegs.length && rowOf(rowSegs[kk][0])===rowOf(rowSegs[k][0])){ ln2+=' '+rowSegs[kk][2].replace(/^\s*/,''); kk++; }
      rows.push(ln2); expectLine=rowOf(rowSegs[k][0])+1; k=kk;
    }
    // 若整段落在同一行（单行表格）：行与行之间以 "|"（其后紧跟另一个 "|"，可含多空格）分隔，
    // 在两个边界管道之间插入换行（保留两端 "|"，否则分隔行会丢掉前导 "|" 导致识别失败）
    if(rows.length===1){
      const rebuilt=rows[0].replace(/(\|) +\|/g,'$1\n|');
      const segs=rebuilt.split('\n');
      if(segs.length>=3){
        const cand=segs.map(s=>s.trim()).filter(s=>s && s!=='|');
        const divIdx=cand.findIndex(r=>{ const cells=splitRow(r); return cells.length>1 && cells.every(c=>/^:?-+:?$/.test(c)); });
        if(divIdx>0){ rows=cand; }
      }
    }
    const tb=mergeTableRows(rows);
    if(tb){
      const pre=raw.slice(lastEnd, start).trim();
      if(pre){ flush(); html+='<p>'+esc(pre)+'</p>'; }
      flush();
      let t='<table class="lawtable"><thead><tr>';
      tb.head.forEach(h=>{ t+='<th>'+esc(h)+'</th>'; });
      t+='</tr></thead><tbody>';
      tb.body.forEach(row=>{ t+='<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>'; });
      t+='</tbody></table>';
      html+=t;
      lastEnd=end; i=k; continue;
    }
    i++;
  }
  const tail=raw.slice(lastEnd).trim();
  if(tail){
    tail.split('\n').map(s=>s.trim()).filter(Boolean).forEach(ln=>{
      if(ln.charAt(0)==='>'){ flush(); html+='<blockquote>'+esc(ln.replace(/^>\s?/,''))+'</blockquote>'; return; }
      const m=itemRe.exec(ln);
      if(m){ if(!inList){ html+='<ol class="subitems">'; inList=true; } html+='<li>'+esc(m[2])+'</li>'; }
      else { flush(); html+='<p>'+esc(ln)+'</p>'; }
    });
  }
  flush();
  if(!html) html='<p>'+esc(raw)+'</p>';
  return html;
}


/* 右侧「大纲」—— 语雀目录样式（章可展开到条，无计数） */
function renderToc(title){
  const box=document.getElementById('toc');
  const data=READ[title];
  if(!box||!data){ if(box) box.innerHTML=''; return; }
  let h='';
  data.chapters.forEach((c,i)=>{
    const subs=c.articles.filter(a=>a.article);   // 仅含真实「条」编号的子条
    const isUntitled=(c.title==='（未分章）');
    if(isUntitled){   // 单章无标题：直接列条，不显示「未分章」标题
      subs.forEach((a,j)=>{ h+='<a class="toc-art" style="padding-left:16px" id="tocart-'+i+'-'+j+'" onclick="jump(\'art-'+i+'-'+j+'\')" title="'+esc(a.article)+'">'+esc(a.article)+'</a>'; });
      return;
    }
    const expanded=tocExpandedCh.has(i) && subs.length>0;
    h+='<div class="toc-ch'+(expanded?' exp':'')+'" id="tocch-'+i+'">'+
        '<a href="javascript:;" onclick="jump(\'ch'+i+'\')" id="toclnk-'+i+'">';
    if(subs.length) h+='<span class="toc-arrow" onclick="event.stopPropagation();toggleTocCh('+i+')">▸</span>';
    h+='<span>'+esc(c.title)+'</span></a>';
    if(subs.length){
      h+='<div class="toc-arts">';
      subs.forEach((a,j)=>{ h+='<a class="toc-art" id="tocart-'+i+'-'+j+'" onclick="jump(\'art-'+i+'-'+j+'\')" title="'+esc(a.article)+'">'+esc(a.article)+'</a>'; });
      h+='</div>';
    }
    h+='</div>';
  });
  box.innerHTML=h;
  updateTocAllBtn();
}
function toggleTocCh(i){ if(!state.law) return; if(tocExpandedCh.has(i)) tocExpandedCh.delete(i); else tocExpandedCh.add(i); renderToc(state.law); }
/* 折叠/展开全部大纲：所有「含真实条」的章节统一展开或折叠，图标随实际状态同步 */
function toggleTocAll(){
  if(!state.law) return;
  const data=READ[state.law]; if(!data) return;
  const exp=data.chapters.map((c,i)=>i).filter(i=>(data.chapters[i].articles.filter(a=>a.article).length>0));
  if(exp.length===0) return;
  const allOpen=exp.every(i=>tocExpandedCh.has(i));
  if(allOpen) exp.forEach(i=>tocExpandedCh.delete(i));
  else exp.forEach(i=>tocExpandedCh.add(i));
  renderToc(state.law);
}
function updateTocAllBtn(){
  const b=document.getElementById('tocAllBtn'); if(!b) return;
  const data=state.law?READ[state.law]:null;
  if(!data){ b.textContent='⊞'; b.style.opacity=''; return; }
  const exp=data.chapters.map((c,i)=>i).filter(i=>(data.chapters[i].articles.filter(a=>a.article).length>0));
  const allOpen=exp.length>0 && exp.every(i=>tocExpandedCh.has(i));
  b.textContent=allOpen?'⊟':'⊞';
  b.style.opacity=exp.length?'':'0.4';
}
/* 滚动高亮当前章节 */
/* 滚动高亮 + 右侧目录连续跟随（随 window 滚动，rAF 节流，细化到「条」级） */
function onBodyScroll(){
  if(spyRaf) return;
  spyRaf=requestAnimationFrame(()=>{ spyRaf=null; doScrollSpy(); });
}
/* 目录平滑跟随：rAF 缓动把 toc.scrollTop 逐步逼近 tocFollowTarget（每帧移动剩余 30%） */
function tocFollowTick(){
  spyTocRaf=null;
  const toc=document.getElementById('toc');
  if(!toc || tocFollowTarget==null) return;
  const cur=toc.scrollTop, diff=tocFollowTarget-cur;
  if(Math.abs(diff)<0.5){ tocGoal=tocFollowTarget; toc.scrollTop=tocFollowTarget; tocFollowTarget=null; return; }
  tocGoal=cur+diff*0.30;            // 缓动系数：越小越柔、越大越紧跟
  toc.scrollTop=tocGoal;
  spyTocRaf=requestAnimationFrame(tocFollowTick);
}
function doScrollSpy(){
  const line=Math.max(90, window.innerHeight*0.30);   // 阅读判定线（视口上部约 30%，贴近阅读视线）
  const cands=[];
  document.querySelectorAll('.chapter[id^="ch"]').forEach(el=>{
    cands.push({top:el.getBoundingClientRect().top, tocId:'toclnk-'+el.id.replace('ch',''), ch:el.id.replace('ch',''), isArt:false});
  });
  document.querySelectorAll('.article[id^="art"]').forEach(el=>{
    const m=el.id.match(/^art-(\d+)-(\d+)$/); if(!m) return;
    cands.push({top:el.getBoundingClientRect().top, tocId:'tocart-'+m[1]+'-'+m[2], ch:m[1], isArt:true});
  });
  if(!cands.length) return;
  cands.sort((a,b)=>a.top-b.top);
  let act=null;
  for(const c of cands){ if(c.top<=line) act=c; else break; }   // 最后一个越过判定线的候选为当前
  if(!act) act=cands[0];
  // 高亮始终实时更新（即使目录正处于「用户手动滚动」暂停期，正文位置对应的目录项仍应点亮）
  document.querySelectorAll('.toc-ch>a').forEach(a=>a.classList.remove('active','ch-active'));
  document.querySelectorAll('.toc-art').forEach(a=>a.classList.remove('active'));
  // 章级高亮：当前条文所属章节始终显示「另一种颜色」底纹（折叠态下也能看到，解决「上一章节不显示」）
  const chLink=document.getElementById('toclnk-'+act.ch);
  if(chLink) chLink.classList.add('ch-active');
  // 条级高亮：当前条显示「灰色」底纹；章展开时条可见→灰底+跟随条，章折叠/未分章→跟随章头（或条）
  let followLink=null;
  const artLink=document.getElementById(act.tocId);
  const chExpanded=!!(chLink && chLink.closest('.toc-ch') && chLink.closest('.toc-ch').classList.contains('exp'));
  if(act.isArt && artLink){
    if(chExpanded){ artLink.classList.add('active'); followLink=artLink; }            // 章展开：条可见 → 灰底 + 跟随条
    else { followLink = chLink || artLink; if(!chLink) artLink.classList.add('active'); } // 折叠/未分章：跟随章头，未分章时条本身灰底
  } else if(chLink){
    followLink=chLink;
  }
  if(followLink){
    const toc=document.getElementById('toc');
    if(toc && toc.scrollHeight>toc.clientHeight && !tocUserTimer){   // 仅当用户未手动滚动目录时才自动跟随
      // 当前条/章链接稳定在目录视口上约 30% 处，连续跟随正文滚动
      const lr=followLink.getBoundingClientRect(), tr=toc.getBoundingClientRect();
      const curTop=lr.top-tr.top+toc.scrollTop;
      let target=curTop - toc.clientHeight*0.30;
      target=Math.max(0, Math.min(target, toc.scrollHeight-toc.clientHeight));
      const base=(tocFollowTarget==null)?toc.scrollTop:tocFollowTarget;
      if(Math.abs(target-base)>1){ tocFollowTarget=target; if(!spyTocRaf) spyTocRaf=requestAnimationFrame(tocFollowTick); }
    }
  }
}
function startScrollSpy(){
  if(spyObserver){ spyObserver.disconnect(); spyObserver=null; }
  if(spyTocRaf){ cancelAnimationFrame(spyTocRaf); spyTocRaf=null; }   // 切换文档时清掉上一文的缓动残留
  tocFollowTarget=null; tocGoal=-1;
  doScrollSpy();                          // 立即定位一次，避免打开时目录未同步
  if(!spyScrollAttached){
    window.addEventListener('scroll', onBodyScroll, {passive:true});
    const toc=document.getElementById('toc');
    if(toc) toc.addEventListener('scroll', ()=>{
      // 通过目标 proximity 区分「程序化滚动」与「用户手动滚动」——比时间窗可靠（scroll 事件异步派发，时间窗常误判）
      if(tocGoal>=0 && Math.abs(toc.scrollTop-tocGoal)<3) return;
      tocGoal=-1; tocFollowTarget=null;                 // 取消自动跟随残留目标，避免与用户手抢
      if(spyTocRaf){ cancelAnimationFrame(spyTocRaf); spyTocRaf=null; }
      clearTimeout(tocUserTimer);
      tocUserTimer=setTimeout(()=>{ tocUserTimer=null; }, 1400);   // 手动滚目录后 1.4s 恢复自动跟随
    }, {passive:true});
    spyScrollAttached=true;
  }
}
/* 右侧目录 显示 / 隐藏 / 悬浮 切换 */
function showToc(mode, peek){
  const rp=document.getElementById('rightPanel'), pill=document.getElementById('tocPill'), edge=document.getElementById('tocEdge');
  if(mode) tocState=mode;
  tocPeek=(typeof peek==='boolean')?peek:false;
  clearTimeout(tocHideTimer);
  rp.classList.remove('hidden','floating');
  if(tocState==='floating') rp.classList.add('floating');
  pill.style.display='none'; if(edge) edge.style.display='none';
}
function hideToc(){ tocState='hidden'; const rp=document.getElementById('rightPanel'); if(rp) rp.classList.add('hidden'); const pill=document.getElementById('tocPill'); if(pill) pill.style.display='block'; const e=document.getElementById('tocEdge'); if(e) e.style.display='block'; }
function toggleTocMode(){ tocState=(tocState==='floating')?'docked':'floating'; showToc(null, false); }
function jump(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth'}); }

/* ============ 右栏正文搜索（在当前阅读文档内高亮关键词） ============ */
function escRe(s){ return (s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function resetBodyMarks(){
  const body=document.querySelector('#view .read-body');
  if(body && readBodyHtml) body.innerHTML=readBodyHtml;   // 复位为无高亮状态
  bodyMarks=[]; bsCur=-1;
  if(spyObserver){ spyObserver.disconnect(); spyObserver=null; }
  startScrollSpy();   // 复位后重新绑定滚动高亮
}
function applyBodySearch(){
  const input=document.getElementById('bodySearch');
  const q=input?(input.value||'').trim():'';
  const body=document.querySelector('#view .read-body');
  const countEl=document.getElementById('bsCount');
  const prevBtn=document.getElementById('bsPrev'), nextBtn=document.getElementById('bsNext');
  if(!body){ if(countEl) countEl.textContent=''; return; }
  resetBodyMarks();   // 每次输入都从干净正文重新高亮
  if(!q){ if(countEl) countEl.textContent=''; if(prevBtn)prevBtn.disabled=true; if(nextBtn)nextBtn.disabled=true; return; }
  const kws=tokenize(q).filter(Boolean);
  if(!kws.length){ if(countEl) countEl.textContent=''; if(prevBtn)prevBtn.disabled=true; if(nextBtn)nextBtn.disabled=true; return; }
  const regex=new RegExp('('+kws.map(escRe).join('|')+')','gi');
  // 收集所有文本节点（图片/脚本除外），逐节点高亮
  const walker=document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
  const textNodes=[]; let tn;
  while((tn=walker.nextNode())){ if(tn.nodeValue && tn.nodeValue.trim()) textNodes.push(tn); }
  textNodes.forEach(node=>{
    const txt=node.nodeValue;
    regex.lastIndex=0;
    if(!regex.test(txt)) return;
    regex.lastIndex=0;
    const frag=document.createDocumentFragment();
    let last=0, m;
    while((m=regex.exec(txt))!==null){
      if(m.index>last) frag.appendChild(document.createTextNode(txt.slice(last,m.index)));
      const mark=document.createElement('mark');
      mark.className='bs'; mark.textContent=m[0];
      frag.appendChild(mark); bodyMarks.push(mark);
      last=m.index+m[0].length;
      if(m[0].length===0) regex.lastIndex++;
    }
    if(last<txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    if(frag.childNodes.length) node.parentNode.replaceChild(frag, node);
  });
  if(!bodyMarks.length){
    if(countEl) countEl.textContent='无匹配';
    if(prevBtn)prevBtn.disabled=true; if(nextBtn)nextBtn.disabled=true;
    return;
  }
  if(prevBtn)prevBtn.disabled=false; if(nextBtn)nextBtn.disabled=false;
  bsCur=0; markBodyCur();
  if(countEl) countEl.textContent=(bsCur+1)+' / '+bodyMarks.length;
}
function markBodyCur(){
  bodyMarks.forEach((mk,i)=>{ mk.classList.toggle('bs-cur', i===bsCur); });
  const cur=bodyMarks[bsCur];
  if(cur) cur.scrollIntoView({behavior:'smooth', block:'center'});
}
function bsPrev(){ if(bodyMarks.length<2) return; bsCur=(bsCur-1+bodyMarks.length)%bodyMarks.length; markBodyCur(); const c=document.getElementById('bsCount'); if(c) c.textContent=(bsCur+1)+' / '+bodyMarks.length; }
function bsNext(){ if(bodyMarks.length<2) return; bsCur=(bsCur+1)%bodyMarks.length; markBodyCur(); const c=document.getElementById('bsCount'); if(c) c.textContent=(bsCur+1)+' / '+bodyMarks.length; }

/* ============ 检索视图 ============ */
function renderSearch(){
  const v=document.getElementById('view');
  let html='<div class="result-head">';
  if(state.q) html+='<div class="rq">🔍 搜索 “'+esc(state.q)+'” <span class="rq-clear" onclick="clearSearch()">✕ 清空</span></div>';
  else html+='<div class="rq muted">在右上角搜索框输入关键词，点击「原文检索」开始查找</div>';
  // 仅保留状态小开关（层级筛选已移至左侧树）
  html+='<div class="chips" style="margin-top:10px">';
  ['全部','现行','已废止'].forEach(s=>{ html+='<span class="chip'+(state.status===s?' active':'')+'" onclick="setStatus(\''+s+'\')">'+s+'</span>'; });
  html+='<span class="chip clear" onclick="clearFilters()">重置</span></div>';
  html+='<div class="result-meta" id="meta"></div><div id="results"></div>';
  v.innerHTML=html;
  drawResults();
}
function queryMatches(){
  const kws=tokenize(state.q);
  return searchData.filter(e=>{
    if(state.status!=='全部' && e.status!==state.status) return false;
    if(kws.length){ const hay=normSpace((e.law_title+' '+e.chapter+' '+e.article+' '+e.content).toLowerCase());
      if(!kws.every(k=>hay.includes(normSpace(k.toLowerCase())))) return false; }
    return true;
  });
}
function recomputeMatches(){
  const m=queryMatches();
  state.matchedLevels=new Set(m.map(e=>e.level));
  state.matchedLaws={};
  m.forEach(e=>{ (state.matchedLaws[e.level]=state.matchedLaws[e.level]||new Set()).add(e.law_title); });
  state.levelFilter=new Set(state.matchedLevels);
}
function setStatus(s){ state.status=s; recomputeMatches(); renderSearch(); renderSidebar(); }
function toggleLevelFilter(lv){
  if(!state.levelFilter) return;
  if(state.levelFilter.has(lv)) state.levelFilter.delete(lv); else state.levelFilter.add(lv);
  renderSidebar(); drawResults();
}
function clearFilters(){ state.status='全部'; recomputeMatches(); renderSearch(); renderSidebar(); }
function filterEntries(){
  const kws=tokenize(state.q);
  return searchData.filter(e=>{
    if(state.view==='search' && state.levelFilter && state.levelFilter.size && !state.levelFilter.has(e.level)) return false;
    if(state.status!=='全部' && e.status!==state.status) return false;
    if(kws.length){ const hay=normSpace((e.law_title+' '+e.chapter+' '+e.article+' '+e.content).toLowerCase());
      if(!kws.every(k=>hay.includes(normSpace(k.toLowerCase())))) return false; }
    return true;
  });
}
function drawResults(){
  const box0=document.getElementById('results'), meta0=document.getElementById('meta');
  if(!state.q){ if(meta0) meta0.textContent=''; if(box0) box0.innerHTML='<div class="empty">在右上角输入关键词，点击「原文检索」查看命中结果。</div>'; return; }
  const list=filterEntries();
  const kws=tokenize(state.q);
  list.sort((a,b)=>{
    const ab=(a.status==='已废止')?1:0,bb=(b.status==='已废止')?1:0; if(ab!==bb) return ab-bb;
    if(kws.length){ const ta=kws.some(k=>normSpace(a.law_title.toLowerCase()).includes(normSpace(k.toLowerCase())))?0:1;
      const tb=kws.some(k=>normSpace(b.law_title.toLowerCase()).includes(normSpace(k.toLowerCase())))?0:1; if(ta!==tb) return ta-tb; }
    return (LEVEL_ORDER[a.level]??9)-(LEVEL_ORDER[b.level]??9);
  });
  document.getElementById('meta').textContent='共匹配 '+list.length+' 条'+(state.q?'（"'+state.q+'"）':'');
  const box=document.getElementById('results');
  if(!list.length){ box.innerHTML='<div class="empty">未找到，换个关键词或清除筛选试试。</div>'; return; }
  box.innerHTML='';
  list.forEach(e=>{
    const c=document.createElement('div'); c.className='rcard';
    let sup='';
    if(e.status==='已废止'&&e.superseded_by) sup='<div class="sup">⚠️ 已废止 ｜ 替代：'+esc(e.superseded_by)+'</div>';
    c.innerHTML='<div class="top"><span class="lt">'+hl(e.law_title,kws)+'</span>'+lawTag(e)+'</div>'+
      '<div class="art">'+hl(e.article,kws)+'</div><div class="chap">'+hl((e.chapter||'（未分章）'),kws)+'</div>'+
      '<div class="content">'+hl(e.content,kws)+'</div>'+sup;
    c.onclick=()=>openLaw(e.law_title);
    box.appendChild(c);
  });
}

/* ============ AI 问答（检索增强） ============ */
function renderAI(){
  const v=document.getElementById('view');
  v.innerHTML='<div class="ai-note">💡 <b>当前为「检索增强」模式</b>：基于你的知识库检索相关条文并归纳要点。接入豆包大模型（需提供 endpoint ID）后，可生成自然语言回答并逐条引用出处。</div>'+
    '<div class="ai-box"><textarea id="aique" placeholder="例如：施工单项合同多少金额必须招标？哪些情形可以不招标？转包和分包有什么区别？"></textarea>'+
    '<button onclick="askAI()">查找相关法规要点</button></div>'+
    '<div id="aians"></div>';
}
function askAI(){
  const q=document.getElementById('aique').value.trim();
  const box=document.getElementById('aians');
  if(!q){ box.innerHTML='<div class="empty">请输入问题</div>'; return; }
  const kws=tokenize(q);
  const top=searchData.filter(e=>{
    const hay=normSpace((e.law_title+' '+e.chapter+' '+e.article+' '+e.content).toLowerCase());
    return kws.some(k=>hay.includes(normSpace(k.toLowerCase())));
  }).sort((a,b)=>{
    const sa=kws.filter(k=>normSpace(a.content.toLowerCase()).includes(normSpace(k.toLowerCase()))).length;
    const sb=kws.filter(k=>normSpace(b.content.toLowerCase()).includes(normSpace(k.toLowerCase()))).length;
    return sb-sa;
  }).slice(0,12);
  if(!top.length){ box.innerHTML='<div class="empty">未检索到相关条文，试试更通用的关键词（如「招标」「资质」「合同」）。</div>'; return; }
  // 按法规分组
  const groups={};
  top.forEach(e=>{ (groups[e.law_title]=groups[e.law_title]||[]).push(e); });
  let html='<div class="ai-res"><h3>📋 相关法规要点（共 '+top.length+' 条，来自 '+Object.keys(groups).length+' 部法规）</h3>';
  Object.keys(groups).forEach(g=>{
    html+='<div class="ai-grp"><div class="gt">'+esc(g)+'</div>';
    groups[g].forEach(e=>{
      html+='<div class="gi"><b>'+hl(e.article,kws)+'</b> （'+(e.chapter||'未分章')+'）｜ '+hl(e.content.slice(0,120),kws)+'…</div>';
    });
    html+='</div>';
  });
  html+='<div class="ai-note" style="margin-top:18px">以上为检索到的现行/相关条文要点。点击左侧法规库可点开对应法规完整学习；接入 AI 后将自动归纳成连贯解答。</div></div>';
  box.innerHTML=html;
}

/* ============ 左侧法规库 拖拽调宽 ============ */
(function(){
  const lp=document.getElementById('leftPanel');
  const rz=document.getElementById('leftResizer');
  if(!lp||!rz) return;
  let drag=false;
  function setW(x){ let w=x; if(w<180)w=180; if(w>480)w=480; lp.style.width=w+'px'; }
  rz.addEventListener('mousedown',e=>{drag=true;rz.classList.add('drag');document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault();});
  window.addEventListener('mousemove',e=>{ if(!drag)return; setW(e.clientX-18); });
  window.addEventListener('mouseup',()=>{ if(drag){drag=false;rz.classList.remove('drag');document.body.style.cursor='';document.body.style.userSelect='';} });
  rz.addEventListener('touchstart',e=>{drag=true;e.preventDefault();},{passive:false});
  window.addEventListener('touchmove',e=>{ if(!drag||!e.touches[0])return; setW(e.touches[0].clientX-18); },{passive:true});
  window.addEventListener('touchend',()=>{drag=false;});
})();

/* 右边界感应：隐藏目录后，鼠标移入右缘临时悬浮显示，离开即收起（带防抖避免边界抖动） */
(function(){
  const edge=document.getElementById('tocEdge');
  const rp=document.getElementById('rightPanel');
  if(edge) edge.addEventListener('mouseenter',()=>{ if(tocState==='hidden'){ clearTimeout(tocHideTimer); tocPeek=true; showToc('floating', true); } });
  if(rp){
    rp.addEventListener('mouseenter',()=>{ clearTimeout(tocHideTimer); });
    rp.addEventListener('mouseleave',()=>{ if(tocPeek){ clearTimeout(tocHideTimer); tocHideTimer=setTimeout(()=>{ tocPeek=false; hideToc(); }, 180); } });
  }
})();

boot();
