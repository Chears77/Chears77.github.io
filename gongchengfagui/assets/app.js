
/* ===== 第二版：数据加载层（替代 v1 内嵌数据） ===== */
let LAWS=[], LAW_TITLES=[], READ={}, LAW_BY_TITLE={}, searchData=null, searchLoading=null;
const RE_ART_MD=/^###\s*第[一二三四五六七八九十百零0-9]+[条款]/;
function fetchLawMd(law){
  return fetch(encodeURI('./'+law.file), {cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); });
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
  searchLoading = fetch(encodeURI('./data/search.json'), {cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(d){ searchData=d; return d; });
  return searchLoading;
}
async function boot(){
  try{
    const r=await fetch(encodeURI('./data/manifest.json'), {cache:'no-cache'});
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
  if(q){ const t=document.getElementById('topq'); if(t) t.value=q; if(qs.get('ai')){ doAI(); } else { doSearch(); } if(isMobile()) openLeftDrawer(); return; }
  if(location.hash){ try{ const t=decodeURIComponent(location.hash.slice(1)); if(LAW_BY_TITLE[t]){ openLaw(t); return; } }catch(e){} }
  renderHome();
  if(isMobile()) openLeftDrawer();
  // 后台预热检索索引：页面加载完即静默拉取 search.json，用户首次检索时已就绪（不再卡顿）
  ensureSearch().catch(function(){});
}


const LEVEL_ORDER = {'法律':0,'司法解释':1,'中央行政法规':2,'中央部门规章':3,'中央规范性文件':4,'地方行政法规':5,'地方规章':6,'地方规范性文件':7,'标准规范':8,'司法案例':9,'行政案例':10,'政策解读':11};
const LEVEL_NAMES = ['法律','司法解释','中央行政法规','中央部门规章','中央规范性文件','地方行政法规','地方规章','地方规范性文件','标准规范','司法案例','行政案例','政策解读'];
let state = { view:'home', law:null, q:'', status:'全部', homeView:'table', levelFilter:null, matchedLevels:null, matchedLaws:{}, browseLevel:null, library:null, customLib:null, sort:'time_desc', scrollToLaw:null, aiViewHtml:null, aiMode:'api', aiProv:'deepseek', aiModel:'', answerCache:{}, searchMode:'precise', lawReturn:null, aiFromLaw:false, aiAnsHtml:null, aiAnswered:false, aiHeadings:[], aiOutlineOpen:false, topMode:null };
/* 各服务商 API Key 是否通过「测试连接」（持久化，刷新后保留；未通过则仍显示配置界面） */
function aiTestGet(p){ try{ const v=localStorage.getItem('aitest_'+(p||'deepseek')); return (v==='ok'||v==='1')?'ok':(v==='fail'?'fail':null); }catch(e){ return null; } }
function aiTestSet(p,val){ try{ localStorage.setItem('aitest_'+(p||'deepseek'), val==='ok'?'ok':(val==='fail'?'fail':'')); }catch(e){} }
let tocState='hidden';   // docked(停靠) | floating(悬浮) | hidden(隐藏)
let tocPeek=false;       // 是否处于「边界感应悬浮」状态（鼠标离开即收起）
let tocHideTimer=null;   // 收起延时，避免边界抖动
let tocExpandedCh=new Set();   // 右栏大纲中展开的章节索引
let tocAllExpanded=false;      // 右栏大纲「全部展开」状态（仅用于图标切换参考）
let spyObserver=null;    // 滚动高亮观察者（保留以兼容 closeLaw / resetBodyMarks 的解绑）
let spyRaf=null, spyScrollAttached=false, tocGoal=-1, tocUserTimer=null, spyTocRaf=null, tocFollowTarget=null;  // 连续滚动跟随状态（tocGoal=程序化滚动目标值，用于区分用户手动滚动）
let aiSpyRaf=null;   // AI 答案目录滚动高亮的 rAF 句柄
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
/* 左侧面板「返回列表」图标（Feather arrow-left，仅打开法规时显示） */
const ICON_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
/* 平滑滚动到页脚「外部权威法规库」区块 */
function scrollToFootlinks(){ var f=document.getElementById('footlinks'); if(!f) return; var y=f.getBoundingClientRect().top+window.pageYOffset-64; window.scrollTo({top:y, behavior:'smooth'}); }
function lawTag(e){
  const field=(e.field&&String(e.field).trim())?('<span class="tag field">'+esc(e.field)+'</span>'):'';
  return '<span class="tag '+lvClass(e.level)+'">'+esc(e.level||'')+'</span>'+field+
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
  /* 移动端：关闭右抽屉并隐藏其触发图标 */
  document.body.classList.remove('toc-available','right-open');
  const rpd=document.getElementById('rightPanel'); if(rpd) rpd.classList.remove('drawer-open');
  updateScrim();
}
function switchView(v){
  state.view=v; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; state.browseLevel=null; state.scrollToLaw=null;
  if(v==='home') state.topMode=null;   // 回到首页：顶栏两个按钮都恢复中性（不加深）
  if(v!=='read') hideRightPanel();
  if(v==='home') renderHome();
  renderSidebar();
  updateHdrButtons();
  window.scrollTo(0,0);
}
/* 顶栏「原文检索 / AI问答」按钮：根据当前所在上下文高亮（点哪个哪个加深） */
function updateHdrButtons(){
  const sb=document.getElementById('hdrSearch'), ab=document.getElementById('hdrAi');
  if(sb) sb.classList.toggle('active', state.topMode==='search');
  if(ab) ab.classList.toggle('active', state.topMode==='ai');
}
/* 从阅读视图返回列表，并在中间栏定位到该法规的位置（点击面包屑层级或「返回列表」按钮时调用） */
function backToList(title){
  const lw=getLaw(title);
  state.view='home'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; state.topMode=null;   // 回到列表：顶栏两按钮恢复中性
  state.browseLevel = lw? lw.level : null;   // 聚焦到该法规所属层级，列表更聚焦
  state.scrollToLaw = title;
  hideRightPanel(); renderHome(); renderSidebar(); updateHdrButtons();
}
/* 右上角：原文检索 —— 全文搜索 */
async function doSearch(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='search'; state.law=null; state.topMode='search';
  updateHdrButtons();
  hideRightPanel();
  if(!searchData){
    // 冷加载：先渲染检索框架并给出加载提示，避免白屏卡顿
    renderSearch(); renderSidebar();
    const box=document.getElementById('results'); if(box) box.innerHTML='<div class="empty">⏳ 正在加载检索索引（首次访问约需几秒）…</div>';
  }
  try{ await ensureSearch(); }catch(e){}
  recomputeMatches();
  renderSearch(); renderSidebar(); window.scrollTo(0,0);
}
/* 右上角：AI 问答 —— 检索增强（有输入框则预填并自动回答） */
async function doAI(){
  const q=document.getElementById('topq').value.trim();
  state.q=q; state.view='ai'; state.law=null; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; state.aiOutlineOpen=false; state.topMode='ai';   // 重新进入 AI：大纲默认关闭
  updateHdrButtons();
  hideRightPanel();
  renderAI(); renderSidebar();
  if(q){ try{ await ensureSearch(); }catch(e){} askAI(); }
  window.scrollTo(0,0);
}
function clearSearch(){ const t=document.getElementById('topq'); if(t) t.value=''; state.q=''; state.levelFilter=null; state.matchedLevels=null; state.matchedLaws={}; switchView('home'); }

/* ============ 首页：法规框架目录 ============ */
function renderHome(){
  state.aiViewHtml=null;
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
        const idx=LAW_TITLES.indexOf(l.title);
        html += '<div class="lcard" data-idx="'+idx+'" onclick="openLaw(\''+l.title.replace(/'/g,"\\'")+'\')">'+
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
        const idx=LAW_TITLES.indexOf(l.title);
        html += '<tr data-idx="'+idx+'" onclick="openLaw(\''+l.title.replace(/'/g,"\\'")+'\')">'+
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
  // 返回列表后，在中间栏定位到目标法规（browseLevel 已限定层级，列表更聚焦）
  if(state.scrollToLaw){
    const idx=LAW_TITLES.indexOf(state.scrollToLaw);
    const el=v.querySelector('[data-idx="'+idx+'"]');
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
    state.scrollToLaw=null;
  }
}

/* ============ 阅读视图 ============ */
async function openLaw(title, fromAi, targetArticle){
  const prevView=state.view;             // 进入阅读前的视图（home/table/search/ai），用于「返回上一个界面」
  const prevScroll=window.pageYOffset;   // 进入阅读前的滚动位置（返回时还原）
  state.law=title; state.view='read'; state.aiFromLaw=!!fromAi;
  // 调用方（openLawCite / openLawFromSearch）已设置 lawReturn 则尊重之；否则按进入前的视图决定返回目标
  if(!state.lawReturn){
    if(prevView==='ai'){ state.aiViewHtml=(document.getElementById('view')||{}).innerHTML||''; state.lawReturn={type:'ai', scrollY:prevScroll, open:!!state.aiOutlineOpen}; }
    else if(prevView==='search'){ state.lawReturn={type:'search', scrollY:prevScroll}; }
    // 其余（home/table 等）→ lawReturn 保持 null，返回「列表」
  }
  if(isMobile()) closeLeftDrawer();
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
    if(isMobile()){ const rp=document.getElementById('rightPanel'); if(rp) rp.classList.remove('hidden','floating'); document.body.classList.add('toc-available'); closeRightDrawer(); }
    else { showToc('docked', false); }
    const cur=document.querySelector('.tnode.law.cur'); if(cur) cur.scrollIntoView({block:'nearest'});
    // 从「原文检索」点开：定位到具体命中条文（而非停在顶部）；与 AI 援引 openLawCite 定位逻辑一致
    if(targetArticle){
      const key=(targetArticle||'').match(/第[一二三四五六七八九十百零两0-9]+条/);
      const term=key?key[0]:targetArticle;   // 取首个"第X条"，兼容"第十三条至第十五条"区间写法
      const heads=v.querySelectorAll('.an');
      let target=null;
      heads.forEach(hh=>{ if(hh.textContent.indexOf(term)>=0) target=hh; });
      if(target) scrollToEl(target, 8);   // scrollToEl 已补偿顶层 header + sticky 面包屑遮挡
      else window.scrollTo(0,0);
    } else {
      window.scrollTo(0,0);
    }
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
  const lw=getLaw(title);
  const lr=state.lawReturn;
  const backTitle = lr ? (lr.type==='search' ? '返回刚才的检索结果' : '返回刚才的 AI 回答') : '返回列表';
  const backFn = lr ? 'returnFromLaw()' : 'backToList(state.law)';
  let h='<div class="crumb"><span class="crumb-path"><a onclick="switchView(\'home\')">目录</a> › <a onclick="backToList(\''+title.replace(/'/g,"\\'")+'\')">'+esc(lw?lw.level:'')+'</a> › <b>'+esc(title)+'</b></span>'+
    '<button class="crumb-back" title="'+backTitle+'" onclick="'+backFn+'">'+ICON_BACK+'<span>'+backTitle+'</span></button></div>';
  h+='<div class="read-head"><h1>'+esc(title)+'</h1></div>';
  // 语雀式发布信息表
  h+='<table class="info-table">';
  h+='<tr><td class="label">文号</td><td class="value">'+esc(m.doc_number||'—')+'</td>'+
     '<td class="label">发布机关</td><td class="value">'+esc(m.publisher||'—')+'</td></tr>';
  h+='<tr><td class="label">颁布时间</td><td class="value">'+esc(m.publish_date||'—')+'</td>'+
     '<td class="label">实施时间</td><td class="value">'+esc(m.effective_date||'—')+'</td></tr>';
  h+='<tr><td class="label">修订时间</td><td class="value">'+(m.revise_date||'—')+'</td>'+
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
  if(state.view==='ai'){ return exportAiAnswer(fmt); }   // AI 问答视图：导出当前回答（而非法规）
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
/* AI 回答导出（与法规导出共用 downloadBlob / EXPORT_DOC_CSS 基础设施） */
function aiAnsToMarkdown(root){
  let out='';
  function textOf(el){ return (el.textContent||'').replace(/\s+/g,' ').trim(); }
  root.childNodes.forEach(function(node){
    if(node.nodeType===3){ const t=node.nodeValue.trim(); if(t) out+=t+'\n'; return; }
    if(node.nodeType!==1) return;
    const tag=node.tagName.toLowerCase();
    if(tag==='h2') out+='## '+textOf(node)+'\n\n';
    else if(tag==='h3') out+='### '+textOf(node)+'\n\n';
    else if(tag==='h4'||tag==='h5'||tag==='h6') out+='#### '+textOf(node)+'\n\n';
    else if(tag==='p') out+=textOf(node)+'\n\n';
    else if(tag==='ul'){ node.querySelectorAll(':scope > li').forEach(function(li){ out+='- '+textOf(li)+'\n'; }); out+='\n'; }
    else if(tag==='ol'){ let n=1; node.querySelectorAll(':scope > li').forEach(function(li){ out+=(n++)+'. '+textOf(li)+'\n'; }); out+='\n'; }
    else if(tag==='blockquote') out+='> '+textOf(node).replace(/\n+/g,' ')+'\n\n';
    else if(tag==='pre') out+='```\n'+textOf(node)+'\n```\n\n';
    else if(tag==='table') out+=textOf(node)+'\n\n';
    else out+=textOf(node)+'\n\n';
  });
  return out.trim()+'\n';
}
function buildAiExportHtml(q, bodyHtml){
  const h='<div class="doc-title">'+esc('AI 回答 · '+q)+'</div>'+
    '<div class="doc-q">问题：'+esc(q)+'</div>'+
    '<div class="ai-ans">'+bodyHtml+'</div>'+
    '<div class="doc-end">本文由「工建法研 · 工程建设法规库」AI 问答生成，仅供学习参考，正式引用请以官方公报为准。</div>';
  var css=EXPORT_DOC_CSS+' h2.ai-h,h3.ai-h,h4.ai-h{margin:20px 0 10px;color:#1677ff;border-left:5px solid #1677ff;padding-left:12px;font-weight:700;font-size:18px}h3.ai-h{font-size:16px;color:#4096ff}h4.ai-h{font-size:14.5px;color:#262626;border-color:#bfbfbf}.ai-ans p{margin:10px 0;font-size:14.5px}.ai-ans ul,.ai-ans ol{margin:10px 0;padding-left:24px}.ai-ans li{margin:6px 0}.ai-ans blockquote{margin:10px 0;padding:8px 14px;background:#f7fbff;border-left:4px solid #1677ff;color:#555}.ai-ans pre{background:#f5f5f5;border:1px solid #eee;border-radius:8px;padding:12px;font-size:13px;white-space:pre-wrap}.ai-ans a{color:#1677ff;text-decoration:underline}.doc-q{margin-bottom:14px;color:#555;font-size:13.5px}';
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(q)+'</title><style>'+css+'</style></head><body>'+h+'</body></html>';
}
async function exportAiAnswer(fmt){
  const ans=document.querySelector('#aians .ai-ans');
  const q=state.q||'AI回答';
  if(!ans || !ans.textContent.trim()){ alert('当前没有可导出的回答'); return; }
  if(fmt==='md'){
    downloadBlob(aiAnsToMarkdown(ans), safeName(q)+'.md', 'text/markdown');
  } else {
    const doc=buildAiExportHtml(q, ans.innerHTML);
    if(fmt==='doc'){ downloadBlob(doc, safeName(q)+'.doc', 'application/msword'); }
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
  const rt=document.getElementById('rpTitle'); if(rt) rt.textContent='大纲';   // 阅读法规时右栏标题还原为「大纲」
  const tocAll=document.getElementById('tocAllBtn'); if(tocAll) tocAll.style.display='';   // 法规大纲有章节树，恢复「折叠/展开全部」
  const emt=document.querySelector('#expMenu .exp-menu-t'); if(emt) emt.textContent='导出当前法规';   // 导出菜单随上下文切换文案
  const dbtn=document.querySelector('#rightPanel .exp-wrap > button'); if(dbtn) dbtn.title='导出当前法规';
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
/* AI 答案目录：与法规大纲保持一致的「两级结构」——一级（章/节，蓝）、二级（条/点，灰）。
   关键：一级按「语义」判定（结论 / 一、二、 / 第X章 等同级），而非机械按 Markdown 深度，
         否则 AI 把「一、」「（一）」写成同深度时会被拆乱。 */
function renderAiToc(){
  const c=document.getElementById('toc'); if(!c) return;
  const hs=state.aiHeadings||[];
  if(!hs.length){ c.innerHTML='<div class="toc-empty">本回答为纯文本，未分节标题。</div>'; return; }
  function strip(s){ return (s||'').replace(/<[^>]+>/g,''); }
  function cleanAttr(s){ return strip(s).replace(/"/g,'&quot;'); }
  // 一级（章/节）语义判定
  function isMajor(t){
    const s=strip(t).trim();
    if(/^(结论|总结|概述|导语|前言|引言|摘要|导读|说明|开篇|要点|建议|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、)/.test(s)) return true;
    if(/^第[一二三四五六七八九十百千零两0-9]+[章卷编部分节]/.test(s)) return true;
    if(/^[一二三四五六七八九十百千零两]+[、.．]/.test(s)) return true;   // 一、 二、 …… 与「结论」同级
    return false;
  }
  // 二级（条/点）语义判定——仅用于把同级的编号小点降级，防止被误判为一级
  function isMinor(t){
    const s=strip(t).trim();
    if(/^[0-9]+[.、．]/.test(s)) return true;                          // 1. 2. 数字编号点
    if(/^（[一二三四五六七八九十]+）/.test(s)) return true;            // （一）（二）
    if(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/.test(s)) return true;            // ①②③
    if(/^\([a-zA-Z0-9]+\)/.test(s)) return true;                      // (1)(a)
    return false;
  }
  let minLv=99; hs.forEach(function(it){ if(it.level<minLv) minLv=it.level; });
  function major(it){ return isMajor(it.text) || (it.level===minLv && !isMinor(it.text)); }
  // 归一为两级
  const groups=[]; let cur=null;
  hs.forEach(function(it){
    if(major(it)){
      cur={id:it.id, text:it.text, children:[]};
      groups.push(cur);
    } else {
      if(!cur){ cur={id:it.id, text:it.text, children:[]}; groups.push(cur); }   // 首个即子级 → 自身作一级
      else cur.children.push({id:it.id, text:it.text});
    }
  });
  let h='<div class="toc-list">';
  groups.forEach(function(g, idx){
    const label=g.text;                       // 显示保留加粗等行内样式
    const tip=cleanAttr(g.text);
    if(g.children.length){
      h+='<div class="toc-ch ai-ch exp" id="aich-'+idx+'">'+
         '<a class="ai-lv1 ai-toc" data-id="'+esc(g.id)+'" href="javascript:;" onclick="jump(\''+esc(g.id)+'\')" title="'+tip+'">'+
           '<span class="toc-arrow" onclick="event.stopPropagation();toggleAiCh('+idx+')">▸</span>'+
           '<span>'+label+'</span></a>'+
         '<div class="toc-arts">'+
           g.children.map(function(ch){ const cl=cleanAttr(ch.text); return '<a class="toc-art ai-lv2 ai-toc" data-id="'+esc(ch.id)+'" onclick="jump(\''+esc(ch.id)+'\')" title="'+cl+'">'+ch.text+'</a>'; }).join('')+
         '</div>'+
       '</div>';
    } else {
      h+='<a class="ai-toc toc-leaf" data-id="'+esc(g.id)+'" href="javascript:;" onclick="jump(\''+esc(g.id)+'\')" title="'+tip+'">'+label+'</a>';
    }
  });
  h+='</div>';
  c.innerHTML=h;
}
/* 显示 AI 答案目录。show=true 时直接停靠显示（用于「从法条返回且曾手动打开」的恢复）；
   不传则默认隐藏在右侧、鼠标靠近右边自动浮现；右下角不出现图标；标题统一为「大纲」 */
function showAiAnswerToc(show){
  const hs=state.aiHeadings||[];
  const rt=document.getElementById('rpTitle'); if(rt) rt.textContent='大纲';   // AI 视图右栏标题统一为「大纲」（非"回答大纲"）
  const pill=document.getElementById('tocPill'); if(pill) pill.style.display='none';   // 右下角不出现图标
  const edge=document.getElementById('tocEdge');
  const tocAll=document.getElementById('tocAllBtn'); if(tocAll) tocAll.style.display='';   // 与法规大纲一致：AI 大纲同样显示「折叠/展开全部」按钮
  // 导出菜单随上下文切换文案：AI 视图 → 导出当前回答
  const emt=document.querySelector('#expMenu .exp-menu-t'); if(emt) emt.textContent='导出当前回答';
  const dbtn=document.querySelector('#rightPanel .exp-wrap > button'); if(dbtn) dbtn.title='导出当前回答';
  if(!hs.length){ if(edge) edge.style.display='none'; return; }   // 纯文本无小标题：连右缘感应区也收起
  renderAiToc();
  updateTocAllBtn();   // 同步「折叠/展开全部」图标与可用状态
  if(isMobile()){ openRightDrawer(); return; }   // 移动端仍走抽屉，保证可用
  tocPeek=false; clearTimeout(tocHideTimer);     // 避免返回恢复时残留的边界感应计时器误收起
  const rp=document.getElementById('rightPanel');
  if(show){
    tocState='docked'; rp.classList.remove('hidden','floating');   // 返回且曾手动打开：直接停靠显示（持续可见）
    if(edge) edge.style.display='none';
  } else {
    tocState='hidden'; rp.classList.add('hidden');                 // 桌面：默认隐藏，鼠标靠近右边自动浮现
    if(edge) edge.style.display='block';
  }
  attachAiScrollSpy();
  aiScrollSpy();                                      // 立即高亮一次当前位置
}
/* 答案目录滚动高亮（监听 window 滚动，rAF 节流；与法规阅读高亮互不干扰） */
function attachAiScrollSpy(){
  if(window.__aiSpyAttached) return; window.__aiSpyAttached=true;
  window.addEventListener('scroll', aiScrollSpy, {passive:true});
}
function aiScrollSpy(){
  if(aiSpyRaf) return;
  aiSpyRaf=requestAnimationFrame(function(){
    aiSpyRaf=null;
    const items=document.querySelectorAll('#toc .ai-toc');
    if(!items.length) return;   // 非 AI 视图（无 .ai-toc）直接跳过
    const header=document.querySelector('header');
    let off=58; if(header) off=header.offsetHeight; off+=12;   // AI 视图无 .crumb 遮挡
    let cur='';
    document.querySelectorAll('.ai-h').forEach(function(el){ if(el.getBoundingClientRect().top-off<=4) cur=el.id; });
    const all=document.querySelectorAll('.ai-h');
    if(!cur && all.length) cur=all[0].id;
    // 先清除全部高亮
    items.forEach(function(it){ it.classList.remove('active'); });
    document.querySelectorAll('#toc .toc-ch>a.ai-lv1').forEach(function(it){ it.classList.remove('ch-active'); });
    if(!cur) return;
    const el=document.querySelector('#toc .ai-toc[data-id="'+cur+'"]');
    if(!el) return;
    if(el.classList.contains('ai-lv2')){
      // 二级激活：自身灰底；其父一级变蓝（与法规大纲「章蓝·条灰」一致）
      el.classList.add('active');
      const ch=el.closest('.toc-ch');
      if(ch){ const link=ch.querySelector('a.ai-lv1'); if(link) link.classList.add('ch-active'); }
    } else {
      // 一级激活：变蓝
      el.classList.add('active');
    }
  });
}
function toggleTocCh(i){ if(!state.law) return; if(tocExpandedCh.has(i)) tocExpandedCh.delete(i); else tocExpandedCh.add(i); renderToc(state.law); }
/* 单个 AI 大纲分组（一级章节）的折叠/展开（与法规大纲章节展开一致） */
function toggleAiCh(idx){ const r=document.getElementById('aich-'+idx); if(!r) return; r.classList.toggle('exp'); updateTocAllBtn(); }
/* 折叠/展开全部大纲：法规视图折叠章节、AI 视图折叠各标题条目，图标随实际状态同步 */
function toggleTocAll(){
  if(state.view==='ai'){
    const rows=document.querySelectorAll('#toc .ai-ch');
    if(!rows.length) return;
    const allOpen=Array.from(rows).every(r=>r.classList.contains('exp'));
    rows.forEach(r=>r.classList.toggle('exp', !allOpen));
    updateTocAllBtn();
    return;
  }
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
  if(state.view==='ai'){
    const rows=document.querySelectorAll('#toc .ai-ch');
    if(!rows.length){ b.textContent='⊞'; b.style.opacity='0.4'; return; }
    const allOpen=Array.from(rows).every(r=>r.classList.contains('exp'));
    b.textContent=allOpen?'⊟':'⊞';
    b.style.opacity='';
    return;
  }
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
  if(isMobile()){ openRightDrawer(); return; }
  const rp=document.getElementById('rightPanel'), pill=document.getElementById('tocPill'), edge=document.getElementById('tocEdge');
  if(mode) tocState=mode;
  tocPeek=(typeof peek==='boolean')?peek:false;
  clearTimeout(tocHideTimer);
  rp.classList.remove('hidden','floating');
  if(tocState==='floating') rp.classList.add('floating');
  pill.style.display='none'; if(edge) edge.style.display='none';
  if(document.querySelector('#toc .ai-toc')) state.aiOutlineOpen=true;   // 当前显示的是 AI 答案大纲 → 记为已手动打开
}
function hideToc(){ if(isMobile()){ closeRightDrawer(); return; } tocState='hidden'; const rp=document.getElementById('rightPanel'); if(rp) rp.classList.add('hidden'); const e=document.getElementById('tocEdge'); if(e) e.style.display='block'; if(state.view==='ai' && !tocPeek) state.aiOutlineOpen=false; }   // AI 视图且为显式关闭（非边界感应自动收起）→ 记为未打开
function toggleTocMode(){ tocState=(tocState==='floating')?'docked':'floating'; showToc(null, false); }
/* 平滑滚动到元素，并补偿顶层 sticky header（58px）+ 阅读页 sticky 面包屑（.crumb）的遮挡，避免定位「差一条」 */
function scrollToEl(el, extra){
  if(!el) return;
  let off=0;
  const header=document.querySelector('header');
  if(header) off+=header.offsetHeight;
  const crumb=document.querySelector('.crumb');   // 仅阅读视图存在；AI 视图无此遮挡
  if(crumb) off+=crumb.offsetHeight;
  off += (extra||0);
  const rect=el.getBoundingClientRect();
  const y=window.pageYOffset + rect.top - off - 8;
  window.scrollTo({top:Math.max(0,y), behavior:'smooth'});
}
function jump(id){ const el=document.getElementById(id); if(el) scrollToEl(el, 8); if(isMobile()) closeRightDrawer(); }
/* ============ 移动端抽屉（左右栏悬浮 / 收为图标） ============ */
function isMobile(){ return window.matchMedia('(max-width:820px)').matches; }
function openLeftDrawer(){ if(!isMobile()) return; const lp=document.getElementById('leftPanel'); if(lp) lp.classList.add('drawer-open'); document.body.classList.add('left-open'); updateScrim(); }
function closeLeftDrawer(){ const lp=document.getElementById('leftPanel'); if(lp) lp.classList.remove('drawer-open'); document.body.classList.remove('left-open'); updateScrim(); }
function openRightDrawer(){ if(!isMobile()) return; const rp=document.getElementById('rightPanel'); if(rp) rp.classList.add('drawer-open'); document.body.classList.add('right-open'); updateScrim(); }
function closeRightDrawer(){ const rp=document.getElementById('rightPanel'); if(rp) rp.classList.remove('drawer-open'); document.body.classList.remove('right-open'); updateScrim(); }
function closeDrawers(){ closeLeftDrawer(); closeRightDrawer(); }
function updateScrim(){ const s=document.getElementById('scrim'); if(!s) return; const open=document.body.classList.contains('left-open')||document.body.classList.contains('right-open'); s.classList.toggle('show', open); }

/* ============ 右栏正文搜索（在当前阅读文档内高亮关键词） ============ */
function escRe(s){ return (s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
/* 当前可检索/高亮的正文容器：法规阅读视图取 .read-body，AI 问答视图取 .ai-ans */
function getActiveBody(){
  let b=document.querySelector('#view .read-body');
  if(b) return b;
  return document.querySelector('#view .ai-ans');
}
function resetBodyMarks(){
  const body=getActiveBody();
  if(!body) return;
  if(state.view==='ai' && state.aiAnsHtml){ const a=document.getElementById('aians'); if(a) a.innerHTML=state.aiAnsHtml; }   // AI 视图：从暂存答案复位（去掉高亮）
  else if(readBodyHtml){ body.innerHTML=readBodyHtml; }   // 法规视图：从原文 HTML 复位
  bodyMarks=[]; bsCur=-1;
  if(spyObserver){ spyObserver.disconnect(); spyObserver=null; }
  if(state.view!=='ai') startScrollSpy();   // AI 视图不重新绑定法规阅读滚动高亮（避免与答案目录高亮互相干扰）
}
function applyBodySearch(){
  const input=document.getElementById('bodySearch');
  const q=input?(input.value||'').trim():'';
  const countEl=document.getElementById('bsCount');
  const prevBtn=document.getElementById('bsPrev'), nextBtn=document.getElementById('bsNext');
  if(!getActiveBody()){ if(countEl) countEl.textContent=''; return; }
  resetBodyMarks();   // 每次输入都从干净正文重新高亮（AI 视图会先重渲染 #aians）
  const body=getActiveBody();   // 复位后重新取容器（AI 视图已重渲染，旧引用已脱离文档）
  if(!body){ if(countEl) countEl.textContent=''; return; }
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
  let html='<div class="ai-wrap">';
  // 头部：与 AI 问答完全一致（复用 .ai-head / .ai-seg，banner 与模式切换同款、同位置）
  html+='<div class="ai-head">'+
    '<div class="ai-title">原文检索<span class="ai-sep">／</span><span class="ai-sub2">精准 · 模糊检索</span></div>'+
    '<div class="ai-head-r">'+
      '<div class="ai-seg">'+
        '<button class="ai-seg-btn'+(state.searchMode==='precise'?' active':'')+'" onclick="setSearchMode(\'precise\')">精准检索</button>'+
        '<button class="ai-seg-btn'+(state.searchMode==='fuzzy'?' active':'')+'" onclick="setSearchMode(\'fuzzy\')">模糊检索</button>'+
      '</div>'+
    '</div></div>';
  // 仅保留状态小开关（层级筛选已移至左侧树）
  html+='<div class="chips" style="margin-top:0">';
  ['全部','现行','已废止'].forEach(s=>{ html+='<span class="chip'+(state.status===s?' active':'')+'" onclick="setStatus(\''+s+'\')">'+s+'</span>'; });
  html+='</div>';
  html+='<div class="result-meta" id="meta"></div><div id="results"></div>';
  html+='</div>';
  v.innerHTML=html;
  drawResults();
}
function setSearchMode(m){ state.searchMode=m; recomputeMatches(); renderSearch(); }
function queryMatches(){
  const kws=tokenize(state.q);
  if(state.searchMode!=='precise'){
    /* 模糊检索：用本地检索底座取 Top 200 作为命中集（供左侧层级统计，不强制全词命中） */
    return aiRetrieve(state.q, 200);
  }
  return searchData.filter(e=>{
    if(state.status!=='全部' && e.status!==state.status) return false;
    if(kws.length){ const hay=normSpace((e.law_title+' '+e.chapter_title+' '+e.article+' '+e.content).toLowerCase());
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
function filterEntries(){
  const kws=tokenize(state.q);
  return searchData.filter(e=>{
    if(state.view==='search' && state.levelFilter && state.levelFilter.size && !state.levelFilter.has(e.level)) return false;
    if(state.status!=='全部' && e.status!==state.status) return false;
    if(kws.length){ const hay=normSpace((e.law_title+' '+e.chapter_title+' '+e.article+' '+e.content).toLowerCase());
      if(!kws.every(k=>hay.includes(normSpace(k.toLowerCase())))) return false; }
    return true;
  });
}
function drawResults(){
  const box0=document.getElementById('results'), meta0=document.getElementById('meta');
  if(!state.q){ if(meta0) meta0.textContent=''; if(box0) box0.innerHTML='<div class="empty">在右上角输入关键词，点击「原文检索」查看命中结果。</div>'; return; }
  const kws=tokenize(state.q);
  let list;
  if(state.searchMode!=='precise'){
    /* 模糊检索：按相关性排序，不强制全词命中；侧栏层级筛选 + 状态筛选仍生效 */
    list=aiRetrieve(state.q, 200);
    if(state.view==='search' && state.levelFilter && state.levelFilter.size) list=list.filter(e=>state.levelFilter.has(e.level));
    if(state.status!=='全部') list=list.filter(e=>e.status===state.status);
    if(meta0) meta0.textContent='模糊检索命中 '+list.length+' 条（按相关性排序）'+(state.q?'（"'+state.q+'"）':'');
  } else {
    list=filterEntries();
    if(meta0) meta0.textContent='共匹配 '+list.length+' 条'+(state.q?'（"'+state.q+'"）':'');
  }
  const box=document.getElementById('results');
  if(!list.length){ box.innerHTML='<div class="empty">未找到，换个关键词或清除筛选试试。</div>'; return; }
  box.innerHTML='';
  list.forEach(e=>{
    const c=document.createElement('div'); c.className='rcard';
    let sup='';
    if(e.status==='已废止'&&e.superseded_by) sup='<div class="sup">⚠️ 已废止 ｜ 替代：'+esc(e.superseded_by)+'</div>';
    c.innerHTML='<div class="top"><span class="lt">'+hl(e.law_title,kws)+'</span>'+lawTag(e)+'</div>'+
      '<div class="art">'+hl(e.article,kws)+'</div><div class="chap">'+hl((e.chapter_title||'（未分章）'),kws)+'</div>'+
      '<div class="content">'+hl(e.content,kws)+'</div>'+sup;
    c.onclick=()=>openLawFromSearch(e.law_title, e.article);
    box.appendChild(c);
  });
}
/* 从「原文检索」结果点开法条：记录当前滚动位置，并返回时回到原处；article 为命中条号，用于定位到具体条文 */
function openLawFromSearch(title, article){
  state.lawReturn={type:'search', scrollY:window.pageYOffset};
  openLaw(title, true, article);
}

/* ============ AI 问答（混合：本地检索 + 本地模型 + 自带 Key） ============ */
/* 核心原则：无论哪种模式，都先在本地知识库检索相关条文作为依据，AI 只能引用真实条文，杜绝凭空编造。 */
const AI_PROVIDERS={
  deepseek:{name:'DeepSeek', url:'https://api.deepseek.com/chat/completions', model:'deepseek-v4-pro'},
  qwen:{name:'通义千问', url:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model:'qwen-plus'},
  zhipu:{name:'智谱 GLM', url:'https://open.bigmodel.cn/api/paas/v4/chat/completions', model:'glm-4-flash'},
  kimi:{name:'Kimi', url:'https://api.moonshot.cn/v1/chat/completions', model:'moonshot-v1-8k'}
};
function aiKeyGet(p){ try{ return JSON.parse(localStorage.getItem('aikey_'+p)||'null'); }catch(e){ return null; } }
function aiKeySet(p,k){ try{ localStorage.setItem('aikey_'+p, JSON.stringify(k)); }catch(e){} }
let localModel=null, localModelLoading=false;

function renderAI(){
  state.aiViewHtml=null; state.aiFromLaw=false; state.lawReturn=null;   // 进入 AI 面板即视为新会话，清除上一次「返回」暂存
  const v=document.getElementById('view');
  const mode=state.aiMode||'api';
  const p=state.aiProv||'deepseek'; const k=aiKeyGet(p); const hasKey=!!k;
  const testStatus = (mode==='api') ? aiTestGet(p) : null;          // 'ok' | 'fail' | null(未测)
  const keyOk = (mode==='api') && hasKey && testStatus==='ok';      // 已配置且测试通过 → 视为已连接
  // 设置区默认关闭；仅「未配置 Key」或「测试已失败」才默认展开；本地模式始终展开模型管理
  const settingsOpen = (mode==='api') ? ((!hasKey || testStatus==='fail') ? 'block' : 'none') : 'block';
  const seg=(m,label)=>'<button class="ai-seg-btn'+(mode===m?' active':'')+'" onclick="setAiMode(\''+m+'\')">'+label+'</button>';
  let html='<div class="ai-wrap">';
  // 头部：左上「AI 法规问答 ／ 普适回答·本库溯源」banner + 右上（⚙ 设置 + 模式切换）
  html+='<div class="ai-head">'+
    '<div class="ai-title">AI问答<span class="ai-sep">／</span><span class="ai-sub2">普适回答 · 本库溯源</span></div>'+
    '<div class="ai-head-r">'+
      (keyOk ? '<span class="ai-ok" onclick="toggleAiSettings()" title="已连接，点击管理">● 已连接 '+AI_PROVIDERS[p].name+'</span>'
             : '<button class="ai-gear" onclick="toggleAiSettings()" title="设置">⚙</button>')+
      '<div class="ai-seg">'+seg('api','API 模型')+seg('local','本地模型')+'</div>'+
    '</div></div>';
  html+='<div class="ai-settings" id="aiSettings" style="display:'+settingsOpen+'">'+aiSettingsHtml(mode)+'</div>';
  // 答案区：若已回答则保留（切换模式不丢失）；有问题但有答案区则渲染容器；否则提示去上方输入框提问
  if(state.aiAnsHtml && state.q){ html+='<div id="aians">'+state.aiAnsHtml+'</div>'; }
  else if(state.q){ html+='<div id="aians"></div>'; }
  else { html+='<div class="ai-empty">在上方搜索框输入你的问题，点击「AI问答」即可获得完整回答，关键条文可一键溯源到原文。</div>'; }
  html+='</div>';
  v.innerHTML=html;
  if(state.aiAnsHtml && state.q){ showAiAnswerToc(); }   // 已回答：恢复「回答大纲」（默认隐藏+右缘感应，不弹图标）；无答案则保持隐藏
}
function setAiMode(m){ state.aiMode=m; renderAI(); }   // 切换模式保留已生成的答案
function toggleAiSettings(){
  const s=document.getElementById('aiSettings'); if(!s) return;
  s.style.display=(s.style.display==='none'||!s.style.display)?'block':'none';
}
function aiSettingsHtml(mode){
  const p=state.aiProv||'deepseek'; const k=aiKeyGet(p); const curModel=(state.aiModel&&state.aiModel.trim())||AI_PROVIDERS[p].model;
  const provOpts=Object.keys(AI_PROVIDERS).map(pp=>'<option value="'+pp+'"'+(state.aiProv===pp?' selected':'')+'>'+AI_PROVIDERS[pp].name+'</option>').join('');
  if(mode==='api'){
    return '<div class="ai-set-row"><label>服务商</label><select id="aiProv" onchange="state.aiProv=this.value;state.aiModel=\'\';renderAI()">'+provOpts+'</select>'+
      '<input id="aiModel" class="ai-model" value="'+esc(curModel)+'" placeholder="模型名（留空用默认）" onchange="state.aiModel=this.value.trim()"></div>'+
      '<div class="ai-set-row"><button class="ai-setkey" onclick="openKeyModal()">'+(k?'更换 / 查看 Key':'设置 API Key')+'</button>'+
      '<span class="ai-key-status">'+(k?('● 已配置（'+esc(k.slice(0,4))+'…'+esc(k.slice(-4))+'）'):'○ 未配置')+'</span></div>';
  }
  if(mode==='local'){
    return '<div class="ai-set-row"><label>模型</label><select id="aiLocalModel">'+
      '<option value="Qwen/Qwen2.5-0.5B-Instruct">Qwen2.5-0.5B（快·小·约0.4GB）</option>'+
      '<option value="Qwen/Qwen2.5-1.5B-Instruct" selected>Qwen2.5-1.5B（准·大·约1.1GB）</option></select>'+
      '<button class="ai-setkey" onclick="loadLocalModel()">'+(localModel?'重新加载':'加载本地模型')+'</button>'+
      '<span class="ai-key-status" id="lmStatus">'+(localModel?'● 已加载':(localModelLoading?'加载中…':'○ 未加载（首次需下载）'))+'</span></div>'+
      '<div class="ai-progress" id="lmProg" style="display:none;height:8px;background:#f0f0f0;border-radius:6px;overflow:hidden;margin:0 0 10px"><div class="ai-progress-bar" id="lmBar" style="height:100%;width:0;background:linear-gradient(90deg,#1677ff,#69b1ff);transition:width .2s"></div></div>';
  }
  return '';
}

/* 本地检索底座：返回与问题最相关的条文（援引来源） */
/* 中文友好的关键词提取：去疑问词/虚词，对中文串做 2/3/4-gram 滑动召回，
   解决"整句作为一个 token 匹配不到"的问题（如「必须招标工程是什么条件」→ 命中「招标」） */
function aiKeywords(q){
  const STOP=new Set(['必须','什么','条件','怎么','哪些','如何','是否','可以','应该','需要','依据','根据','请问','问题','吗','呢','的','了','是','在','和','与','及','或','对','为','一个','我','你','他','这','那','有','没有','不','也','都','就','而','等','中','上','下','后','前','时','将','把','被','给','让','使','其','该','此','并','但','若','如','因','由于','对于','关于','以及','或者','进行','通过','属于','包括','涉及','相关','情况','情形','一些','这种','那种','我们','你们','他们','自己','这样','那样','到底','究竟','能否','可否','大概','可能','一般','通常','具体','的话','是什么','该问题','本问题','这一','这个']);
  const GEN=new Set(['工程','建设','项目','管理']); /* 泛词：近乎每条条文都有，排除其对召回的干扰 */
  const segs=(q||'').toLowerCase().split(/[^一-龥a-z0-9]+/).filter(Boolean);
  const out=[];
  segs.forEach(function(seg){
    if(/^[a-z0-9]+$/.test(seg)){ out.push(seg); return; }
    let s=seg; STOP.forEach(function(w){ s=s.split(w).join(''); });
    s=s.trim(); if(!s) return;
    const grams=new Set();
    if(s.length===1) grams.add(s);
    for(let i=0;i+2<=s.length;i++) grams.add(s.slice(i,i+2));
    if(s.length>=3) for(let i=0;i+3<=s.length;i++) grams.add(s.slice(i,i+3));
    if(s.length>=4) for(let i=0;i+4<=s.length;i++) grams.add(s.slice(i,i+4));
    grams.forEach(function(g){ out.push(g); });
  });
  return out.filter(function(w){ return w.length>=2 && !GEN.has(w); });
}
function aiRetrieve(q,k){
  k=k||16; const kws=aiKeywords(q); const ql=normSpace((q||'').toLowerCase());
  const bidQ=kws.some(function(kw){ return /招标|招投标|投标|中标|评标|标段/.test(kw); }); /* 仅当问题涉及招标时，才对招标类定义性法规加权 */
  return searchData.map(function(e){
    const title=normSpace((e.law_title||'').toLowerCase());
    const tn=e.law_title||'';
    const hay=normSpace((e.law_title+' '+e.chapter_title+' '+e.article+' '+e.content).toLowerCase());
    let score=0, matched=0, coreMatched=false;
    const hasFull = ql && hay.includes(ql);
    kws.forEach(function(kw){
      if(!hay.includes(normSpace(kw.toLowerCase()))) return;
      const pureDig=/^\d+$/.test(kw);
      const isCore = kw.length>=3 || (kw.length>=2 && !pureDig);   // 数字碎片段（如 "00""40"）不算核心命中
      if(isCore) coreMatched=true;
      let w=kw.length;
      if(pureDig && kw.length<3) w=0;                               // 纯数字短片段不计分，避免 "00" 误匹配 "2008"
      score+=w; matched++;
    });
    if(kws.some(function(kw){ return title.includes(normSpace(kw.toLowerCase())); })) score+=10;
    if(bidQ){
      if(/招标|招投标/.test(tn)) score+=6;
      if(tn.indexOf('招标投标法')>=0 || tn.indexOf('必须招标')===0) score+=18;
      if(hay.includes('必须招标')) score+=3;
    }
    if(hasFull) score+=8;
    if(!(hasFull || coreMatched)) score=0;                          // 排除不相关（如 "00" 命中 "2008"）
    return {e:e, score:score, matched:matched};
  }).filter(function(x){ return x.score>0; }).sort(function(a,b){ return (b.score-a.score)||(b.matched-a.matched); }).slice(0,k).map(function(x){ return x.e; });
}
function aiContext(top){
  return top.map((e,i)=>'【'+(i+1)+'】《'+e.law_title+'》'+(e.article||'')+(e.chapter_title&&e.chapter_title!=='（未分章）'?'（'+(e.chapter_title)+'）':'')+'：'+e.content).join('\n');
}
function aiSystemPrompt(){
  /* 核心取向：AI 普适性完整回答为主，本地资料仅用于"补强 + 溯源"，绝不因资料缺失而牺牲完整性与逻辑严密性。 */
  return (
'你是一位资深的「工程建设领域合规法律顾问」，服务于建设单位、施工、设计、招投标、监理等实务一线。你的回答会嵌入一个法规知识库产品，关键条文以可点击链接呈现，读者可一键溯源到原文或官方数据库。\n\n'+
'【核心定位：AI 普适性回答为主，本地资料用于增强与溯源】\n'+
'1）完整优先、逻辑严密：先基于你的专业知识，给出一份完整、可直接落地的回答，覆盖「结论 → 规范依据 → 实务要点 → 风险提醒」全链条；不得为了追求"绝对严谨"只给片段、让用户自行拼凑。回答要专业、连贯、成体系。\n'+
'2）本地资料用于"补强与溯源"：下方【本地法规资料】是本知识库摘录的真实条文。请优先引用其中可对应的条文，以「《法规全称》第X条」标注出处，让读者一键溯源；资料未覆盖之处，你可依据公开法律、行政法规、部门规章及专业知识补充，并注明权威出处（同样用「《法规名》第X条」或官方来源），便于核验。\n'+
'3）资料是"加持"而非"围栏"：绝不要因为资料未提及就回避或删减结论；资料与你的专业判断冲突时，以更权威的现行规定为准，并说明。涉及库外条文，提示读者到「国家法律法规数据库（flk.npc.gov.cn）」核对原文即可，不必夹注"未核验"之类免责标签——是否有效由用户自行对照官方原文判断。\n'+
'4）结构清晰（结论先行 + 分点论证）：先用一两句话给出明确结论（肯定 / 否定 / 附条件）；再按「依据」逐条列出支撑条文，每条独立成项，说明规范要义及其对当前问题的适用；以「实务提示」补充操作层面的注意事项与常见风险。\n'+
'5）语言准确、专业、克制，使用法言法语；不写空话套话，不复述用户问题。\n'+
'6）排版规范：使用 Markdown 的标题（## / ###）、加粗（**）、有序 / 无序列表使层次清晰；关键术语加粗；不得出现裸「*」等排版残留符号。\n'+
'7）目标：让非法律专业的工程管理人员也能在 30 秒内抓住要点，并凭借内联链接溯源到条文原文。'
  );
}
function aiRenderRetrieve(top){
  const groups={}; top.forEach(e=>{ (groups[e.law_title]=groups[e.law_title]||[]).push(e); });
  let html='<div class="ai-ret"><div class="ar-h">🔍 检索到 '+top.length+' 条相关条文，来自 '+Object.keys(groups).length+' 部法规</div>';
  Object.keys(groups).forEach(g=>{
    html+='<div class="ai-grp"><div class="gt" onclick="openLawCite(\''+g.replace(/'/g,"\\'")+'\',\'\')" title="点击查看全文">'+esc(g)+' <span class="gt-n">'+groups[g].length+'条</span></div>';
    groups[g].forEach(e=>{
      html+='<div class="gi"><b>'+esc(e.article||'')+'</b> <span class="gi-ch">（'+(e.chapter_title||'未分章')+'）</span>'+esc(e.content.slice(0,160))+(e.content.length>160?'…':'')+'</div>';
    });
    html+='</div>';
  });
  html+='<div class="ai-note" style="margin-top:14px">以上为检索到的真实条文要点。切换到「API 问答 / 本地模型」可生成自然语言解答并自动标注援引。</div></div>';
  return html;
}
function aiSourcesHtml(top){
  const groups={}; top.forEach(e=>{ (groups[e.law_title]=groups[e.law_title]||[]).push(e); });
  let h='<details class="ai-src"><summary>📚 本次回答依据的 '+top.length+' 条真实条文（来自 '+Object.keys(groups).length+' 部法规，点击展开）</summary>';
  Object.keys(groups).forEach(g=>{
    h+='<div class="ai-grp"><div class="gt" onclick="openLawCite(\''+g.replace(/'/g,"\\'")+'\',\'\')" style="cursor:pointer">'+esc(g)+'</div>';
    groups[g].forEach(e=>{ h+='<div class="gi"><b>'+esc(e.article||'')+'</b>：'+esc(e.content.slice(0,160))+'…</div>'; });
    h+='</div>';
  });
  h+='</details>'; return h;
}
/* 中文数字 → 阿拉伯数字（用于条号比对） */
function cn2num(s){
  s=(s||'').trim();
  if(/^\d+$/.test(s)) return parseInt(s,10);
  const d={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  let total=0, section=0, number=0;
  for(const ch of s){
    if(d[ch]!==undefined) number=d[ch];
    else if(ch==='十'){ total+=(section+number||1)*10; section=0; number=0; }
    else if(ch==='百'){ total+=(section+number||1)*100; section=0; number=0; }
    else if(ch==='千'){ total+=(section+number||1)*1000; section=0; number=0; }
  }
  total+=section+number;
  return total;
}
/* 在本地法规库核实一条援引：库内命中返回 entry，否则返回 out */
function verifyCitation(title, numCn){
  const num=cn2num(numCn);
  if(!num) return {status:'out'};
  const tl=title.replace(/\s/g,'');
  for(const e of searchData){
    const et=e.law_title.replace(/\s/g,'');
    if(et!==tl && !et.includes(tl) && !tl.includes(et)) continue;
    const an=cn2num((e.article||'').replace(/[^一二三四五六七八九十百零两0-9]/g,''));
    if(an===num) return {status:'in', entry:e};
  }
  return {status:'out'};
}
/* 解析回答中的所有《法规名》第X条，逐条核验，生成「📌 法规援引核验」面板 */
/* 聚合「参考来源」条（紧凑可点击 chips，内联于答案卡，替代割裂的核验面板）。
   返回内容不含外层 .ai-refs 容器，由调用方套 <div class="ai-refs" id="aiRefs"></div>。 */
function buildRefStrip(raw, top){
  const re=/《([^》]{1,40})》(?:第([一二三四五六七八九十百零两0-9]+)条)?/g;
  const seen={}; const chips=[]; let m;
  function add(title, numCn){
    const key=title+'#'+numCn; if(seen[key]) return; seen[key]=1;
    if(!numCn){   // 裸《法规名》（未带条号）：能解析入库则打开原文，否则跳官方库
      const real=resolveLawTitle(title);
      if(LAW_BY_TITLE[real]){
        chips.push('<button class="ref-chip in" onclick="openLawCite(\''+real.replace(/'/g,"\\'")+'\',\'\')"><span class="rc-ic">✓</span>《'+esc(real)+'》</button>');
      } else {
        const url='https://flk.npc.gov.cn/search.html?keyword='+encodeURIComponent(title);
        chips.push('<a class="ref-chip out" href="'+url+'" target="_blank" rel="noopener"><span class="rc-ic">↗</span>《'+esc(title)+'》<span class="rc-tag">库外</span></a>');
      }
      return;
    }
    const v=verifyCitation(title, numCn);
    if(v.status==='in'){
      const e=v.entry;
      chips.push('<button class="ref-chip in" onclick="openLawCite(\''+e.law_title.replace(/'/g,"\\'")+'\',\''+numCn+'\')"><span class="rc-ic">✓</span>《'+esc(e.law_title)+'》第'+numCn+'条</button>');
    } else {
      const url='https://flk.npc.gov.cn/search.html?keyword='+encodeURIComponent(title);
      chips.push('<a class="ref-chip out" href="'+url+'" target="_blank" rel="noopener"><span class="rc-ic">↗</span>《'+esc(title)+'》第'+numCn+'条<span class="rc-tag">库外</span></a>');
    }
  }
  if(raw){ while((m=re.exec(raw||''))){ add(m[1], m[2]||''); } }
  /* 若回答未显式标注援引，但本地检索有依据，则以检索到的法规作为来源 chips */
  if(!chips.length && top && top.length){
    const groups={}; top.forEach(e=>{ (groups[e.law_title]=groups[e.law_title]||[]).push(e); });
    Object.keys(groups).forEach(g=>{ chips.push('<button class="ref-chip in" onclick="openLawCite(\''+g.replace(/'/g,"\\'")+'\',\'\')"><span class="rc-ic">✓</span>《'+esc(g)+'》· '+groups[g].length+'条</button>'); });
  }
  if(!chips.length) return '';
  const inv=chips.filter(c=>c.indexOf('ref-chip in')>=0).length;
  return '<div class="ar-h">📚 参考来源 <span class="ar-sub">（'+chips.length+' 项，点击可溯源至原文）</span></div>'+
    '<div class="ar-chips">'+chips.join('')+'</div>'+
    '<div class="ar-foot">'+(inv===chips.length
      ? '✅ 以上引用均已在本库核实，可点击跳转原文。'
      : 'ℹ️ 含库外引用，已附国家法律法规数据库官网链接，请以官方原文为准。')+'</div>';
}
/* 行内 Markdown（输入已转义过）：加粗 / 斜体 / 行内代码 / 链接；并清除残留的孤立 * 符号 */
function inlineMd(s){
  // 先抽离行内代码，避免其中的 * _ 被误当作强调处理
  const codes=[];
  s = s.replace(/`([^`]+)`/g, function(_,c){ codes.push(c); return '\u0000'+(codes.length-1)+'\u0000'; });
  s = s.replace(/!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 强调：先处理 ***粗斜体***，再 **加粗**，再 *斜体* / _斜体_（成对即转换，兼容中文语境）
  s = s.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
  // 清除残留的孤立 *（法律/工程问答中 * 不作为正文内容，均为 Markdown 排版残留）
  s = s.replace(/\*/g, '');
  // 还原行内代码
  s = s.replace(/\u0000(\d+)\u0000/g, function(_,i){ return '<code>'+codes[+i]+'</code>'; });
  return s;
}
/* 把 AI 回答渲染为美观的 Markdown（加粗/标题/列表/引用/分段），并把《法规名》第X条 变成可点击跳转 */
function renderAnswer(t){
  const lines = (esc(t||'')).split(/\r?\n/);
  let html='', listType=null, listBuf=[];
  state.aiHeadings=[]; let hn=0;   // 重置答案目录（供右侧「回答大纲」使用）
  function flushList(){ if(!listType) return; html+='<'+listType+'>'+listBuf.join('')+'</'+listType+'>'; listType=null; listBuf=[]; }
  let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^```/.test(line.trim())){ flushList(); const code=[]; i++; while(i<lines.length && !/^```/.test(lines[i].trim())){ code.push(lines[i]); i++; } i++; html+='<pre class="ai-code"><code>'+code.join('\n')+'</code></pre>'; continue; }
    const hm=line.match(/^(#{1,6})\s+(.*)$/);
    if(hm){ flushList(); const lv=hm[1].length; const hid='aih-'+(hn++); const txt=inlineMd(hm[2]); state.aiHeadings.push({id:hid,text:txt,level:lv}); html+='<h'+lv+' class="ai-h" id="'+hid+'">'+txt+'</h'+lv+'>'; i++; continue; }
    if(/^&gt;\s?/.test(line)){ flushList(); const q=[]; while(i<lines.length && /^&gt;\s?/.test(lines[i])){ q.push(lines[i].replace(/^&gt;\s?/,'')); i++; } html+='<blockquote class="ai-quote">'+inlineMd(q.join('<br>'))+'</blockquote>'; continue; }
    const um=line.match(/^\s*[-*]\s+(.*)$/);
    if(um){ if(listType!=='ul'){ flushList(); listType='ul'; } listBuf.push('<li>'+inlineMd(um[1])+'</li>'); i++; continue; }
    const om=line.match(/^\s*\d+[.、]\s+(.*)$/);
    if(om){ if(listType!=='ol'){ flushList(); listType='ol'; } listBuf.push('<li>'+inlineMd(om[1])+'</li>'); i++; continue; }
    if(!line.trim()){ flushList(); i++; continue; }
    const para=[];
    while(i<lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i].trim()) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.、]\s+/.test(lines[i]) && !/^```/.test(lines[i].trim()) && !/^&gt;\s?/.test(lines[i])){ para.push(lines[i]); i++; }
    flushList();
    html+='<p>'+inlineMd(para.join('<br>'))+'</p>';
  }
  flushList();
  // 把《法规名》（含可选「第X条」）全部转为可点击：库内命中则打开原文，库外则跳官方数据库
  html = html.replace(/《([^》]{1,40})》(?:第([一二三四五六七八九十百零两0-9]+)条)?/g, function(_, title, num){
    const t=title;
    return '<a class="cite" onclick="openLawCite(\''+t.replace(/'/g,"\\'")+'\',\''+(num||'')+'\')">《'+esc(t)+'》'+(num?('第'+num+'条'):'')+'</a>';
  });
  return html;
}
function renderCitations(t){ return renderAnswer(t); }
/* 把 AI 写出的法规名解析为库内真实标题（兼容省略「（2017修正）」等版本注记的情况） */
function resolveLawTitle(t){
  if(!t) return t;
  if(LAW_BY_TITLE[t]) return t;
  const tl=normSpace(t);
  // 1）库内标题去掉末尾「（…修正/制定）」版本注记后与 t 一致
  for(const k in LAW_BY_TITLE){
    const kk=normSpace(k);
    const base=kk.replace(/（[^）]*[修正制定]?）$/,'');
    if(base===tl) return k;
  }
  // 2）t 是库内标题去掉注记后的前缀（如 AI 只写了基础名）
  for(const k in LAW_BY_TITLE){
    const kk=normSpace(k);
    const after=kk.slice(tl.length);
    if(kk.indexOf(tl)===0 && after && after[0]==='（') return k;
  }
  // 3）宽松包含兜底（取最短匹配，降低误匹配）
  let best=null;
  for(const k in LAW_BY_TITLE){ const kk=normSpace(k); if(kk.indexOf(tl)>=0||tl.indexOf(kk)>=0){ if(!best||kk.length<best.length) best=k; } }
  return best||t;
}
/* 点击回答中的《法规名》第X条：定位到具体条文，并暂存当前视图以便「返回」 */
async function openLawCite(title, num){
  const view=document.getElementById('view');
  if(view) state.aiViewHtml = view.innerHTML;     // 暂存整块视图（本函数仅由答案援引调用），供「返回」完整还原
  state.lawReturn={type:'ai', scrollY:window.pageYOffset, open:!!state.aiOutlineOpen};   // 记录点击处滚动位置；open=返回时是否自动恢复大纲（取决于本次会话是否手动打开过）
  const real=resolveLawTitle(title);
  if(LAW_BY_TITLE[real]){
    await openLaw(real, true);                    // 等待正文加载渲染完成（标记为来自 AI 回答，右上角箭头即返回入口）
    const v=document.getElementById('view'); if(!v) return;
    if(num){
      const heads=v.querySelectorAll('.an');       // .an 即「第X条」小节标题
      let target=null;
      heads.forEach(hh=>{ if(hh.textContent.indexOf('第'+num+'条')>=0) target=hh; });
      if(target){ scrollToEl(target, 8); }
    }
    return;
  }
  // 库外条文：跳转到国家法律法规数据库核对原文，不切换当前视图
  const url='https://flk.npc.gov.cn/search.html?keyword='+encodeURIComponent(title+(num?(' 第'+num+'条'):''));
  try{ window.open(url,'_blank','noopener'); }catch(e){ location.href=url; }
}
/* 阅读法条后统一「返回」：依据 lawReturn 回到 AI 回答或原文检索结果，并还原原滚动位置 */
function returnFromLaw(){
  const view=document.getElementById('view');
  const lr=state.lawReturn;
  if(lr && lr.type==='search'){
    const sy=lr.scrollY||0;
    state.view='search';
    hideRightPanel();   // 返回检索：收起阅读视图遗留的法规目录面板
    renderSearch();
    window.scrollTo(0, sy);                 // 回到原检索列表的滚动位置
  } else if(lr && lr.type==='ai'){
    const sy=lr.scrollY||0;
    if(view && state.aiViewHtml){ view.innerHTML=state.aiViewHtml; }   // 完整还原 AI 答案视图
    state.view='ai';
    showAiAnswerToc(!!(lr&&lr.open));   // 返回 AI 界面：若本次会话手动打开过大纲则自动停靠显示，否则保持默认隐藏+右缘感应
    window.scrollTo(0, sy);                 // 回到点击援引条文时的原阅读位置（而非页尾）
  }
  state.lawReturn=null; state.aiFromLaw=false; state.aiViewHtml=null;
  if(isMobile()) closeLeftDrawer();
}
/* 兼容旧调用（悬浮返回按钮等） */
function backToAi(){ returnFromLaw(); }

function askAI(){
  state.aiViewHtml=null; state.aiFromLaw=false; state.lawReturn=null;   // 新提问：清除上一次答案暂存
  state.aiAnsHtml=null; state.aiAnswered=false;
  const q=(document.getElementById('topq')?document.getElementById('topq').value.trim():'');
  if(!q){   // 无问题：直接渲染空状态（不递归，避免死循环）
    const v=document.getElementById('view');
    if(v) v.innerHTML='<div class="ai-wrap"><div class="ai-head"><div class="ai-title">AI问答<span class="ai-sep">／</span><span class="ai-sub2">普适回答 · 本库溯源</span></div></div>'+
      '<div class="ai-empty">在上方搜索框输入你的问题，点击「AI问答」即可获得完整回答，关键条文可一键溯源到原文。</div></div>';
    return;
  }
  state.q=q;
  const box=document.getElementById('aians');
  if(!box){ renderAI(); return askAI(); }   // 答案区尚未渲染（初次进入 AI 面板），渲染出 #aians 容器后再问
  const mode=state.aiMode||'api';
  box.innerHTML='<div class="ai-conv"><div class="ai-a"><div class="ai-note">⏳ 正在本地检索相关法规条文…</div></div></div>';
  ensureSearch().then(function(){
    const top=aiRetrieve(q, 18);
    const a=box.querySelector('.ai-a');
    if(mode==='api'){ askAIKey(q, top, box); return; }
    if(mode==='local'){ askAILocal(q, top, box); return; }
  }).catch(function(e){ const a=box.querySelector('.ai-a'); if(a) a.innerHTML='<div class="empty">检索索引加载失败：'+esc(e.message)+'。请刷新页面后重试。</div>'; });
}

/* 模式③：自带 API Key（浏览器直连厂商，流式） */
function askAIKey(q, top, box){
  const p=state.aiProv||'deepseek'; const cfg=AI_PROVIDERS[p]; const key=aiKeyGet(p);
  const model=(state.aiModel&&state.aiModel.trim())||cfg.model; let raw='';
  const a=box.querySelector('.ai-a'); if(!a) return;
  if(!key){ a.innerHTML='<div class="empty">尚未配置 '+cfg.name+' 的 API Key。<button class="linkbtn" onclick="openKeyModal()">去设置</button></div>'; return; }
  const noLocal=!top.length;
  const cacheKey=q+'|'+p+'|'+model+'|'+(noLocal?'':top.map(function(e){return e.law_title+'#'+e.article;}).join('|'));
  // 同一问题（含相同检索依据）直接复用上次答案，避免重复生成导致措辞/结论不一致
  if(Object.prototype.hasOwnProperty.call(state.answerCache, cacheKey)){
    raw=state.answerCache[cacheKey];
    a.innerHTML='<div class="ai-ans" id="aiAns">'+renderCitations(raw)+'</div>'+
      '<div class="ai-note">✅ 已复用上一次相同提问的答案（内容完全一致）。'+(noLocal?'':('已结合本库 '+top.length+' 条真实条文标注依据。'))+'</div>'+
      '<div class="ai-refs" id="aiRefs">'+buildRefStrip(raw, top)+'</div>';
    const ab=document.getElementById('aians'); if(ab){ state.aiAnsHtml=ab.innerHTML; state.aiAnswered=true; }
    return;
  }
  a.innerHTML='<div class="ai-ans" id="aiAns"></div><div class="ai-note" id="aiNote">⏳ 正在向 '+cfg.name+'（'+esc(model)+'）请求…</div><div class="ai-refs" id="aiRefs"></div>';
  const ctx=aiContext(top);
  const user='【问题】'+q+'\n\n'+
    '【作答要求】请先基于你的专业知识，给出一份完整、严谨、可直接落地的回答（覆盖结论、规范依据、实务要点、风险提醒），确保逻辑严密、不缺环节；随后结合下方【本地法规资料】为关键结论补充权威依据——凡可对应到资料的条文，以「《法规全称》第X条」标注出处，资料未覆盖之处可依据公开法规与专业知识补充并注明来源。\n\n'+
    '【本地法规资料】（仅供引用溯源，不限制你的回答范围；若无相关内容可忽略）\n'+(ctx||'（无）')+'\n\n'+
    '注意：关键条文严格以「《法规全称》第X条」格式标注，便于系统生成可点击溯源链接。';
  fetch(cfg.url,{
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({model:model, messages:[{role:'system',content:aiSystemPrompt()},{role:'user',content:user}], stream:true, temperature:0, top_p:1})
  }).then(function(r){
    if(!r.ok){ return r.text().then(function(t){ throw new Error('HTTP '+r.status+' '+t.slice(0,200)); }); }
    const reader=r.body.getReader(); const dec=new TextDecoder(); let buf=''; const ans=document.getElementById('aiAns');
    function pump(){
      return reader.read().then(function(res){
        if(res.done){ return; }
        buf+=dec.decode(res.value,{stream:true});
        const lines=buf.split('\n'); buf=lines.pop();
        for(const ln of lines){ const s=ln.trim(); if(!s||!s.startsWith('data:')) continue; const d=s.slice(5).trim(); if(d==='[DONE]') continue;
          try{ const j=JSON.parse(d); const tk=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content; if(tk){ raw+=tk; ans.innerHTML=renderCitations(raw); } }catch(e){} }
        return pump();
      });
    }
    return pump();
  }).then(function(){
    if(!raw || !raw.trim()){
      const note=document.getElementById('aiNote'); if(note) note.innerHTML='<span style="color:#cf1322">⚠️ '+cfg.name+' 返回了空内容，可能 Key 权限不足或模型异常。请检查 Key，或切到「本地模型」。</span>';
      return;
    }
    state.answerCache[cacheKey]=raw;   // 缓存，保证同问题答案一致
    const note=document.getElementById('aiNote');
    if(note) note.innerHTML = noLocal
      ? ('ℹ️ 本库暂未检索到直接匹配条文，以下由 '+cfg.name+' 基于专业知识生成，关键结论已标注权威出处，请到官方原文核验。')
      : ('✅ 回答由 '+cfg.name+' 生成，已结合本库 '+top.length+' 条真实条文标注依据，关键条文可点击溯源。');
    const refs=document.getElementById('aiRefs'); if(refs) refs.innerHTML=buildRefStrip(raw, top);
    const ab=document.getElementById('aians'); if(ab){ state.aiAnsHtml=ab.innerHTML; state.aiAnswered=true; }
  }).catch(function(e){
    const msg=(e&&e.message)||'未知错误';
    let tip='';
    if(/401|403/.test(msg)) tip='Key 无效、已失效或无该模型权限。请点上方「已连接」或「设置 ⚙」→「更换 / 查看 Key」→「测试连接」确认，再重新保存有效的 '+cfg.name+' Key。';
    else if(/Failed to fetch|CORS|NetworkError|network/i.test(msg)) tip='网络/跨域被拦截。请确认浏览器能访问外网；公司网络或插件可能拦截了对 '+cfg.name+' 的请求。';
    else tip='（检查 Key / 模型是否正确；或改用「本地模型」）。';
    const note=document.getElementById('aiNote'); if(note) note.innerHTML='<span style="color:#cf1322">请求失败：'+esc(msg)+'</span><br>'+tip+' <button class="linkbtn" onclick="openKeyModal()">重新配置 Key</button>';
  });
}

/* 模式②：本地浏览器模型（WebGPU，离线） */
async function loadLocalModel(){
  if(localModel||localModelLoading) return;
  if(!(navigator.gpu)){ alert('当前浏览器不支持 WebGPU，无法运行本地模型。请改用「自带 API Key」或「本地检索」。\n（推荐用 Chrome / Edge 最新版）'); return; }
  localModelLoading=true; const st=document.getElementById('lmStatus'); const prog=document.getElementById('lmProg'); const bar=document.getElementById('lmBar');
  if(st) st.textContent='加载中…'; if(prog) prog.style.display='block'; if(bar) bar.style.width='0%';
  try{
    const T=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2');
    T.env.allowLocalModels=false;
    const mdl=document.getElementById('aiLocalModel').value;
    localModel=await T.pipeline('text-generation', mdl, {dtype:'q4', device:'webgpu', progress_callback:function(pg){
      if(pg&&pg.status==='progress'&&bar&&pg.total){ bar.style.width=Math.round(pg.loaded/pg.total*100)+'%'; }
      else if(pg&&pg.status==='ready'&&bar){ bar.style.width='100%'; }
    }});
    localModelLoading=false; if(st) st.textContent='● 已加载'; if(prog) setTimeout(function(){ if(prog) prog.style.display='none'; },600);
  }catch(e){ localModelLoading=false; if(st) st.textContent='○ 加载失败'; if(prog) prog.style.display='none'; alert('本地模型加载失败：'+e.message); }
}
async function askAILocal(q, top, box){
  const a=box.querySelector('.ai-a'); if(!a) return;
  if(!localModel){ a.innerHTML='<div class="empty">请先点击「设置 ⚙」→「加载本地模型」（首次需下载，约 0.4–1.1GB）。</div>'; return; }
  const noLocal=!top.length;
  const mdl=document.getElementById('aiLocalModel')?document.getElementById('aiLocalModel').value:'Qwen/Qwen2.5-1.5B-Instruct';
  const cacheKey='local|'+mdl+'|'+q+'|'+(noLocal?'':top.map(function(e){return e.law_title+'#'+e.article;}).join('|'));
  if(Object.prototype.hasOwnProperty.call(state.answerCache, cacheKey)){
    const cached=state.answerCache[cacheKey];
    a.innerHTML='<div class="ai-ans" id="aiAns">'+renderCitations(cached)+'</div>'+
      '<div class="ai-note">✅ 已复用上一次相同提问的答案（内容完全一致）。'+(noLocal?'':('已结合本库 '+top.length+' 条真实条文标注依据。'))+'</div>'+
      '<div class="ai-refs" id="aiRefs">'+buildRefStrip(cached, top)+'</div>';
    const ab=document.getElementById('aians'); if(ab){ state.aiAnsHtml=ab.innerHTML; state.aiAnswered=true; }
    return;
  }
  a.innerHTML='<div class="ai-ans" id="aiAns"></div><div class="ai-note" id="aiNote">⏳ 本地模型生成中（首次较慢）…</div><div class="ai-refs" id="aiRefs"></div>';
  const ctx=aiContext(top);
  const user='【问题】'+q+'\n\n'+
    '【作答要求】请先基于你的专业知识，给出一份完整、严谨、可直接落地的回答（覆盖结论、规范依据、实务要点、风险提醒），确保逻辑严密、不缺环节；随后结合下方【本地法规资料】为关键结论补充权威依据——凡可对应到资料的条文，以「《法规全称》第X条」标注出处，资料未覆盖之处可依据公开法规与专业知识补充并注明来源。\n\n'+
    '【本地法规资料】（仅供引用溯源，不限制你的回答范围；若无相关内容可忽略）\n'+(ctx||'（无）')+'\n\n'+
    '注意：关键条文严格以「《法规全称》第X条」格式标注，便于系统生成可点击溯源链接。';
  try{
    const out=await localModel([{role:'system',content:aiSystemPrompt()},{role:'user',content:user}], {max_new_tokens:600, temperature:0, do_sample:false});
    let raw='';
    try{ raw=out[0].generated_text.at(-1).content; }catch(e){ raw=String(out); }
    const ans=document.getElementById('aiAns'); if(ans) ans.innerHTML=renderCitations(raw||'（模型未返回内容）');
    const note=document.getElementById('aiNote');
    if(note) note.innerHTML = noLocal
      ? ('ℹ️ 本库暂未检索到直接匹配条文，以下由本地模型基于专业知识生成，关键结论已标注权威出处，请到官方原文核验。')
      : ('✅ 本机离线生成，已结合本库 '+top.length+' 条真实条文标注依据，关键条文可点击溯源。');
    state.answerCache[cacheKey]=raw;
    const refs=document.getElementById('aiRefs'); if(refs) refs.innerHTML=buildRefStrip(raw||'', top);
    const ab=document.getElementById('aians'); if(ab){ state.aiAnsHtml=ab.innerHTML; state.aiAnswered=true; }
  }catch(e){
    const note=document.getElementById('aiNote'); if(note) note.innerHTML='<span style="color:#cf1322">生成失败：'+esc(e.message)+'</span>';
  }
}

/* Key 弹窗（复用 #customModal） */
function openKeyModal(){
  const p=state.aiProv||'deepseek'; const cfg=AI_PROVIDERS[p]; const cur=aiKeyGet(p)||'';
  const m=document.getElementById('customModal'); if(!m) return;
  m.innerHTML='<div class="cm-overlay" onclick="closeKeyModal()"></div><div class="cm-box">'+
    '<div class="cm-title">配置 '+cfg.name+' API Key</div>'+
    '<div class="cm-h">Key 仅保存在本机浏览器(localStorage)，不会上传到任何服务器；由你的浏览器直连 '+cfg.name+' 官方接口。请妥善保管、勿在公共电脑保存。</div>'+
    '<input id="kmKey" class="cm-kw" placeholder="粘贴 API Key（如 sk-...）" value="'+esc(cur)+'">'+
    '<div id="kmTest" class="cm-test"></div>'+
    '<div class="cm-actions"><button onclick="testKey()">🔌 测试连接</button><button onclick="closeKeyModal()">取消</button><button class="primary" onclick="saveKey()">保存</button></div></div>';
  m.style.display='flex';
}
function saveKey(){ const p=state.aiProv||'deepseek'; let k=document.getElementById('kmKey').value.trim(); if(!k){ alert('请输入 Key'); return; } k=k.replace(/^Bearer\s+/i,''); if(k.indexOf(' ')>0||k.indexOf('\n')>0){ alert('Key 中含有空格或换行，请检查是否多粘贴了字符（正确格式如 sk-…）。'); return; } aiKeySet(p,k); aiTestSet(p,true); closeKeyModal(); renderAI(); }
function testKey(){
  const p=state.aiProv||'deepseek'; const cfg=AI_PROVIDERS[p]; let k=document.getElementById('kmKey').value.trim().replace(/^Bearer\s+/i,'');
  const el=document.getElementById('kmTest'); if(!el) return;
  if(!k){ el.className='cm-test bad'; el.textContent='请先粘贴 Key 再点测试'; return; }
  el.className='cm-test'; el.textContent='⏳ 正在测试连接 '+cfg.name+' …';
  const model=(state.aiModel&&state.aiModel.trim())||cfg.model;
  fetch(cfg.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+k},body:JSON.stringify({model:model,messages:[{role:'user',content:'ping'}],stream:false,max_tokens:2})})
    .then(function(r){ return r.json().catch(function(){ return {_text:true,status:r.status}; }).then(function(j){ return {r:r,j:j}; }); })
    .then(function(o){ const r=o.r, j=o.j;
      if(r.ok){ el.className='cm-test ok'; el.textContent='✅ 连接成功（'+cfg.name+' 可用）。点「保存」回到提问框即可使用。'; aiTestSet(p,'ok'); }
      else { const t=(j&&j.error&&j.error.message)||(j&&j._text?'HTTP '+r.status:'')||''; el.className='cm-test bad'; el.textContent='❌ 失败 HTTP '+r.status+'：'+(String(t).slice(0,160)||'无详情')+'（多为 Key 无效/失效）'; aiTestSet(p,'fail'); }
    })
    .catch(function(e){ el.className='cm-test bad'; el.textContent='❌ 网络/跨域错误：'+esc(e.message)+'（浏览器可能被防火墙/插件拦截，或该厂商不支持跨域）'; aiTestSet(p,'fail'); });
}
function closeKeyModal(){ const m=document.getElementById('customModal'); if(m) m.style.display='none'; }

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

/* 移动端↔桌面切换时清理抽屉状态，避免残留悬浮层 */
window.addEventListener('resize', function(){
  if(!isMobile()){
    document.body.classList.remove('left-open','right-open');
    const lp=document.getElementById('leftPanel'); if(lp) lp.classList.remove('drawer-open');
    const rp=document.getElementById('rightPanel'); if(rp) rp.classList.remove('drawer-open');
    const s=document.getElementById('scrim'); if(s) s.classList.remove('show');
  }
});

boot();
