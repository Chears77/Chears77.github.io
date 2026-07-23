// 集成测试：验证检索空格不敏感（尤其数字+单位）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
// 抽取 app.js 的 <script> 体（app.js 本身就是纯 JS 文件，直接 eval）
const js = appjs;

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const search = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'search.json'), 'utf8'));

// ---- DOM 桩 ----
const store = {};
function el(id){
  if(!store[id]) store[id] = {
    _html:'', _text:'', value:'', _children:[],
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
    focus(){}, addEventListener(){}, removeEventListener(){}, setAttribute(){},
    appendChild(c){ this._children.push(c); },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style:{}
  };
  return store[id];
}
global.document = {
  getElementById: el,
  querySelector: () => ({ classList:{ add(){}, remove(){} } }),
  createElement: () => ({ className:'', set innerHTML(v){this._html=v;}, get innerHTML(){return this._html;}, set onclick(f){}, appendChild(){}, style:{} }),
  addEventListener(){},
};
global.window = { addEventListener(){}, scrollTo(){}, open(){}, scrollY:0 };
global.location = { href:'', search:'', hash:'' };
global.fetch = (url) => {
  const u = String(url);
  if(u.includes('manifest.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(manifest) });
  if(u.includes('search.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(search) });
  return Promise.resolve({ ok:false, status:404, text:()=>Promise.resolve('') });
};
global.XMLHttpRequest = function(){};

// 暴露内部函数：用一个对象接住
const sandbox = {};
eval(js + '\n;Object.assign(global.__api={}, {doSearch, filterEntries, recomputeMatches, state, boot, ensureSearch});');

(async () => {
  try { await global.__api.boot(); } catch(e){ console.log('boot error:', e.message); }
  await global.__api.ensureSearch();

  function runQuery(q){
    el('topq').value = q;
    global.__api.doSearch();
    const list = global.__api.filterEntries();
    const titles = list.map(e=>e.law_title).sort();
    return { count: list.length, titles };
  }

  const a = runQuery('400万');
  const b = runQuery('400 万');
  const c = runQuery('400');

  console.log('检索 "400万"  -> 命中', a.count, '条');
  console.log('检索 "400 万" -> 命中', b.count, '条');
  console.log('检索 "400"    -> 命中', c.count, '条');

  const sameSet = JSON.stringify(a.titles) === JSON.stringify(b.titles);
  console.log('"400万" 与 "400 万" 结果集完全一致?', sameSet ? 'YES ✅' : 'NO ❌');

  // 抽样展示 "400万" 命中的法规（去重标题）
  const uniq = [...new Set(a.titles)];
  console.log('--- "400万" 命中法规（前15部）---');
  uniq.slice(0,15).forEach(t=>console.log('  '+t));

  if(!sameSet){
    const sa=new Set(a.titles), sb=new Set(b.titles);
    const onlyA=[...sa].filter(t=>!sb.has(t));
    const onlyB=[...sb].filter(t=>!sa.has(t));
    console.log('仅 "400万" 命中:', onlyA.slice(0,10));
    console.log('仅 "400 万" 命中:', onlyB.slice(0,10));
  }

  console.log('\n' + (sameSet ? '==> ALL PASS (空格不敏感)' : '==> FAILED'));
})();
