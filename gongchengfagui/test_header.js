// 集成测试：比较浏览态 vs 检索态 左侧头部 lpHead 是否一致
const fs = require('fs');
const h = fs.readFileSync('nav.html', 'utf8'); // 占位，下面读 app.js
const appjs = fs.readFileSync('assets/app.js', 'utf8');

// 真实数据
const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const search = JSON.parse(fs.readFileSync('data/search.json', 'utf8'));

const store = {};
function el(id){
  if(!store[id]) store[id] = {
    _html:'', _text:'',
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
    value:'', focus(){},
    addEventListener(){}, removeEventListener(){}, setAttribute(){},
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style:{},
  };
  return store[id];
}
global.document = {
  getElementById: el,
  querySelector: () => ({ classList:{ add(){}, remove(){} } }),
  createElement: () => ({ style:{}, classList:{add(){}}, appendChild(){}, setAttribute(){} }),
  addEventListener(){}, body:{ appendChild(){} },
};
global.window = { addEventListener(){}, scrollTo(){}, open(){}, scrollY:0 };
global.location = { href:'', search:'', hash:'' };
global.history = { replaceState(){} };
global.sessionStorage = { getItem(){return null;}, setItem(){} };
global.fetch = (u) => {
  const url = String(u);
  if(url.includes('manifest.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(manifest) });
  if(url.includes('search.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(search) });
  // md 文件
  return Promise.resolve({ ok:true, text:()=>Promise.resolve('# 测试\n\n## 第一章\n\n### 第一条\n内容\n') });
};

eval(appjs);

function headerChecks(html, tag){
  const has = {
    '法规总库(libBtn)': html.includes('id="libBtn"') && html.includes('法规总库'),
    '⬇下载按钮': html.includes('下载当前范围'),
    '⊞/⊟折叠按钮': html.includes('id="collapseAllBtn"'),
    '无🔍检索结果标签': !html.includes('🔍 检索结果'),
    '无✕清除按钮': !html.includes('清除检索'),
    '有dlMenu': html.includes('id="dlMenu"'),
  };
  let ok = true;
  for(const k in has){ if(!has[k]) ok=false; console.log((has[k]?'PASS':'FAIL')+' ['+tag+'] '+k); }
  return ok;
}

setTimeout(async () => {
  try{
    // 浏览态头部
    const browseHead = store['lpHead']._html;
    console.log('--- 浏览态 lpHead 长度:', browseHead.length);
    const bOk = headerChecks(browseHead, '浏览');

    // 触发检索 "工程"
    await doSearch('工程');
    await new Promise(r=>setTimeout(r, 200));
    const searchHead = store['lpHead']._html;
    console.log('--- 检索态 lpHead 长度:', searchHead.length);
    const sOk = headerChecks(searchHead, '检索');

    // 一致性：两态头部完全相同
    const identical = (browseHead === searchHead);
    console.log((identical?'PASS':'FAIL')+' [一致性] 浏览态与检索态头部 innerHTML 完全相同');
    console.log((bOk && sOk && identical) ? '\n==> ALL PASS' : '\n==> FAILED');
  }catch(e){ console.log('ERROR', e); }
}, 400);
