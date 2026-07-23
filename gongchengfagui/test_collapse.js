// 集成测试：检索态下「全部折叠/展开」按钮是否真的生效（操作 s: 前缀键）
const fs = require('fs');
const appjs = fs.readFileSync('assets/app.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const search = JSON.parse(fs.readFileSync('data/search.json', 'utf8'));

const store = {};
function el(id){
  if(!store[id]) store[id] = {
    _html:'', _text:'',
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
    value:'', focus(){}, addEventListener(){}, removeEventListener(){}, setAttribute(){}, appendChild(){}, querySelector(){return null;},
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} }, style:{},
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
  return Promise.resolve({ ok:true, text:()=>Promise.resolve('# 测试\n\n## 第一章\n\n### 第一条\n内容\n') });
};

eval(appjs);

function countLawNodes(){ const h=store['sidebar']._html; return (h.match(/class="tnode law"/g)||[]).length; }
function countCollapsedArrows(){ const h=store['sidebar']._html; return (h.match(/▸/g)||[]).length; }
function countExpandedArrows(){ const h=store['sidebar']._html; return (h.match(/▾/g)||[]).length; }

setTimeout(async () => {
  try{
    el('topq').value='工程';          // doSearch 从输入框读取，不接收参数
    await doSearch();
    await new Promise(r=>setTimeout(r,200));
    const beforeLaws = countLawNodes();
    const beforeBtn = store['collapseAllBtn']._text;
    console.log('检索态初始: 法规节点='+beforeLaws+', 按钮图标="'+beforeBtn+'"');

    // 点击「全部折叠」
    toggleCollapseAll();
    await new Promise(r=>setTimeout(r,50));
    const afterCollapseLaws = countLawNodes();
    const afterCollapseArrows = countCollapsedArrows();
    const afterCollapseBtn = store['collapseAllBtn']._text;
    console.log('折叠后: 法规节点='+afterCollapseLaws+', 折叠箭头▸='+afterCollapseArrows+', 按钮图标="'+afterCollapseBtn+'"');

    // 点击「全部展开」
    toggleCollapseAll();
    await new Promise(r=>setTimeout(r,50));
    const afterExpandLaws = countLawNodes();
    const afterExpandBtn = store['collapseAllBtn']._text;
    console.log('展开后: 法规节点='+afterExpandLaws+', 按钮图标="'+afterExpandBtn+'"');

    const pass1 = afterCollapseLaws < beforeLaws;       // 折叠后法规节点减少
    const pass2 = afterCollapseBtn === '⊞';              // 折叠后图标变 ⊞
    const pass3 = afterCollapseArrows > 0;              // 出现折叠箭头 ▸（证明操作了 s: 键）
    const pass4 = afterExpandLaws === beforeLaws;        // 展开后恢复
    const pass5 = afterExpandBtn === '⊟';                // 展开后图标变 ⊟

    [['折叠后法规节点减少',pass1],['折叠后图标=⊞',pass2],['出现折叠箭头▸(s:键生效)',pass3],['展开后恢复法规节点',pass4],['展开后图标=⊟',pass5]]
      .forEach(([n,ok])=>console.log((ok?'PASS':'FAIL')+' '+n));
    console.log((pass1&&pass2&&pass3&&pass4&&pass5)?'\n==> ALL PASS':'\n==> FAILED');
  }catch(e){ console.log('ERROR', e); }
}, 400);
