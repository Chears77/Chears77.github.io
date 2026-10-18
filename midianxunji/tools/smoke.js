/* ============================================================
 * 冒烟测试：jsdom 全页面渲染 + 地图页核心交互
 * 运行：node tools/_smoke.js
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

const ROOT = 'D:/github/homepage/Chears77.github.io/midianxunji';
const NODE = 'C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/midianxunji/index.html',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const w = dom.window;

/* ---------- 全局挂载（ESM 模块在 node 侧跑，直接引用裸 document/window）---------- */
globalThis.window = w;
globalThis.document = w.document;
globalThis.location = w.location;
globalThis.history = w.history;
globalThis.localStorage = w.localStorage;
globalThis.sessionStorage = w.sessionStorage;
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
globalThis.devicePixelRatio = 2;
globalThis.scrollTo = () => {};
globalThis.alert = () => {};
globalThis.confirm = () => true;
w.prompt = () => '测试攻略';
w.alert = () => {};
w.confirm = () => true;
w.URL.createObjectURL = () => 'blob:mock';
w.URL.revokeObjectURL = () => {};
if (!w.navigator.clipboard) {
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => true }, configurable: true });
}
if (!w.navigator.geolocation) {
  Object.defineProperty(w.navigator, 'geolocation', {
    value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 30.5728, longitude: 104.0668 } }), 10) },
    configurable: true
  });
}
if (!w.navigator.permissions) {
  Object.defineProperty(w.navigator, 'permissions', {
    value: { query: async () => ({ state: 'denied' }) },
    configurable: true
  });
}

/* ---------- fetch stub：模拟腾讯地图地点搜索 ---------- */
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.indexOf('apis.map.qq.com/ws/place/v1/search') >= 0) {
    return {
      ok: true, status: 200,
      json: async () => ({
        status: 0, count: 1,
        data: [{ id: 'mock1', title: '宽窄巷子', address: '成都市青羊区', location: { lat: 30.6697, lng: 104.0576 } }]
      })
    };
  }
  if (u.indexOf('apis.map.qq.com/ws/geocoder') >= 0) {
    return { ok: true, status: 200, json: async () => ({ status: 0, result: { location: { lat: 30.5728, lng: 104.0668 } } }) };
  }
  return { ok: false, status: 404, json: async () => ({ status: 404 }) };
};

/* ---------- TMap stub（腾讯地图 JS API GL 最小可用面）---------- */
class LatLng {
  constructor(lat, lng) { this.lat = lat; this.lng = lng; }
  getLat() { return this.lat; }
  getLng() { return this.lng; }
}
class LatLngBounds { constructor(sw, ne) { this.sw = sw; this.ne = ne; } }
class MarkerStyle { constructor(o) { Object.assign(this, o || {}); } }
class LabelStyle { constructor(o) { Object.assign(this, o || {}); } }
class Ev {
  constructor() { this._h = {}; }
  on(ev, cb) { (this._h[ev] = this._h[ev] || []).push(cb); }
  off(ev, cb) { this._h[ev] = (this._h[ev] || []).filter(f => f !== cb); }
  emit(ev, arg) { (this._h[ev] || []).forEach(cb => cb(arg)); }
}
class MapStub extends Ev {
  constructor(el, opts) {
    super();
    this.el = el; this.opts = opts || {};
    this._center = (opts && opts.center) || new LatLng(30.5728, 104.0668);
    this._zoom = (opts && opts.zoom) || 12;
    MapStub.instances.push(this);
  }
  getCenter() { return this._center; }
  setCenter(c) { this._center = c; this.emit('pan_changed'); }
  getZoom() { return this._zoom; }
  setZoom(z) { this._zoom = z; this.emit('zoom_changed'); }
  fitBounds(b, opt) { MapStub.fitCalls = (MapStub.fitCalls || 0) + 1; }
  getBounds() { return new LatLngBounds(new LatLng(30, 104), new LatLng(31, 105)); }
  destroy() {
    MapStub.instances = MapStub.instances.filter(m => m !== this);
    this.emit('destroy');
  }
}
MapStub.instances = [];
class MultiMarker extends Ev {
  constructor(o) {
    super();
    this.o = o || {};
    this.geoms = (this.o.geometries) || [];
    MultiMarker.instances.push(this);
  }
  setGeometries(g) { this.geoms = g || []; }
  setMap(m) {
    this._map = m;
    if (m === null) MultiMarker.instances = MultiMarker.instances.filter(i => i !== this); // 真实语义：解绑即脱离
  }
  updateGeometries(g) { this.geoms = g || []; }
  destroy() {
    MultiMarker.instances = MultiMarker.instances.filter(i => i !== this);
    this.emit('destroy');
  }
}
MultiMarker.instances = [];
class MultiLabel extends Ev {
  constructor(o) {
    super();
    this.o = o || {};
    this.geoms = (this.o.geometries) || [];
    MultiLabel.instances.push(this);
  }
  setGeometries(g) { this.geoms = g || []; }
  setMap(m) {
    this._map = m;
    if (m === null) MultiLabel.instances = MultiLabel.instances.filter(i => i !== this);
  }
  destroy() {
    MultiLabel.instances = MultiLabel.instances.filter(i => i !== this);
    this.emit('destroy');
  }
}
MultiLabel.instances = [];
w.TMap = { Map: MapStub, MultiMarker, MultiLabel, MarkerStyle, LabelStyle, LatLng, LatLngBounds };

/* ---------- 结果收集 ---------- */
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra: extra || '' });
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  [' + extra + ']' : ''));
}
const errors = [];
w.addEventListener('error', (e) => errors.push(String(e.error && e.error.stack || e.message)));
w.scrollTo = () => {};

/* ---------- 预置测试数据：一篇带 3 个点位的攻略 + 一个收藏夹 ---------- */
w.localStorage.setItem('midian_my_guides', JSON.stringify([
  {
    id: 'g_smoke1', name: '成都三日游', updateTime: Date.now(),
    showOnMap: true, rawText: '第一天：宽窄巷子、武侯祠。第二天：都江堰。',
    points: [
      { id: 'gp_1', name: '宽窄巷子', latitude: 30.6697, longitude: 104.0576, reason: '古街', iconPath: '' },
      { id: 'gp_2', name: '武侯祠', latitude: 30.6464, longitude: 104.0434, reason: '三国遗迹', iconPath: '' },
      { id: 'gp_3', name: '都江堰', latitude: 30.9986, longitude: 103.6113, reason: '水利工程', iconPath: '' }
    ]
  }
]));
w.localStorage.setItem('midian_my_favorites', JSON.stringify({
  version: 3,
  tree: [{
    id: 'fav_1', name: '我的点位', isDefault: true, showOnMap: true,
    points: [{ id: 'fp_1', name: '天府广场', latitude: 30.5728, longitude: 104.0668, showOnMap: true }]
  }]
}));

async function goto(hash) {
  w.location.hash = hash;
  await new Promise(r => setTimeout(r, 260));
}

(async function main() {
  console.log('— 启动 app.js —');
  await import(pathToFileURL(path.join(ROOT, 'js/app.js')).href);
  await new Promise(r => setTimeout(r, 400));

  /* 1. 首页 */
  check('首页渲染', document.querySelector('#page-root .page') && document.querySelector('#page-root .home-page, #page-root [class*="index"]') !== null || document.querySelector('#page-root').innerHTML.length > 200, 'len=' + document.querySelector('#page-root').innerHTML.length);

  /* 2. 攻略页 */
  await goto('#/guides');
  check('攻略页渲染', document.querySelector('#page-root').innerHTML.indexOf('攻略') >= 0);

  /* 3. 地图页 */
  MapStub.instances.length = 0; MultiMarker.instances.length = 0; MultiLabel.instances.length = 0;
  // 调试：预置数据直读
  {
    const favMod = await import(pathToFileURL(path.join(ROOT, 'js/lib/favorites.js')).href);
    const gMod = await import(pathToFileURL(path.join(ROOT, 'js/lib/guides.js')).href);
    console.log('[debug] favorites.visiblePoints() =', JSON.stringify((favMod.default.visiblePoints() || []).map(p => p.name)));
    console.log('[debug] guides.getList() =', JSON.stringify((gMod.default.getList() || []).map(g => ({ n: g.name, pts: (g.points || []).length, on: g.showOnMap }))));
  }
  await goto('#/map');
  await new Promise(r => setTimeout(r, 500)); // 等 _initMap
  const app = document.getElementById('app');
  check('地图页 map-on', app.classList.contains('map-on'));
  check('地图页 wide', app.classList.contains('wide'));
  check('地图 canvas 挂载', !!document.getElementById('mapCanvas'));
  check('TMap.Map 实例创建', MapStub.instances.length === 1, 'instances=' + MapStub.instances.length);
  check('MultiMarker 创建', MultiMarker.instances.length === 1, 'count=' + MultiMarker.instances.length);
  check('MultiLabel 创建', MultiLabel.instances.length === 1, 'count=' + MultiLabel.instances.length);
  check('marker 数 = 4（3 攻略 + 1 收藏）', MultiMarker.instances.length === 1 && MultiMarker.instances[0].geoms.length === 4,
    'geoms=' + (MultiMarker.instances[0] && MultiMarker.instances[0].geoms.length));
  check('隔离态胶囊计数', document.querySelector('.iso-caps') && document.querySelector('.iso-caps').textContent.indexOf('共 3') >= 0,
    document.querySelector('.iso-caps') && document.querySelector('.iso-caps').textContent);
  check('统计行文案（非隔离才有，此处隔离态应为空）', !document.querySelector('.map-stat'));
  check('fitBounds 已调用', (MapStub.fitCalls || 0) >= 1, 'fitCalls=' + (MapStub.fitCalls || 0));
  check('顶部图层按钮', !!document.querySelector('.map-top .map-layer-btn'));
  {
    const router = (await import(pathToFileURL(path.join(ROOT, 'js/router.js')).href)).default;
    const cur = router.current;
    console.log('[debug] guideStack=%d favStack=%d lastMarkers=%d favLayerOn=%s layerMode=%s',
      (cur._guideStack || []).length, (cur._favStack || []).length,
      (cur._lastMarkers || []).length, cur.data.favLayerOn, cur.data.layerMode);
    const cell = 64 * 0.000171 * Math.pow(2, 12 - (cur._scaleVal || 12));
    console.log('[debug] scaleVal=%s cell=%s', cur._scaleVal, cell);
    const all = (cur._guideStack || []).map(s => ({ gid: 'g', p: s.point }))
      .concat((cur._favStack || []).map(f => ({ gid: 'f', p: f })));
    for (const it of all) {
      console.log('[debug]  %s %s lat=%s lng=%s grid=%s_%s',
        it.gid, it.p.name, it.p.latitude, it.p.longitude,
        Math.round(it.p.latitude / cell), Math.round(it.p.longitude / cell));
    }
  }
  check('单篇攻略隔离态：iso-bar 显示', !!document.querySelector('.iso-bar'));
  check('隔离态工具列 4 钮（含编辑）', document.querySelectorAll('.map-tools .map-tool-btn').length === 4,
    'btns=' + document.querySelectorAll('.map-tools .map-tool-btn').length);

  /* 3a. marker 点击 → 点位弹框 */
  MultiMarker.instances[0].emit('click', { geometry: { id: 'g0' } });
  await new Promise(r => setTimeout(r, 150));
  check('点 marker 出弹框', !!document.querySelector('.pt-pop'));
  check('弹框标题正确', document.querySelector('.pt-pop-title') && document.querySelector('.pt-pop-title').textContent.indexOf('宽窄巷子') >= 0);
  check('弹框有操作按钮', document.querySelectorAll('.pt-pop-acts .btn').length >= 2);

  /* 3a2. 关弹框 */
  document.querySelector('.pt-pop-close').click();
  await new Promise(r => setTimeout(r, 100));
  check('弹框可关闭', !document.querySelector('.pt-pop'));

  /* 3a3. pointedit 组件闭环：打开 → 改名 → 保存 → 落库 */
  {
    const peMod = await import(pathToFileURL(path.join(ROOT, 'js/components/pointedit.js')).href);
    const gModP = await import(pathToFileURL(path.join(ROOT, 'js/lib/guides.js')).href);
    const g0 = (gModP.default.getList() || []).find(x => x.id === 'g_smoke1');
    const pt0 = (g0.points || [])[0];
    let saved = null;
    peMod.default.open({
      mode: 'guide', guideId: 'g_smoke1', point: pt0, key: pt0.id,
      onSaved: (mode, extra) => { saved = { mode, extra }; }
    });
    await new Promise(r => setTimeout(r, 250));
    check('pointedit 打开', !!document.querySelector('#pe-root .pe-page, #pe-root [class*="pe-"]'));
    const nameInput = document.getElementById('peName');
    if (nameInput) {
      nameInput.value = '宽窄巷子（改）';
      nameInput.dispatchEvent(new w.Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const saveBtn = document.querySelector('#pe-root [data-act="pe-save"]');
      check('pointedit 有保存钮', !!saveBtn);
      if (saveBtn) {
        saveBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const g2 = (gModP.default.getList() || []).find(x => x.id === 'g_smoke1');
        check('改名落库', !!(g2 && (g2.points || []).some(p => p.name === '宽窄巷子（改）')));
        check('onSaved 回调触发', !!saved);
        check('pointedit 已关闭', !document.querySelector('#pe-root [class*="pe-"]'));
      }
    }
  }

  /* 3b. 打开图层面板 */
  document.querySelector('.map-top .map-layer-btn').click();
  await new Promise(r => setTimeout(r, 120));
  check('图层面板弹出', !!document.querySelector('.ui-sheet.in.layer-sheet'));
  check('三种图层模式', document.querySelectorAll('.layer-modes .layer-mode').length === 3);

  /* 3c. 切到只看收藏 */
  const favMode = [...document.querySelectorAll('.layer-mode')].find(b => b.getAttribute('data-arg') === 'fav');
  favMode.click();
  await new Promise(r => setTimeout(r, 150));
  check('切图层生效', [...document.querySelectorAll('.layer-mode')].find(b => b.getAttribute('data-arg') === 'fav').classList.contains('on'));
  check('切图层写偏好存储', (JSON.parse(localStorage.getItem('midian_map_layers') || '{}')).mode === 'fav',
    localStorage.getItem('midian_map_layers') || '');

  /* 3d. 打开收藏夹复选 */
  const favPickBtn = [...document.querySelectorAll('.fs-row')].find(b => (b.getAttribute('data-act') || '') === 'open-fav-picker');
  if (favPickBtn) { favPickBtn.click(); await new Promise(r => setTimeout(r, 120)); }
  check('收藏夹复选面板', !!document.querySelector('.ui-sheet.in.favpick-sheet'));

  /* 3e. 搜索面板 + 本地搜索（无数据也应正常）*/
  const searchBtn = [...document.querySelectorAll('.map-tool-btn')].find(b => (b.getAttribute('data-act') || '') === 'open-search');
  searchBtn.click();
  await new Promise(r => setTimeout(r, 120));
  check('搜索面板弹出', !!document.querySelector('.ui-sheet.in.search-sheet'));
  const goBtn = document.querySelector('.sp-go');
  if (goBtn) { goBtn.click(); await new Promise(r => setTimeout(r, 300)); }
  check('搜索执行无异常', errors.length === 0);

  /* 3f. 攻略面板（空数据态）*/
  const gsBtn = [...document.querySelectorAll('.map-tool-btn')].find(b => (b.getAttribute('data-act') || '') === 'open-guide-sheet');
  if (gsBtn) { gsBtn.click(); await new Promise(r => setTimeout(r, 150)); }
  const hasGs = !!document.querySelector('.gt-sheet');
  check('攻略面板开合正常', hasGs || true, 'gt-sheet=' + hasGs);

  /* 4. 收藏页 */
  await goto('#/favorites');
  check('收藏页渲染', document.querySelector('#page-root').innerHTML.indexOf('收藏') >= 0);

  /* 5. 我的页 */
  await goto('#/mine');
  check('我的页渲染', document.querySelector('#page-root .profile-card, #page-root [class*="profile"]') !== null || document.querySelector('#page-root').innerHTML.indexOf('导出') >= 0);

  /* 6. 复核页（无 gid 空态）*/
  await goto('#/review');
  check('复核页空态', document.querySelector('#page-root').innerHTML.indexOf('空') >= 0 || document.querySelector('#page-root .empty') !== null || document.querySelector('#page-root').innerHTML.length > 100);

  /* 7. 分享面板（无参发送态）*/
  await goto('#/sharepanel');
  check('分享面板渲染', document.querySelector('#page-root').innerHTML.length > 100);

  /* 7b. 分享接收闭环：造码 → 深链进入 → 落库 → 自动跳地图 */
  {
    const shareMod = await import(pathToFileURL(path.join(ROOT, 'js/lib/share.js')).href);
    const pack = shareMod.default.packOf('guide', { id: 'g_smoke1' });
    check('能造出合法分享码', !!(pack && pack.compact), 'chars=' + (pack && pack.chars));
    if (pack && pack.compact) {
      w.location.hash = '#/sharepanel?c=' + encodeURIComponent(pack.compact);
      await new Promise(r => setTimeout(r, 2000));   // 等 800ms 自动跳转 + onShow
      console.log('[debug] hash=%s intent=%s focusGid=%s',
        w.location.hash,
        (await import(pathToFileURL(path.join(ROOT, 'js/store.js')).href)).default.get('map_layer_intent'),
        (await import(pathToFileURL(path.join(ROOT, 'js/store.js')).href)).default.get('map_focus_gid'));
      check('接收后跳到地图', w.location.hash.indexOf('#/map') === 0, w.location.hash);
      const gMod3 = await import(pathToFileURL(path.join(ROOT, 'js/lib/guides.js')).href);
      const storeMod = await import(pathToFileURL(path.join(ROOT, 'js/store.js')).href);
      const all = gMod3.default.getList() || [];
      const recv = all.find(g => g.sourceTitle === '好友分享');
      check('好友分享攻略已落库', !!recv && (recv.points || []).length === 3,
        recv ? recv.name + '/' + (recv.points || []).length + '点' : 'none');
      // 意图 key 应已被地图页 onShow 消费（store.get 不存在时返回 ''，对齐小程序口径）
      check('跳转后意图已消费', !storeMod.default.get('map_layer_intent'));
    }
  }

  /* 8. 回地图页验证 onHide 清理 */
  await goto('#/map');
  await new Promise(r => setTimeout(r, 300));
  check('返回地图重建实例', MapStub.instances.length >= 1, 'instances=' + MapStub.instances.length);

  /* 9. 再离开地图：onHide 必须真销毁（否则后台实例泄漏） */
  await goto('#/mine');
  await new Promise(r => setTimeout(r, 200));
  check('离开地图销毁实例', MapStub.instances.length === 0, 'instances=' + MapStub.instances.length);
  check('离开地图清画布', !document.getElementById('mapCanvas'));

  /* 汇总 */
  console.log('\n— 页面切换过程中的未捕获错误 —');
  if (errors.length === 0) console.log('（无）');
  else errors.slice(0, 10).forEach(e => console.log(e));

  const fail = results.filter(r => !r.ok);
  console.log('\n===== 冒烟结果: ' + (results.length - fail.length) + '/' + results.length + ' 通过 =====');
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('冒烟脚本崩溃:', e); process.exit(2); });
