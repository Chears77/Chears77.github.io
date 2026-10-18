/**
 * components/pointedit.js —— 点位详情/编辑组件（网页版）
 *
 * 对齐小程序 components/pointedit：三种模式（new 收藏新点 / fav 收藏副本 / guide 攻略点位），
 * 照片（IndexedDB）、名称、来源+查看全文、收藏夹多选、攻略多选、备注、位置（地图选点）、
 * 图标（收藏形状 / 攻略符号两套体系）、删除（单处 / 全部两档）。
 *
 * 用法：import pe from '../components/pointedit.js'; pe.open({ mode, point, key, fid, guideId, onSaved });
 */
import store from '../store.js';
import ui from '../ui.js';
import guides from '../lib/guides.js';
import favorites from '../lib/favorites.js';
import follow from '../lib/follow.js';
import places from '../lib/places.js';
import categories from '../lib/categories.js';
import favicon from '../lib/favicon.js';
import { esc } from '../page.js';
import { pickPointOnMap } from '../mappicker.js';

const PALETTE = favicon.COLORS;

const state = {
  visible: false,
  mode: 'new',
  name: '', note: '', guideText: '',
  latitude: null, longitude: null,
  photos: [],
  catKey: 'jingdian',
  colorOverride: '',
  folderRows: [], guideRows: [],
  checkedFolderCount: 0, checkedGuideCount: 0,
  pointIcon: { shape: 'star', colorIdx: 0, path: '', color: '' },
  guideIcon: { shape: 'mountain', colorIdx: 1, path: '', color: '', marker: '' },
  popup: '', popupTitle: '',
  pickKind: 'point', pickShape: 'star', pickColorIdx: 0,
  sourceLabel: '', sourceJumpable: false,
  distanceText: '', placeShareText: '',
  guideFullText: '', guideFullName: '', guideFullVisible: false,
  // 内部
  _gid: '', _key: '', _fid: '', _orig: {},
  _origFolderIds: [], _origGuideIds: [],
  _pointIconPicked: false, _guideIconPicked: false,
  _srcGuideId: '', _srcGuideName: '',
  _placeKey: '', _placeOthers: { guides: [], favs: [], total: 0 },
  _onSaved: null
};

/* ============ 距离（与小程序 _distanceTextOf 同口径）============ */
function distanceTextOf(lat, lng) {
  if (!lat || !lng) return '';
  const me = store.get('my_location');
  if (!me || !me.latitude) return '';
  const geo = window.__geo;
  if (!geo) return '';
  const d = geo.distanceMeters(me.latitude, me.longitude, lat, lng);
  return geo.formatDistance(d);
}

/* ============ 图标解析（与 favicon 三级优先同口径）============ */
function resolveGuideIcon(srcGuide, guideRows) {
  if (srcGuide) return favicon.guideIconOf(srcGuide, (srcGuide.points || [])[0] || null, '');
  const first = (guideRows || []).find(g => g.checked);
  if (first) {
    const g = guides.getById(first.id);
    if (g) return favicon.guideIconOf(g, (g.points || [])[0] || null, '');
  }
  return favicon.guideIconOf(null, null, '');
}

/* ============ 渲染 ============ */
function render() {
  const host = document.getElementById('pe-root');
  if (!host) return;
  if (!state.visible) { host.innerHTML = ''; return; }
  const d = state;

  const photoCells = d.photos.map((id, i) =>
    '<div class="imgcell" data-pe-photo="' + i + '"><img data-pe-src="' + esc(id) + '" alt=""></div>'
  ).join('');
  const addCell = d.photos.length < 6
    ? '<button class="imgcell-add" data-act="pe-add-photo">＋</button>' : '';

  const folderTags = d.folderRows.filter(f => f.checked).map(f => '<span class="pe-tag">' + esc(f.name) + '</span>').join('')
    || '<span class="pe-tag empty">' + (d.folderRows.length ? '选择收藏夹' : '还没有收藏夹') + '</span>';
  const guideTags = d.guideRows.filter(g => g.checked).map(g => '<span class="pe-tag">' + esc(g.name) + '</span>').join('')
    || '<span class="pe-tag empty">' + (d.guideRows.length ? '选择攻略' : '还没有攻略') + '</span>';

  const pIconPath = d.pointIcon.path || 'images/marker/star-gray-big.png';
  const gIconPath = d.guideIcon.marker || 'images/marker/star-gray-big.png';

  /* 弹窗：多选 / 图标 */
  let popHtml = '';
  if (d.popup === 'folder' || d.popup === 'guide') {
    const rows = d.popup === 'folder'
      ? d.folderRows.map(f =>
        '<button class="pe-opt" data-act="pe-toggle-folder" data-arg="' + esc(f.id) + '">' +
        '<span class="pe-check' + (f.checked ? ' on' : '') + '">' + (f.checked ? '✓' : '') + '</span>' +
        '<span class="pe-opt-name">' + esc(f.name) + '</span><span class="pe-opt-count">' + esc(f.count) + '</span></button>').join('') +
        (d.popup === 'folder' ? '<button class="pe-pop-add" data-act="pe-new-folder">＋ 新建收藏夹</button>' : '')
      : d.guideRows.map(g =>
        '<button class="pe-opt" data-act="pe-toggle-guide" data-arg="' + esc(g.id) + '">' +
        '<span class="pe-check' + (g.checked ? ' on' : '') + '">' + (g.checked ? '✓' : '') + '</span>' +
        '<span class="pe-opt-name">' + esc(g.name) + '</span><span class="pe-opt-count">' + (g.fixed ? '当前' : esc(g.count)) + '</span></button>').join('');
    popHtml =
      '<div class="ui-mask in" data-act="pe-close-pop"></div>' +
      '<div class="ui-sheet in pe-pop">' +
      '  <div class="sheet-head"><div class="sheet-title">' + esc(d.popupTitle) + '</div>' +
      '    <button class="sheet-done" data-act="pe-close-pop">完成</button></div>' +
      '  <div class="pe-pop-body">' + rows + '</div>' +
      '</div>';
  } else if (d.popup === 'pointIcon' || d.popup === 'guideIcon') {
    const isGuide = d.pickKind === 'guide';
    const shapes = isGuide ? favicon.GUIDE_SHAPES : favicon.SHAPES;
    const cell = (s) =>
      '<button class="pe-shape' + (d.pickShape === s.key ? ' on' : '') + '" data-act="pe-pick-shape" data-arg="' + esc(s.key) + '">' +
      (isGuide
        ? '<img class="mk" src="images/marker/marker-' + esc(s.key) + '-' + esc(favicon.markerColorIdx(d.pickColorIdx)) + '-big.png" alt="">'
        : '<img src="images/fav/fav-' + esc(s.key) + '-' + esc(d.pickColorIdx) + '.png" alt="">') +
      '<span>' + esc(s.name) + '</span></button>';
    popHtml =
      '<div class="ui-mask in" data-act="pe-close-pop"></div>' +
      '<div class="ui-sheet in pe-pop">' +
      '  <div class="sheet-head"><div class="sheet-title">' + esc(d.popupTitle) + '</div>' +
      '    <button class="sheet-done" data-act="pe-close-pop">完成</button></div>' +
      '  <div class="pe-pop-body">' +
      '    <div class="pe-preview">' +
      (isGuide
        ? '<img class="mk" src="images/marker/marker-' + esc(d.pickShape) + '-' + esc(favicon.markerColorIdx(d.pickColorIdx)) + '-big.png" alt="">'
        : '<img src="images/fav/fav-' + esc(d.pickShape) + '-' + esc(d.pickColorIdx) + '.png" alt="">') +
      '      <span>' + (isGuide ? '符号与颜色（地图上就是这个样子）' : '形状与颜色') + '</span></div>' +
      '    <div class="pe-shape-grid' + (isGuide ? ' eight' : '') + '">' + shapes.map(cell).join('') + '</div>' +
      '    <div class="pe-color-grid">' + PALETTE.map((c, i) =>
        '<button class="pe-color-cell' + (d.pickColorIdx === i ? ' on' : '') + '" data-act="pe-pick-color" data-arg="' + i + '" style="background:' + c + '"></button>').join('') + '</div>' +
      '    <div class="pe-icon-actions">' +
      '      <button class="btn btn-s line" data-act="pe-close-pop">取消</button>' +
      '      <button class="btn btn-s" data-act="pe-confirm-icon">用这个</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  host.innerHTML =
    '<div class="ui-mask in" data-act="pe-close"></div>' +
    '<div class="ui-sheet in pe-sheet">' +
    '  <div class="sheet-grabber"></div>' +
    '  <div class="sheet-head"><div class="sheet-title">' + (d.mode === 'new' ? '收藏点位' : '点位详情') + '</div>' +
    '    <button class="sheet-close" data-act="pe-close">✕</button></div>' +
    '  <div class="pe-scroll">' +
    '    <div class="pe-photos">' + photoCells + addCell + '</div>' +
    '    <div class="pe-row"><span class="pe-label">名称</span>' +
    '      <input class="pe-input" id="peName" value="' + esc(d.name) + '" placeholder="请输入位置名称" maxlength="30"></div>' +
    '    <div class="pe-row' + (d.sourceJumpable ? ' tappable' : '') + '" data-act="pe-source-tap">' +
    '      <span class="pe-label">来源</span><span class="pe-src">' + esc(d.sourceLabel || '自己创建') + '</span>' +
    (d.sourceJumpable ? '<button class="pe-full-link" data-act="pe-source-tap">查看全文 ›</button>' : '') + '</div>' +
    '    <div class="pe-row tappable" data-act="pe-open-folder">' +
    '      <span class="pe-label">点位收藏</span><span class="pe-tags">' + folderTags + '</span>' +
    '      <img class="pe-ic' + (d.checkedFolderCount ? '' : ' off') + '" src="' + esc(pIconPath) + '" alt="">' +
    '      <span class="pe-arrow">›</span></div>' +
    '    <div class="pe-row tappable" data-act="pe-open-guide">' +
    '      <span class="pe-label">攻略收藏</span><span class="pe-tags">' + guideTags + '</span>' +
    '      <img class="pe-ic mk' + (d.checkedGuideCount ? '' : ' off') + '" src="' + esc(gIconPath) + '" alt="">' +
    '      <span class="pe-arrow">›</span></div>' +
    (d.placeShareText ? '<div class="pe-row"><span class="pe-label">同一位置</span><span class="pe-share">' + esc(d.placeShareText) + '</span></div>' : '') +
    '    <div class="pe-row top"><span class="pe-label">备注</span>' +
    '      <textarea class="pe-area" id="peNote" maxlength="200" placeholder="值得记的事：门票、停车、最佳时间…">' + esc(d.note) + '</textarea></div>' +
    '    <div class="pe-row tappable" data-act="pe-relocate">' +
    '      <span class="pe-label">位置</span>' +
    (d.latitude ? '<span class="pe-loc">' + esc(Number(d.latitude).toFixed(5)) + ', ' + esc(Number(d.longitude).toFixed(5)) + '</span>'
      : '<span class="pe-tag empty">还没选位置</span>') +
    (d.latitude ? '<button class="pe-mini-btn" data-act="pe-go-map">🧭 在地图看</button>' : '') +
    '      <button class="pe-mini-btn" data-act="pe-relocate">📍 改位置</button></div>' +
    (d.distanceText ? '<div class="pe-row"><span class="pe-label">距我</span><span class="pe-dist">' + esc(d.distanceText) + '</span></div>' : '') +
    '    <div class="pe-safe"></div>' +
    '  </div>' +
    '  <div class="pe-actions">' +
    (d.mode !== 'new' ? '<button class="btn btn-s danger" data-act="pe-remove">🗑 删除</button>' : '') +
    '    <button class="btn btn-s line" data-act="pe-close">取消</button>' +
    '    <button class="btn btn-s" data-act="pe-save">保存</button>' +
    '  </div>' +
    '</div>' + popHtml +

    (d.guideFullVisible ?
      '<div class="ui-mask in" data-act="pe-close-full"></div>' +
      '<div class="ui-sheet in pe-full">' +
      '  <div class="sheet-head"><div class="sheet-title">' + esc(d.guideFullName || '攻略全文') + '</div>' +
      '    <button class="sheet-close" data-act="pe-close-full">✕</button></div>' +
      '  <div class="pe-full-body"><div class="pe-full-text">' + esc(d.guideFullText) + '</div></div>' +
      '  <div class="pe-full-foot"><button class="btn btn-s line" data-act="pe-close-full">关闭</button></div>' +
      '</div>' : '');

  /* 照片异步上图 */
  host.querySelectorAll('[data-pe-src]').forEach(async (img) => {
    const u = await store.img.url(img.getAttribute('data-pe-src'));
    if (u) img.src = u;
  });
  /* 输入框受控 */
  const nm = host.querySelector('#peName');
  if (nm) nm.addEventListener('input', () => { state.name = nm.value; });
  const nt = host.querySelector('#peNote');
  if (nt) nt.addEventListener('input', () => { state.note = nt.value; });
  bindActs(host);
}

function bindActs(root) {
  const act = (name, fn) => {
    root.querySelectorAll('[data-act="' + name + '"]').forEach((n) => {
      n.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(e, n.getAttribute('data-arg') || '');
      });
    });
  };
  act('pe-close', () => close());
  act('pe-save', () => save());
  act('pe-remove', () => removePoint());
  act('pe-add-photo', () => addPhoto());
  act('pe-source-tap', () => openGuideFull());
  act('pe-open-folder', () => openPopup('folder'));
  act('pe-open-guide', () => openPopup('guide'));
  act('pe-toggle-folder', (e, id) => toggleFolder(id));
  act('pe-toggle-guide', (e, id) => toggleGuideRow(id));
  act('pe-new-folder', () => createFolderHere());
  act('pe-close-pop', () => { state.popup = ''; render(); });
  act('pe-pick-shape', (e, k) => { state.pickShape = k; render(); });
  act('pe-pick-color', (e, i) => { state.pickColorIdx = Number(i); render(); });
  act('pe-confirm-icon', () => confirmIcon());
  act('pe-relocate', () => relocate());
  act('pe-go-map', () => goMapHere());
  act('pe-close-full', () => { state.guideFullVisible = false; render(); });
}

/* ============ 打开 / 关闭 ============ */
function open(opts) {
  const o = opts || {};
  const mode = o.mode || 'new';
  state.visible = true;
  state.mode = mode;
  state._onSaved = o.onSaved || null;
  state._gid = o.guideId || '';
  state._key = o.key || '';
  state._fid = o.fid || '';
  state._orig = o.point || {};
  state.popup = '';
  state.guideFullVisible = false;

  let name = '', note = '', latitude = null, longitude = null, photos = [], catKey = 'jingdian', colorOverride = '';
  if (mode === 'new') {
    name = (o.point && o.point.name) || '';
    latitude = o.point ? o.point.latitude : null;
    longitude = o.point ? o.point.longitude : null;
  } else {
    const it = o.point || {};
    name = it.name || '';
    note = it.note || it.reason || '';
    latitude = it.latitude;
    longitude = it.longitude;
    photos = (it.imageUrls || []).slice(0, 6);
    catKey = it.category || 'jingdian';
    colorOverride = it.colorOverride || '';
  }
  state.name = name; state.note = note; state.guideText = (state._orig && state._orig.guideText) || '';
  state.latitude = latitude; state.longitude = longitude;
  state.photos = photos.slice(0, 6);
  state.catKey = catKey; state.colorOverride = colorOverride;
  state.distanceText = distanceTextOf(latitude, longitude);

  state.folderRows = buildFolderRows(mode);
  state.guideRows = buildGuideRows(mode);
  state.checkedFolderCount = state.folderRows.filter(f => f.checked).length;
  state.checkedGuideCount = state.guideRows.filter(g => g.checked).length;
  state._origFolderIds = state.folderRows.filter(f => f.checked).map(f => f.id);
  state._origGuideIds = state.guideRows.filter(g => g.checked).map(g => g.id);

  const pIcon = favicon.of(state._orig, 'point');
  state.pointIcon = pIcon;
  state._pointIconPicked = favicon.isShape(state._orig && state._orig.favShape);
  state.pickKind = 'point';
  state.pickShape = pIcon.shape || 'star';
  state.pickColorIdx = typeof pIcon.colorIdx === 'number' ? pIcon.colorIdx : 0;

  const srcGuideId = (mode === 'guide') ? state._gid : (state._orig.fromGuideId || '');
  const srcGuide = srcGuideId ? guides.getById(srcGuideId) : null;
  const gIcon = resolveGuideIcon(srcGuide, state.guideRows);
  state.guideIcon = gIcon;
  state._guideIconPicked = (gIcon.level === 'point');
  state._guideFullText = srcGuide ? (srcGuide.rawText || '') : '';

  state.sourceLabel = '';
  state.sourceJumpable = false;
  state._srcGuideId = '';
  state._srcGuideName = '';
  if (srcGuide) {
    state.sourceLabel = '来自攻略《' + (srcGuide.name || '') + '》';
    state._srcGuideId = srcGuide.id;
    state._srcGuideName = srcGuide.name || '';
    state.sourceJumpable = true;
  } else if (mode === 'new') {
    state.sourceLabel = '自己创建';
  } else {
    state.sourceLabel = '地图添加';
  }

  /* 同位置（R63 口径） */
  state._placeKey = places.keyOf(state._orig);
  if (state._placeKey) {
    state._placeOthers = places.scan(state._placeKey, { nodeId: state._fid, key: state._key }) || { guides: [], favs: [], total: 0 };
    state.placeShareText = places.describe(state._placeOthers) || '';
  } else {
    state._placeOthers = { guides: [], favs: [], total: 0 };
    state.placeShareText = '';
  }

  render();
}

function close() {
  state.visible = false;
  state.popup = '';
  state.guideFullVisible = false;
  render();
}

/* ============ 多选行 ============ */
function buildFolderRows(mode) {
  const key = state._key || favorites.keyOf(state._orig);
  const inNodes = key ? favorites.nodeIdsOf(key) : [];
  return favorites.getTree().map(f => ({
    id: f.id,
    name: f.name,
    count: (f.points || []).length,
    checked: inNodes.indexOf(f.id) >= 0
  }));
}
function buildGuideRows(mode) {
  const rows = [];
  const list = guides.getList();
  for (const g of list) {
    const pts = g.points || [];
    const fixed = (mode === 'guide') && g.id === state._gid;
    const inIt = fixed || (state._orig && state._orig.fromGuideId === g.id) ||
      (state._orig && state._orig.fromPointId && pts.some(p => p.id === state._orig.fromPointId));
    rows.push({
      id: g.id,
      name: g.name || '未命名攻略',
      count: pts.length,
      fixed,
      checked: !!inIt
    });
  }
  return rows;
}
function toggleFolder(id) {
  const r = state.folderRows.find(f => f.id === id);
  if (!r) return;
  r.checked = !r.checked;
  state.checkedFolderCount = state.folderRows.filter(f => f.checked).length;
  render();
}
function toggleGuideRow(id) {
  const r = state.guideRows.find(g => g.id === id);
  if (!r || r.fixed) return;
  r.checked = !r.checked;
  state.checkedGuideCount = state.guideRows.filter(g => g.checked).length;
  render();
}
function createFolderHere() {
  const name = (window.prompt('新建收藏夹名称', '') || '').trim().slice(0, 12);
  if (!name) return;
  const f = favorites.createFolder(name);
  if (f) {
    const r = state.folderRows.find(x => x.id === f.id);
    if (r) r.checked = true;
    state.checkedFolderCount = state.folderRows.filter(x => x.checked).length;
  }
  render();
}

/* ============ 弹窗 ============ */
function openPopup(kind) {
  if (kind === 'folder' || kind === 'guide') {
    state.popup = kind;
    state.popupTitle = kind === 'folder' ? '选择收藏夹' : '选择攻略';
    render();
    return;
  }
  // 图标
  state.pickKind = kind === 'guideIcon' ? 'guide' : 'point';
  if (state.pickKind === 'guide') {
    state.pickShape = state.guideIcon.shape || 'mountain';
    state.pickColorIdx = typeof state.guideIcon.colorIdx === 'number' ? state.guideIcon.colorIdx : 0;
  } else {
    state.pickShape = state.pointIcon.shape || 'star';
    state.pickColorIdx = typeof state.pointIcon.colorIdx === 'number' ? state.pointIcon.colorIdx : 0;
  }
  state.popup = kind;
  state.popupTitle = state.pickKind === 'guide' ? '攻略符号' : '收藏形状';
  render();
}
function confirmIcon() {
  if (state.pickKind === 'guide') {
    state.guideIcon = Object.assign({}, state.guideIcon, {
      shape: state.pickShape, colorIdx: state.pickColorIdx,
      marker: 'images/marker/marker-' + state.pickShape + '-' + favicon.markerColorIdx(state.pickColorIdx) + '-big.png'
    });
    state._guideIconPicked = true;
  } else {
    state.pointIcon = Object.assign({}, state.pointIcon, {
      shape: state.pickShape, colorIdx: state.pickColorIdx,
      path: 'images/fav/fav-' + state.pickShape + '-' + state.pickColorIdx + '.png'
    });
    state._pointIconPicked = true;
  }
  state.popup = '';
  render();
}

/* ============ 照片 ============ */
async function addPhoto() {
  const left = 6 - state.photos.length;
  if (left <= 0) { ui.toast('最多 6 张', 'none'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = left > 1;
  inp.addEventListener('change', async () => {
    const files = Array.from(inp.files || []).slice(0, left);
    for (const f of files) {
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || ''));
        r.onerror = () => res('');
        r.readAsDataURL(f);
      });
      if (dataUrl) {
        const id = await store.img.save(dataUrl);
        state.photos.push(id);
      }
    }
    render();
  });
  inp.click();
}
function removePhotoAt(i) {
  state.photos.splice(i, 1);
  render();
}

/* ============ 位置 ============ */
async function relocate() {
  const r = await pickPointOnMap(state.latitude, state.longitude, state.name);
  if (!r) return;
  state.latitude = r.latitude;
  state.longitude = r.longitude;
  if (!state.name && r.name) state.name = r.name;
  state.distanceText = distanceTextOf(r.latitude, r.longitude);
  render();
  ui.toast('位置已更新', 'success');
}
function goMapHere() {
  const lat = Number(state.latitude), lng = Number(state.longitude);
  if (!lat || !lng) { ui.toast('这个点位还没有坐标', 'none'); return; }
  store.set('map_locate_point', { lat, lng, name: state.name || '', gid: state._gid || '', fid: state._fid || '' });
  close();
  location.hash = '/map';
}

/* ============ 攻略全文 ============ */
function openGuideFull() {
  if (!state.sourceJumpable) return;
  state.guideFullName = state._srcGuideName || '攻略全文';
  state.guideFullText = state._guideFullText || '（这篇攻略没有保存正文）';
  state.guideFullVisible = true;
  render();
}

/* ============ 保存 ============ */
function save() {
  const d = state;
  const name = (d.name || '').trim();
  if (!name) { ui.toast('请填写名称', 'none'); return; }
  if (!(d.latitude && d.longitude)) { ui.toast('缺少位置坐标，点「改位置」选点', 'none'); return; }
  const checkedFolders = d.folderRows.filter(f => f.checked).map(f => f.id);
  const checkedGuides = d.guideRows.filter(g => g.checked).map(g => g.id);
  if (d.mode === 'new') return saveNew(name, checkedFolders, checkedGuides);
  if (d.mode === 'fav') return saveFav(name, checkedFolders, checkedGuides);
  return saveGuide(name, checkedFolders, checkedGuides);
}

function afterSaved(mode, extra) {
  close();
  ui.toast('已保存', 'success');
  if (state._onSaved) state._onSaved(mode, extra);
}

function saveNew(name, folderIds, guideIds) {
  const d = state;
  const point = {
    name,
    category: d.catKey,
    group: '手工添加',
    section: '',
    primary: true,
    reason: d.note || '',
    quote: '',
    imageUrls: d.photos.slice(0, 6),
    colorOverride: d.colorOverride,
    latitude: d.latitude,
    longitude: d.longitude,
    note: d.note || '',
    poiName: name,
    favShape: d.pointIcon.shape,
    favColorIdx: d.pointIcon.colorIdx
  };
  let n = 0;
  if (folderIds.length) { favorites.addItem(point, folderIds); n += folderIds.length; }
  for (const gid of guideIds) {
    const gp = Object.assign({}, point);
    delete gp.favShape;
    delete gp.favColorIdx;
    guides.addPoint(gid, gp);
    n += 1;
  }
  if (!n) {
    const def = favorites.ensureDefault();
    favorites.addItem(point, [def.id]);
    n = 1;
  }
  store.set('guide_refresh_token', { token: Date.now() });
  afterSaved('new');
}

function wasInGuide(gid) {
  const g = guides.getById(gid);
  return !!(g && (g.points || []).some(p => p.id === state._orig.fromPointId));
}

function saveFav(name, folderIds, guideIds) {
  const d = state;
  const key = d._key;
  if (!key) { close(); return; }
  favorites.updateItem(key, {
    name,
    latitude: d.latitude,
    longitude: d.longitude,
    category: d.catKey,
    colorOverride: d.colorOverride,
    note: d.note || '',
    reason: d.note || '',
    imageUrls: d.photos.slice(0, 6),
    favShape: d.pointIcon.shape,
    favColorIdx: d.pointIcon.colorIdx
  });
  if (folderIds.length) favorites.setNodesOf(key, folderIds);
  const updated = Object.assign({}, d._orig, {
    name, latitude: d.latitude, longitude: d.longitude,
    category: d.catKey, colorOverride: d.colorOverride,
    reason: d.note || '', imageUrls: d.photos.slice(0, 6)
  });
  for (const g of d.guideRows) {
    if (g.fixed) continue;
    if (g.checked && !wasInGuide(g.id)) {
      const gp = Object.assign({}, updated);
      delete gp.favShape;
      delete gp.favColorIdx;
      guides.addPoint(g.id, gp);
    }
    if (!g.checked && wasInGuide(g.id)) guides.removePoint(g.id, d._orig.fromPointId);
  }
  {
    const k = favorites.keyOf(d._orig);
    if (k && favorites.nodeIdsOf(k).length && typeof d.guideText === 'string') {
      favorites.updateItem(k, { guideText: d.guideText });
    }
  }
  if (d._guideIconPicked && d._orig.fromGuideId && d._orig.fromPointId) {
    guides.updatePoint(d._orig.fromGuideId, d._orig.fromPointId, {
      favShape: d.guideIcon.shape, favColorIdx: d.guideIcon.colorIdx
    });
    store.set('guide_refresh_token', { token: Date.now() });
  }
  store.set('guide_refresh_token', { token: Date.now() });
  afterSaved('fav');
}

function saveGuide(name, folderIds, guideIds) {
  const d = state;
  const gid = d._gid;
  const pid = d._orig.id;
  if (!gid || !pid) { close(); return; }
  const pointPatch = {
    name,
    latitude: d.latitude,
    longitude: d.longitude,
    category: d.catKey,
    colorOverride: d.colorOverride,
    reason: d.note || '',
    imageUrls: d.photos.slice(0, 6)
  };
  if (d._pointIconPicked) pointPatch.favColorIdx = d.pointIcon.colorIdx;
  if (d._guideIconPicked) {
    pointPatch.favShape = d.guideIcon.shape;
    pointPatch.favColorIdx = d.guideIcon.colorIdx;
  }
  pointPatch.guideText = d.guideText || '';
  guides.updatePoint(gid, pid, pointPatch);
  const guide = guides.getById(gid);
  const updated = Object.assign({}, d._orig, {
    name, latitude: d.latitude, longitude: d.longitude,
    category: d.catKey, colorOverride: d.colorOverride,
    reason: d.note || '', imageUrls: d.photos.slice(0, 6),
    guideText: d.guideText || ''
  });
  if (d._pointIconPicked) {
    updated.favShape = favicon.isShape(d.pointIcon.shape) ? d.pointIcon.shape : 'star';
    updated.favColorIdx = d.pointIcon.colorIdx;
  } else if (d._guideIconPicked) {
    updated.favShape = '';
  }
  for (const f of d.folderRows) {
    const was = d._origFolderIds.indexOf(f.id) >= 0;
    if (f.checked && !was) favorites.starFromGuide(f.id, updated, guide);
    if (!f.checked && was) favorites.removeBySource(f.id, pid);
  }
  for (const g2 of d.guideRows) {
    if (g2.fixed || !g2.checked) continue;
    if (!wasInGuide(g2.id)) guides.addPoint(g2.id, updated);
  }
  if (d._origFolderIds.length || d.folderRows.some(f => f.checked)) {
    const key = favorites.keyOf(d._orig);
    if (key && favorites.nodeIdsOf(key).length) {
      const patchCopy = { favColorIdx: d.pointIcon.colorIdx };
      if (d._pointIconPicked) patchCopy.favShape = favicon.isShape(d.pointIcon.shape) ? d.pointIcon.shape : 'star';
      favorites.updateItem(key, patchCopy);
    }
  }
  store.set('guide_refresh_token', { token: Date.now() });
  afterSaved('guide', { guideId: gid });
}

/* ============ 删除（单处 / 全部）============ */
async function removePoint() {
  const mode = state.mode;
  const name = ((state.name || '').trim()) || '这个点位';
  if (state._placeOthers && state._placeOthers.total > 0) {
    const idx = await ui.sheet(['只删除这一处', '全部删除（还在 ' + (places.describe(state._placeOthers) || '其他位置') + '）']);
    if (idx === 0) removeHere();
    else if (idx === 1) removeEverywhere();
    return;
  }
  const ok = await ui.modal({
    title: '删除「' + name + '」？',
    content: mode === 'guide' ? '会从这篇攻略里移除，收藏副本不受影响' : '会从所有收藏夹移除，来源攻略不受影响',
    confirmText: '删除',
    confirmColor: '#EF4444'
  });
  if (ok) removeHere();
}
function removeHere() {
  const mode = state.mode;
  if (mode === 'guide') {
    if (state._gid && state._orig && state._orig.id) guides.removePoint(state._gid, state._orig.id);
  } else {
    const key = state._key || favorites.keyOf(state._orig);
    const nodeId = state._fid || (favorites.nodeIdsOf(key)[0] || '');
    if (nodeId) favorites.removePoint(nodeId, key);
    else favorites.removeItem(key);
  }
  close();
  ui.toast('已删除', 'none');
  if (state._onSaved) state._onSaved(state.mode, { removed: true });
}
function removeEverywhere() {
  removeHere();
  places.removeAll(state._placeKey);
  store.set('guide_refresh_token', { token: Date.now() });
  ui.toast('已全部删除', 'none');
  if (state._onSaved) state._onSaved(state.mode, { removed: true });
}

const pe = { open, close, state, removePhotoAt };
export default pe;
