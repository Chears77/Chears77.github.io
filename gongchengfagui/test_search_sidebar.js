// 集成测试：模拟 原文检索"工程"，检查检索态左侧树渲染为干净树（无蓝底/复选框）
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const searchData = JSON.parse(fs.readFileSync('data/search.json', 'utf8'));

const js = fs.readFileSync('assets/app.js', 'utf8') +
  '\nglobal.__d=doSearch; global.__state=state; global.__tc=treeCollapsed; global.__rm=recomputeMatches;';

// 通用 DOM stub
function mkEl() {
  return {
    _html: '', _text: '', value: '', className: '', style: {},
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text = v; }, get textContent(){ return this._text; },
    appendChild(){}, onclick: null, focus(){}, addEventListener(){}, querySelector(){ return mkEl(); }
  };
}
const store = {};
global.document = {
  getElementById(id){ if(!store[id]) store[id] = mkEl(); return store[id]; },
  createElement(){ return mkEl(); },
  querySelector(){ return mkEl(); },
  addEventListener(){}
};
global.window = { addEventListener(){}, scrollTo(){}, open(){}, scrollY: 0 };
global.location = { search: '', hash: '' };
global.fetch = (u) => {
  const url = String(u);
  if (url.includes('manifest')) return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
  if (url.includes('search')) return Promise.resolve({ ok: true, json: () => Promise.resolve(searchData) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
};

eval(js);

setTimeout(async () => {
  try {
    // 触发检索
    global.document.getElementById('topq').value = '工程';
    await global.__d();           // doSearch
    await new Promise(r => setTimeout(r, 50));

    const sb = store['sidebar']._html;
    const hasHit = /tnode lv hit/.test(sb);
    const hasDim = /tnode lv dim/.test(sb);
    const hasCb  = /class="lvcb"/.test(sb);
    const lawNodes = (sb.match(/class="tnode law"/g) || []).length;
    const lvNodes  = (sb.match(/class="tnode lv/g) || []).length;
    const matchedTotal = manifest.filter(l => (global.__state.matchedLaws[l.level] || new Set()).has(l.title)).length;

    console.log('检索态左侧树检查（关键词"工程"）：');
    console.log('  含蓝底 hit 类? ', hasHit ? 'YES ❌' : 'NO ✅');
    console.log('  含灰字 dim 类? ', hasDim ? 'YES ❌' : 'NO ✅');
    console.log('  含复选框 lvcb?  ', hasCb  ? 'YES ❌' : 'NO ✅');
    console.log('  层级节点数: ', lvNodes);
    console.log('  法规节点数: ', lawNodes);
    console.log('  命中法规总数(来自 state): ', matchedTotal);
    console.log('  层级名带 onclick=toggleLevelFilter? ', /lv-label" onclick="toggleLevelFilter/.test(sb) ? 'YES ✅' : 'NO ❌');
    console.log('  箭头带 onclick=toggleSearchLevel? ', /tw" onclick="toggleSearchLevel/.test(sb) ? 'YES ✅' : 'NO ❌');

    const ok = !hasHit && !hasDim && !hasCb && lawNodes > 0 && lvNodes > 0;
    console.log(ok ? '\n✅ 检索态左侧树已统一为干净树（与浏览/筛选态一致）' : '\n❌ 仍有问题');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('TEST ERROR:', e);
    process.exit(2);
  }
}, 300);
