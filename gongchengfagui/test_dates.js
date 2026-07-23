// 集成测试：日期列(修订>施行>发布)、面包屑 undefined 修复、初稿待校核 去除
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const appjs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
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
    querySelector: () => ({ innerHTML:'', classList:{ add(){}, remove(){} } }),
    style:{}
  };
  return store[id];
}
global.document = {
  getElementById: el,
  querySelector: () => ({ classList:{ add(){}, remove(){} }, innerHTML:'', scrollIntoView(){} }),
  querySelectorAll: () => [],
  createElement: () => ({ className:'', set innerHTML(v){this._html=v;}, get innerHTML(){return this._html;}, set onclick(f){}, appendChild(){}, style:{} }),
  addEventListener(){},
};
global.window = { addEventListener(){}, scrollTo(){}, open(){}, scrollY:0 };
global.location = { href:'', search:'', hash:'' };
global.fetch = (url) => {
  const u = String(url);
  if(u.includes('manifest.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(manifest) });
  if(u.includes('search.json')) return Promise.resolve({ ok:true, json:()=>Promise.resolve(search) });
  if(u.includes('.md')){
    let p = decodeURIComponent(u.replace(/^\.\//,''));
    try { return Promise.resolve({ ok:true, text:()=>Promise.resolve(fs.readFileSync(path.join(ROOT,p),'utf8')) }); }
    catch(e){ return Promise.resolve({ ok:false, status:404, text:()=>Promise.resolve('') }); }
  }
  return Promise.resolve({ ok:false, status:404, text:()=>Promise.resolve('') });
};
global.XMLHttpRequest = function(){};

const sandbox = {};
eval(appjs + '\n;Object.assign(global.__api={}, {effLabel, lawTag, getLaw, renderHome, renderRead, openLaw, state, boot, ensureSearch});');

let pass = true;
function check(name, cond, extra){ console.log((cond?'PASS ✅':'FAIL ❌')+' '+name+(extra?('  '+extra):'')); if(!cond) pass=false; }

(async () => {
  try { await global.__api.boot(); } catch(e){ console.log('boot error:', e.message); }
  await global.__api.ensureSearch();

  // 1) 仲裁法：应为 施行 日期 2026-03-01（无括号）
  const zc = global.__api.getLaw('中华人民共和国仲裁法');
  check('仲裁法 在 LAWS 中', !!zc);
  if(zc){
    const el2 = global.__api.effLabel(zc);
    check('仲裁法 日期=2026-03-01', el2.date==='2026-03-01', '得到 '+el2.date);
    check('仲裁法 标签=施行(无括号)', el2.tag==='施行', '得到 '+el2.tag);
    check('仲裁法 日期标签带颜色类 dt-shi', el2.cls==='dt-shi', '得到 '+el2.cls);
  }

  // 2) 修订优先：构造带 revise_date 的对象
  const rev = global.__api.effLabel({revise_date:'2020-01-01', effective_date:'2010-05-05', publish_date:'2000-01-01'});
  check('修订优先 标签=修订(无括号)', rev.tag==='修订', '得到 '+rev.tag);
  check('修订 带颜色类 dt-xiu', rev.cls==='dt-xiu', '得到 '+rev.cls);

  // 3) 仅有 publish_date 时标签=发布
  const pub = global.__api.effLabel({publish_date:'1999-08-30'});
  check('仅发布日期 标签=发布(无括号)', pub.tag==='发布', '得到 '+pub.tag+' '+pub.date);
  check('发布 带颜色类 dt-fa', pub.cls==='dt-fa', '得到 '+pub.cls);

  // 4) v1 兼容：eff_date 字段
  const v1 = global.__api.effLabel({eff_date:'2012-12-12'});
  check('v1 eff_date 兼容 标签=施行(无括号)', v1.tag==='施行', '得到 '+v1.tag);

  // 5) lawTag 不含 初稿待校核
  const tag = global.__api.lawTag(zc||{level:'法律',status:'现行',field:''});
  check('lawTag 不含 初稿待校核', !tag.includes('初稿待校核'), tag);

  // 6) 渲染首页，检查表头为 日期、含 仲裁法 日期、不含 施行日期/初稿待校核
  global.__api.renderHome();
  const home = el('view').innerHTML;
  check('列表表头为「日期」', home.includes('>日期<'), '');
  check('列表不含旧「施行日期」表头', !home.includes('施行日期'));
  check('首页渲染含 仲裁法 日期 2026-03-01', home.includes('2026-03-01'));
  check('首页全文不含 初稿待校核', !home.includes('初稿待校核'));
  check('日期标签渲染为颜色化 dtag(无括号)', /<span class="dtag dt-(shi|xiu|fa)">(施行|修订|发布)<\/span>/.test(home), '');
  check('渲染结果不含带括号的日期标签', !home.includes('（施行）') && !home.includes('（修订）') && !home.includes('（发布）'));
  // 抽查一个带 修订 的法规是否显示（修订）
  const revLaws = manifest.filter(l=>l.revise_date);
  if(revLaws.length){
    const r = global.__api.getLaw(revLaws[0].title);
    if(r){ const t = global.__api.effLabel(r); check('带修订日期法规显示 修订(无括号)', t.tag==='修订', revLaws[0].title+' -> '+t.date+t.tag); }
  }

  // 7) 面包屑 undefined 修复：openLaw(仲裁法) 真实加载正文并渲染
  try { await global.__api.openLaw('中华人民共和国仲裁法'); }
  catch(e){ console.log('openLaw error:', e && e.stack ? e.stack : e); }
  const read = el('view').innerHTML;
  console.log('--- read head (300) ---');
  console.log(read.slice(0,300));
  check('面包屑含 法律 层级（非 undefined）', read.includes('>法律</a>') && !read.includes('>undefined</a>'), '');
  check('阅读视图含 仲裁法 标题', read.includes('中华人民共和国仲裁法'));

  // 8) 全部 503 部均有日期可显示
  const noDate = manifest.filter(l=> !(l.revise_date||l.effective_date||l.publish_date));
  check('全部法规均有可显示日期', noDate.length===0, '缺日期: '+noDate.length+' 部');

  console.log('\n' + (pass ? '==> ALL PASS' : '==> FAILED'));
  process.exit(pass?0:1);
})();
