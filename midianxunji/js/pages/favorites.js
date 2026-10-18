/**
 * pages/favorites.js —— 收藏页（网页版）
 *
 * 功能对齐小程序 favorites 页：
 *   · 点位收藏：收藏夹树（展开/折叠/眼睛）+ 点位行（眼睛/图标/分享/删除/详情）
 *   · 攻略收藏：收纳夹 + 攻略行（眼睛/分享/移出/名称独占进地图）
 *   · 搜索、新建/重命名/删除收藏夹、统一换图标（两套形状体系）
 *   · 跨夹移动/复制（网页版用 HTML5 拖放：行 → 文件夹卡片）
 *   · 同层排序（上移/下移，桌面端比长按拖拽更可靠）
 *   · 点位详情走共享组件 pointedit
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import guides from '../lib/guides.js';
import favorites from '../lib/favorites.js';
import follow from '../lib/follow.js';
import categories from '../lib/categories.js';
import favicon from '../lib/favicon.js';
import places from '../lib/places.js';
import share from '../lib/share.js';
import pe from '../components/pointedit.js';

const page = {
  data: {
    tab: 'point',
    folders: [],
    totalPoints: 0,
    onMapCount: 0,
    folderCount: 0,
    fvView: [],
    fvTotal: 0,
    searchVisible: false,
    searchKw: '',
    // 新建/改名
    nfVisible: false, nfMode: 'add', nfKind: 'folder', nfTargetId: '', nfName: '',
    // 文件夹/收纳夹弹层
    fsId: '', fsName: '',
    fvSheetId: '', fvSheetName: '',
    // 搬家
    cmVisible: false, cmMode: 'point',
    cmKey: '', cmGuideId: '', cmSrcFid: '', cmPointName: '', cmSrcName: '', cmTargetName: '',
    // 图标选择器
    ipVisible: false, ipTitle: '', ipIsGuide: false, ipMarker: '',
    ipShapes: [], ipShape: 'star', ipColorIdx: 0,
    ipTarget: null,
    // 拖拽提示
    dragging: false
  },

  onLoad() {
    this._opened = {};
    this._fvOpened = {};
    // 我的页统计格跳转：mine.goStat 写 fav_open_tab，落到对应子页（'guide' / 'point'）
    const pend = store.get('fav_open_tab');
    if (pend) { store.remove('fav_open_tab'); this.switchTab(pend); }
  },
  onShow() { this.loadAll(); },
  onHide() { this.setData({ cmVisible: false }, true); },

  /* ============ 数据加载 ============ */
  loadAll() { this.loadFavs(); this.loadFollow(); },

  loadFavs() {
    const tree = favorites.getTree();
    const kw = (this.data.searchKw || '').trim().toLowerCase();
    const hit = (s) => !kw || String(s || '').toLowerCase().indexOf(kw) >= 0;
    const opened = this._opened || {};
    const first = !Object.keys(opened).length;

    const folders = tree.map((n) => {
      const pts = (n.points || []).filter(p => !kw || hit(p.name) || hit(p.note) || hit(p.reason));
      if (first) opened[n.id] = true;
      return {
        id: n.id,
        name: n.name,
        count: (n.points || []).length,
        visibleCount: favorites.visibleCountOf(n.id),
        showOnMap: n.showOnMap !== false,
        isDefault: !!n.isDefault,
        open: !!opened[n.id],
        points: pts.map((p) => {
          const cat = categories.getCategory(p.category);
          const isCommon = !!(p.fromGuideId && follow.isFollowed(p.fromGuideId));
          const ic = favicon.display(p, { kind: 'point', isFav: true, isCommon });
          return Object.assign({}, p, {
            color: p.colorOverride || categories.PALETTE[cat.colorIdx],
            _catName: cat.name,
            _located: !!(p.latitude && p.longitude),
            _show: p.showOnMap !== false,
            _icon: ic.path,
            _key: p.id || p.key
          });
        })
      };
    }).filter(f => !kw || hit(f.name) || f.points.length);

    this._opened = opened;
    this.setData({
      folders,
      totalPoints: favorites.allPoints().length,
      onMapCount: favorites.onMapCount(),
      folderCount: favorites.getTree().length
    });
  },

  loadFollow() {
    const kw = (this.data.searchKw || '').trim().toLowerCase();
    const hit = (s) => !kw || String(s || '').toLowerCase().indexOf(kw) >= 0;
    const opened = this._fvOpened || {};
    const view = follow.getView().map((f) => {
      if (opened[f.id] === undefined) opened[f.id] = true;
      const gs = (f.guides || []).map(g => Object.assign({}, g, {
        _onMap: (guides.getById(g.id) || {}).showOnMap !== false
      }));
      return Object.assign({}, f, {
        open: opened[f.id] !== false,
        eyeOn: gs.some(g => g._onMap),
        guides: gs.filter(g => !kw || hit(g.name))
      });
    }).filter(f => !kw || hit(f.name) || f.guides.length);
    this._fvOpened = opened;
    this.setData({ fvView: view, fvTotal: follow.countGuides() });
  },

  /* ============ 子页 / 搜索 ============ */
  switchTab(tab) {
    if (tab === this.data.tab) return;
    this.setData({ tab });
  },
  toggleSearch() {
    const v = !this.data.searchVisible;
    this.setData({ searchVisible: v, searchKw: '' });
    this.loadAll();
  },
  onSearchInput(v) { this.setData({ searchKw: v }); this.loadAll(); },
  clearSearch() { this.setData({ searchKw: '' }); this.loadAll(); },

  /* ============ 点位收藏操作 ============ */
  toggleFolder(id) {
    const f = this.data.folders.find(x => x.id === id);
    if (!f) return;
    favorites.setFolderVisible(id, !f.showOnMap);
    this.loadFavs();
  },
  toggleOpen(id) {
    const opened = this._opened || {};
    opened[id] = !opened[id];
    this._opened = opened;
    this.loadFavs();
  },
  togglePoint(fid, key) {
    const f = this.data.folders.find(x => x.id === fid);
    const p = f && f.points.find(x => (x.id || x.key) === key);
    favorites.setPointVisible(fid, key, !(p && p.showOnMap !== false));
    this.loadFavs();
  },
  async removePointAt(fid, key) {
    const f = this.data.folders.find(x => x.id === fid);
    const p = f && f.points.find(x => (x.id || x.key) === key);
    const name = (p && p.name) || '这个点位';
    const pk = places.keyOf(p);
    const others = pk ? places.scan(pk, { nodeId: fid, key }) : null;
    if (others && others.total) {
      const idx = await ui.sheet(['只从「' + ((f && f.name) || '这个收藏夹') + '」删除',
        '全部删除（还在 ' + places.describe(others) + '）']);
      if (idx === 0) { favorites.removePoint(fid, key); ui.toast('已删除', 'none'); }
      else if (idx === 1) { favorites.removePoint(fid, key); places.removeAll(pk); ui.toast('已全部删除', 'none'); }
      this.loadFavs();
      return;
    }
    const ok = await ui.modal({
      title: '删除点位',
      content: '确定把「' + name + '」从「' + ((f && f.name) || '当前收藏夹') + '」里删除吗？',
      confirmText: '删除',
      confirmColor: '#DC2626'
    });
    if (!ok) return;
    favorites.removePoint(fid, key);
    this.loadFavs();
    ui.toast('已删除', 'none');
  },
  openPoint(fid, key) {
    const f = this.data.folders.find(x => x.id === fid);
    const p = f && f.points.find(x => (x.id || x.key) === key);
    if (!p) return;
    pe.open({
      mode: 'fav', point: p, key, fid,
      onSaved: () => this.loadFavs()
    });
  },
  openIconPicker(fid, key) {
    const f = this.data.folders.find(x => x.id === fid);
    const p = f && f.points.find(x => (x.id || x.key) === key);
    if (!p) return;
    const ic = favicon.of(p, 'point');
    this._openIp({
      ipTitle: '更换「' + (p.name || '点位') + '」的图标',
      ipShape: ic.shape, ipColorIdx: ic.colorIdx,
      ipTarget: { type: 'point', fid, key }
    });
  },
  openFolderIconPicker() {
    const id = this.data.fsId;
    const f = this.data.folders.find(x => x.id === id);
    if (!f) return;
    const first = (f.points || [])[0];
    const ic = first ? favicon.of(first, 'point') : favicon.DEFAULT_POINT;
    this.setData({ fsId: '' }, true);
    this._openIp({
      ipTitle: '统一更换「' + f.name + '」的图标',
      ipShape: ic.shape || 'star', ipColorIdx: (typeof ic.colorIdx === 'number') ? ic.colorIdx : 0,
      ipTarget: { type: 'folder', fid: id }
    });
  },
  onSharePack(kind, id, fid) {
    share.openPanel({ kind, id: id || '', fid: fid || '', key: id || '' });
  },

  /* ============ 攻略收藏操作 ============ */
  toggleFvEye(id) {
    const f = this.data.fvView.find(x => x.id === id);
    if (!f) return;
    const gs = f.guides || [];
    if (!gs.length) { ui.toast('这个收纳夹还没有攻略', 'none'); return; }
    const anyOn = gs.some(g => g._onMap);
    for (const g of gs) guides.setVisible(g.id, !anyOn);
    store.set('guide_refresh_token', { token: Date.now() });
    this.loadFollow();
    ui.toast(anyOn ? '已全部隐藏' : '已全部显示', 'none');
  },
  toggleFvOpen(id) {
    const opened = this._fvOpened || {};
    opened[id] = opened[id] === false ? true : false;
    this._fvOpened = opened;
    this.loadFollow();
  },
  toggleFgEye(gid) {
    const g = guides.getById(gid);
    if (!g) return;
    const next = g.showOnMap === false;
    guides.setVisible(gid, next);
    store.set('guide_refresh_token', { token: Date.now() });
    this.loadFollow();
    ui.toast(next ? '已在地图显示' : '已从地图隐藏', 'none');
  },
  openFollowGuide(gid) {
    if (!gid) return;
    const g = guides.getById(gid);
    if (!g) return;
    guides.setCurrent(gid);
    guides.setSoloVisible(gid);
    store.set('map_isolate_guide', { id: gid, name: g.name || '未命名攻略' });
    store.set('map_fit_guide', gid);
    store.set('map_layer_intent', 'guide');
    store.set('guide_refresh_token', { token: Date.now() });
    router.navigate('/map');
  },
  removeGuideRow(fid, gid) {
    follow.removeGuide(fid, gid);
    this.loadFollow();
    ui.toast('已移出', 'none');
  },

  /* ============ 收藏夹 / 收纳夹弹层 ============ */
  openFolderSheet(id) {
    const f = this.data.folders.find(x => x.id === id);
    if (!f) return;
    this.setData({ fsId: id, fsName: f.name });
  },
  closeFolderSheet() { this.setData({ fsId: '', fsName: '' }, true); },
  sheetRename() {
    const id = this.data.fsId;
    const f = this.data.folders.find(x => x.id === id);
    if (!f) return;
    this.setData({ fsId: '', nfVisible: true, nfMode: 'rename', nfKind: 'folder', nfTargetId: id, nfName: f.name }, true);
  },
  async sheetDelete() {
    const id = this.data.fsId;
    const f = this.data.folders.find(x => x.id === id);
    if (!f) return;
    this.setData({ fsId: '' }, true);
    const ok = await ui.modal({
      title: '删除「' + f.name + '」？',
      content: '这个收藏夹里 ' + f.count + ' 个点位会一并移除；从攻略复制来的副本删掉也不影响攻略本身。',
      confirmText: '删除',
      confirmColor: '#EF4444'
    });
    if (!ok) return;
    favorites.deleteFolder(id);
    this.loadFavs();
    ui.toast('已删除', 'none');
  },
  openFvSheet(id) {
    const f = this.data.fvView.find(x => x.id === id);
    if (!f) return;
    this.setData({ fvSheetId: id, fvSheetName: f.name });
  },
  closeFvSheet() { this.setData({ fvSheetId: '', fvSheetName: '' }, true); },
  fvRename() {
    const id = this.data.fvSheetId;
    const f = this.data.fvView.find(x => x.id === id);
    if (!f) return;
    this.setData({ fvSheetId: '', nfVisible: true, nfMode: 'rename', nfKind: 'follow', nfTargetId: id, nfName: f.name }, true);
  },
  async fvDelete() {
    const id = this.data.fvSheetId;
    const f = this.data.fvView.find(x => x.id === id);
    if (!f) return;
    this.setData({ fvSheetId: '' }, true);
    const ok = await ui.modal({
      title: '删除「' + f.name + '」？',
      content: '收纳夹删掉后，里面的攻略仍然保留在攻略页「最近」里。',
      confirmText: '删除',
      confirmColor: '#EF4444'
    });
    if (!ok) return;
    follow.deleteFolder(id);
    this.loadFollow();
    ui.toast('已删除', 'none');
  },
  openFvIconPicker() {
    const id = this.data.fvSheetId;
    const f = this.data.fvView.find(x => x.id === id);
    if (!f) return;
    const first = (f.guides || [])[0];
    const g = first ? guides.getById(first.id) : null;
    const fp = (g && (g.points || [])[0]) || null;
    const ic = favicon.guideIconOf(g, fp, categories.markerIcon(fp && fp.category));
    this.setData({ fvSheetId: '' }, true);
    this._openIp({
      ipTitle: '统一更换「' + f.name + '」的符号',
      ipShape: ic.shape, ipColorIdx: ic.colorIdx,
      ipTarget: { type: 'fvFolder', fid: id }
    });
  },

  /* ============ 新建 / 改名 ============ */
  addFolder() {
    const kind = this.data.tab === 'guide' ? 'follow' : 'folder';
    this.setData({ nfVisible: true, nfMode: 'add', nfKind: kind, nfTargetId: '', nfName: '' }, true);
  },
  closeNF() { this.setData({ nfVisible: false, nfName: '', nfTargetId: '' }, true); },
  onNfInput(v) { this.setData({ nfName: v }, true); },
  confirmNF() {
    const name = (this.data.nfName || '').trim().slice(0, 12);
    if (!name) { ui.toast('请输入名称', 'none'); return; }
    if (this.data.nfKind === 'follow') {
      if (this.data.nfMode === 'rename') follow.renameFolder(this.data.nfTargetId, name);
      else follow.createFolder(name);
    } else {
      if (this.data.nfMode === 'rename') favorites.renameFolder(this.data.nfTargetId, name);
      else favorites.createFolder(name);
    }
    this.closeNF();
    this.loadAll();
  },

  /* ============ 图标选择器 ============ */
  _openIp(patch) {
    const t = patch.ipTarget;
    const isGuide = t && t.type === 'fvFolder';
    this.setData(Object.assign({
      ipVisible: true,
      ipIsGuide: isGuide,
      ipMarker: isGuide ? 'images/marker/marker-' + patch.ipShape + '-' + favicon.markerColorIdx(patch.ipColorIdx) + '-big.png' : '',
      ipShapes: isGuide ? favicon.GUIDE_SHAPES : favicon.SHAPES
    }, patch));
  },
  pickIpShape(k) {
    const d = { ipShape: k };
    if (this.data.ipIsGuide) d.ipMarker = 'images/marker/marker-' + k + '-' + favicon.markerColorIdx(this.data.ipColorIdx) + '-big.png';
    this.setData(d);
  },
  pickIpColor(i) {
    const d = { ipColorIdx: Number(i) };
    if (this.data.ipIsGuide) d.ipMarker = 'images/marker/marker-' + this.data.ipShape + '-' + favicon.markerColorIdx(Number(i)) + '-big.png';
    this.setData(d);
  },
  closeIconPicker() { this.setData({ ipVisible: false, ipTarget: null }, true); },
  confirmIconPicker() {
    const t = this.data.ipTarget;
    const shape = this.data.ipShape;
    const colorIdx = this.data.ipColorIdx;
    if (!t) { this.closeIconPicker(); return; }
    let n = 0;
    if (t.type === 'point') {
      favorites.updateItem(t.key, { favShape: shape, favColorIdx: colorIdx });
      n = 1;
    } else if (t.type === 'folder') {
      const f = this.data.folders.find(x => x.id === t.fid);
      for (const p of ((f && f.points) || [])) {
        favorites.updateItem(p.id || p.key, { favShape: shape, favColorIdx: colorIdx });
        n += 1;
      }
    } else if (t.type === 'fvFolder') {
      const f = this.data.fvView.find(x => x.id === t.fid);
      for (const g of ((f && f.guides) || [])) {
        guides.update(g.id, { favShape: shape, favColorIdx: colorIdx });
        const full = guides.getById(g.id);
        for (const p of ((full && full.points) || [])) {
          if (p && favicon.isGuideShape(p.favShape)) {
            guides.updatePoint(g.id, p.id, { favShape: '', favColorIdx: colorIdx });
          }
        }
        n += 1;
      }
      store.set('guide_refresh_token', { token: Date.now() });
    }
    this.closeIconPicker();
    this.loadAll();
    ui.toast(t.type === 'fvFolder' ? ('已统一 ' + n + ' 篇攻略的图标') : ('已更新 ' + n + ' 个图标'), 'none');
  },

  /* ============ 拖放（行 → 收藏夹卡片）============ */
  onDragStart(kind, id, fromFid, name) {
    this._drag = { kind, id, fromFid, name };
    this.setData({ dragging: true }, true);
  },
  onDragEnd() {
    this._drag = null;
    this.setData({ dragging: false }, true);
  },
  onFolderDrop(fid, fname) {
    const d = this._drag;
    this.onDragEnd();
    if (!d || !fid) return;
    if (d.fromFid === fid) return;
    this._targetFid = fid;
    if (d.kind === 'point') {
      this.setData({
        cmVisible: true, cmMode: 'point',
        cmKey: d.id, cmSrcFid: d.fromFid, cmPointName: d.name,
        cmSrcName: (this.data.folders.find(f => f.id === d.fromFid) || {}).name || '原收藏夹',
        cmTargetName: fname
      });
    } else if (d.kind === 'guide') {
      this.setData({
        cmVisible: true, cmMode: 'guide',
        cmGuideId: d.id, cmSrcFid: d.fromFid, cmPointName: d.name,
        cmSrcName: (this.data.fvView.find(f => f.id === d.fromFid) || {}).name || '原收纳夹',
        cmTargetName: fname
      });
    }
  },
  closeCM() { this.setData({ cmVisible: false }, true); },
  confirmTransfer(mode) {
    const d = this.data;
    const target = this._targetFid || '';
    if (d.cmMode === 'point') {
      favorites.transferPoint(d.cmKey, d.cmSrcFid, target, mode);
    } else {
      follow.transferGuide(d.cmGuideId, d.cmSrcFid, target, mode);
    }
    this._targetFid = '';
    this.setData({ cmVisible: false });
    this.loadAll();
    ui.toast(mode === 'move' ? '已移动' : '已复制', 'success');
  },

  /* ============ 排序（上移/下移）============ */
  movePoint(fid, key, dir) {
    const f = this.data.folders.find(x => x.id === fid);
    if (!f) return;
    const keys = f.points.map(p => p.id || p.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    keys.splice(j, 0, keys.splice(i, 1)[0]);
    favorites.reorderPoints(fid, keys);
    this.loadFavs();
  },
  moveGuide(fid, gid, dir) {
    const f = this.data.fvView.find(x => x.id === fid);
    if (!f) return;
    const ids = (f.guides || []).map(g => g.id);
    const i = ids.indexOf(gid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    follow.reorderGuides(fid, ids);
    this.loadFollow();
  },
  moveFolder(fid, dir) {
    const siblings = this.data.folders.map(f => f.id);
    const i = siblings.indexOf(fid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    siblings.splice(j, 0, siblings.splice(i, 1)[0]);
    favorites.reorderFolders('', siblings);
    this.loadFavs();
  },
  moveFvFolder(fid, dir) {
    const ids = this.data.fvView.map(f => f.id);
    const i = ids.indexOf(fid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    follow.reorderFolders(ids);
    this.loadFollow();
  },

  /* ============ 渲染 ============ */
  render() {
    const d = this.data;
    const isPoint = d.tab === 'point';

    const folderCards = (d.folders || []).map((f, fi) => {
      const ptRows = (f.points || []).map((p, pi) =>
        '<div class="pt-row" draggable="true" data-drag="point" data-id="' + esc(p._key) + '" data-fid="' + esc(f.id) + '" data-name="' + esc(p.name) + '">' +
        '  <button class="pt-eye" data-act="toggle-point" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="上图/下图">' +
        '    <img src="' + (p._show ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>' +
        '  <div class="pt-main" data-act="open-point" data-arg="' + esc(f.id) + '|' + esc(p._key) + '">' +
        '    <div class="pt-name">' + esc(p.name) + '</div>' +
        (p.note ? '<div class="pt-sub">' + esc(p.note) + '</div>' : '') + '</div>' +
        '  <button class="pt-ico" data-act="open-icon" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="换图标">' +
        '    <img src="' + esc(p._icon) + '" alt=""></button>' +
        '  <button class="pt-act" data-act="share-point" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="分享">' +
        '    <img src="images/ui/share-dark.png" alt=""></button>' +
        '  <button class="pt-act" data-act="move-up-pt" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="上移" ' + (pi === 0 ? 'disabled' : '') + '>↑</button>' +
        '  <button class="pt-act" data-act="move-down-pt" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="下移" ' + (pi === f.points.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '  <button class="pt-act danger" data-act="del-point" data-arg="' + esc(f.id) + '|' + esc(p._key) + '" title="删除">' +
        '    <img src="images/ui/trash.png" alt=""></button>' +
        '</div>'
      ).join('');
      return (
        '<div class="folder-card" data-drop="' + esc(f.id) + '" data-name="' + esc(f.name) + '">' +
        '  <div class="folder-head">' +
        '    <button class="fh-eye" data-act="toggle-folder" data-arg="' + esc(f.id) + '" title="整夹上图/下图">' +
        '      <img src="' + (f.showOnMap ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>' +
        '    <div class="fh-left" data-act="toggle-open" data-arg="' + esc(f.id) + '">' +
        '      <div class="folder-name' + (f.isDefault ? ' default' : '') + '">' + esc(f.name) + '</div>' +
        '      <div class="folder-count">' + esc(f.count) + ' 个点位 · ' + esc(f.visibleCount) + ' 在图上</div></div>' +
        '    <button class="fh-more" data-act="open-folder-sheet" data-arg="' + esc(f.id) + '" title="收藏夹设置">⋯</button>' +
        '    <button class="fh-more" data-act="move-up-folder" data-arg="' + esc(f.id) + '" title="上移" ' + (fi === 0 ? 'disabled' : '') + '>↑</button>' +
        '    <button class="fh-more" data-act="move-down-folder" data-arg="' + esc(f.id) + '" title="下移" ' + (fi === d.folders.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '  </div>' +
        (f.open ? ptRows || '<div class="pt-empty">这个收藏夹还没有点位，从地图拖进来或点「＋」新建</div>' : '') +
        '</div>'
      );
    }).join('');

    const fvCards = (d.fvView || []).map((f, fi) => {
      const gRows = (f.guides || []).map((g, gi) =>
        '<div class="fg-row" draggable="true" data-drag="guide" data-id="' + esc(g.id) + '" data-fid="' + esc(f.id) + '" data-name="' + esc(g.name) + '">' +
        '  <button class="fg-eye" data-act="toggle-fg-eye" data-arg="' + esc(g.id) + '" title="上图/下图">' +
        '    <img src="' + (g._onMap ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>' +
        '  <div class="fg-main" data-act="open-follow-guide" data-arg="' + esc(g.id) + '">' +
        '    <div class="fg-name">' + esc(g.name) + '</div>' +
        '    <div class="fg-sub">' + esc(g.count) + ' 个点位 · 已定位 ' + esc(g.located) + '</div></div>' +
        '  <button class="fg-act" data-act="share-guide" data-arg="' + esc(g.id) + '" title="分享">' +
        '    <img src="images/ui/share-dark.png" alt=""></button>' +
        '  <button class="fg-act" data-act="move-up-fg" data-arg="' + esc(f.id) + '|' + esc(g.id) + '" title="上移" ' + (gi === 0 ? 'disabled' : '') + '>↑</button>' +
        '  <button class="fg-act" data-act="move-down-fg" data-arg="' + esc(f.id) + '|' + esc(g.id) + '" title="下移" ' + (gi === f.guides.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '  <button class="fg-act danger" data-act="del-guide" data-arg="' + esc(f.id) + '|' + esc(g.id) + '" title="移出">' +
        '    <img src="images/ui/trash.png" alt=""></button>' +
        '</div>'
      ).join('');
      return (
        '<div class="fv-card" data-drop="' + esc(f.id) + '" data-name="' + esc(f.name) + '">' +
        '  <div class="fv-head">' +
        '    <button class="fv-eye" data-act="toggle-fv-eye" data-arg="' + esc(f.id) + '" title="整夹上图/下图">' +
        '      <img src="' + (f.eyeOn ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>' +
        '    <div class="fv-main" data-act="toggle-fv-open" data-arg="' + esc(f.id) + '">' +
        '      <div class="fv-name">' + esc(f.name) + '</div>' +
        '      <div class="fv-sub">' + esc(f.guides.length) + ' 篇攻略</div></div>' +
        '    <button class="fv-more" data-act="open-fv-sheet" data-arg="' + esc(f.id) + '" title="收纳夹设置">⋯</button>' +
        '    <button class="fv-more" data-act="move-up-fvf" data-arg="' + esc(f.id) + '" title="上移" ' + (fi === 0 ? 'disabled' : '') + '>↑</button>' +
        '    <button class="fv-more" data-act="move-down-fvf" data-arg="' + esc(f.id) + '" title="下移" ' + (fi === d.fvView.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '  </div>' +
        (f.open ? gRows || '<div class="fg-empty">还没有攻略，去攻略页点五角星收藏</div>' : '') +
        '</div>'
      );
    }).join('');

    return (
      '<div class="fav-head">' +
      '  <div class="page-head-main">' +
      '    <div class="page-title">我的收藏</div>' +
      '    <div class="page-sub">' + (isPoint
        ? esc(d.totalPoints) + ' 个点位 · ' + esc(d.folderCount) + ' 个收藏夹 · ' + esc(d.onMapCount) + ' 在图上'
        : esc(d.fvTotal) + ' 篇攻略 · ' + esc(d.fvView.length) + ' 个收藏夹') + '</div>' +
      '  </div>' +
      '  <button class="head-btn" data-act="toggle-search">🔍 搜索</button>' +
      '</div>' +

      '<div class="seg">' +
      '  <button class="seg-item' + (!isPoint ? ' on' : '') + '" data-act="switch-tab" data-arg="guide">⭐ 攻略收藏</button>' +
      '  <button class="seg-item' + (isPoint ? ' on' : '') + '" data-act="switch-tab" data-arg="point">📍 点位收藏</button>' +
      '</div>' +

      (d.searchVisible ?
        '<div class="fav-search"><div class="fs-box">🔍' +
        '  <input class="fs-input" id="favSearch" placeholder="' + (isPoint ? '搜索点位收藏夹 / 点位名称 / 备注' : '搜索攻略收藏夹 / 攻略名称') + '" value="' + esc(d.searchKw) + '">' +
        (d.searchKw ? '<button class="fs-clear" data-act="clear-search">✕</button>' : '') +
        '</div></div>' : '') +

      (isPoint ?
        ('<div class="fav-tip">点眼睛决定要不要出现在地图上；拖动行可以扔进另一个收藏夹</div>' +
         (folderCards || '<div class="empty"><div class="empty-ic">📍</div><div class="empty-t">还没有点位收藏</div>' +
          '<div class="empty-s">在地图上点攻略点位，按「收藏」就能复制一份到这里，之后随便改名配图写备注</div>' +
          '<button class="btn btn-s" data-act="go-map">去地图看看</button></div>'))
        :
        ('<div class="fav-tip">收纳夹里放的是攻略的「快捷方式」，内容与攻略页「最近」共用一份，改哪边都同步</div>' +
         (fvCards || '<div class="empty"><div class="empty-ic">⭐</div><div class="empty-t">还没有收藏的攻略</div>' +
          '<div class="empty-s">在攻略页点卡片上的五角星「收藏」，就能把这篇攻略收进收纳夹</div>' +
          '<button class="btn btn-s" data-act="go-guides">去攻略页看看</button></div>'))) +

      '<button class="add-row" data-act="add-folder">＋ 新建收藏夹</button>' +
      '<div class="bottom-space"></div>' +

      /* 收藏夹设置弹层 */
      (d.fsId ?
        '<div class="ui-mask in" data-act="close-folder-sheet"></div>' +
        '<div class="ui-sheet in">' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.fsName) + '</div>' +
        '    <button class="sheet-close" data-act="close-folder-sheet">✕</button></div>' +
        '  <div class="sheet-rows">' +
        '    <button class="sheet-row" data-act="share-folder"><span class="sheet-row-ic">📤</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">分享这个收藏夹</span>' +
        '      <span class="sheet-row-sub">把夹里的点位打包成分享码</span></span></button>' +
        '    <button class="sheet-row" data-act="folder-icon"><span class="sheet-row-ic">🎨</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">统一更换图标</span>' +
        '      <span class="sheet-row-sub">夹内所有点位换成同一种形状和颜色</span></span></button>' +
        '    <button class="sheet-row" data-act="folder-rename"><span class="sheet-row-ic">✏️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">重命名</span></span></button>' +
        '    <button class="sheet-row danger" data-act="folder-delete"><span class="sheet-row-ic">🗑️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">删除收藏夹</span>' +
        '      <span class="sheet-row-sub">从攻略复制来的副本不影响攻略本身</span></span></button>' +
        '  </div><div class="bottom-space"></div>' +
        '</div>' : '') +

      /* 收纳夹设置弹层 */
      (d.fvSheetId ?
        '<div class="ui-mask in" data-act="close-fv-sheet"></div>' +
        '<div class="ui-sheet in">' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.fvSheetName) + '</div>' +
        '    <button class="sheet-close" data-act="close-fv-sheet">✕</button></div>' +
        '  <div class="sheet-rows">' +
        '    <button class="sheet-row" data-act="fv-icon"><span class="sheet-row-ic">🎨</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">统一更换图标</span>' +
        '      <span class="sheet-row-sub">夹内所有攻略换成同一种符号和颜色</span></span></button>' +
        '    <button class="sheet-row" data-act="fv-rename"><span class="sheet-row-ic">✏️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">重命名</span></span></button>' +
        '    <button class="sheet-row danger" data-act="fv-delete"><span class="sheet-row-ic">🗑️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">删除收纳夹</span>' +
        '      <span class="sheet-row-sub">里面的攻略仍保留在攻略页「最近」</span></span></button>' +
        '  </div><div class="bottom-space"></div>' +
        '</div>' : '') +

      /* 新建/改名 */
      (d.nfVisible ?
        '<div class="ui-mask in" data-act="close-nf"></div>' +
        '<div class="ui-sheet in nf-sheet"><div class="nf-body">' +
        '  <div class="nf-title">' + (d.nfMode === 'rename' ? '修改名称' : '新建收藏夹') + '</div>' +
        '  <input class="field-input" id="nfName" maxlength="12" placeholder="' + (d.nfKind === 'follow' ? '例如：五一川西' : '例如：成都美食清单') + '" value="' + esc(d.nfName) + '">' +
        '  <div class="nf-actions">' +
        '    <button class="btn btn-s line" data-act="close-nf">取消</button>' +
        '    <button class="btn btn-s" data-act="confirm-nf">确定</button>' +
        '  </div></div></div>' : '') +

      /* 搬家（移动/复制）*/
      (d.cmVisible ?
        '<div class="ui-mask in" data-act="close-cm"></div>' +
        '<div class="ui-sheet in cm-sheet">' +
        '  <div class="sheet-head"><div class="sheet-title">「' + esc(d.cmPointName) + '」放到「' + esc(d.cmTargetName) + '」</div></div>' +
        '  <div class="cm-body">' +
        '    <div class="cm-hint">从「' + esc(d.cmSrcName) + '」拖到了「' + esc(d.cmTargetName) + '」，要怎么处理？</div>' +
        '    <button class="cm-opt move" data-act="cm-move"><span class="cm-opt-ic">✂️</span>' +
        '      <span class="cm-opt-main"><span class="cm-opt-title">移动到此处</span>' +
        '      <span class="cm-opt-sub">' + (d.cmMode === 'guide' ? '原收纳夹里不再保留' : '原收藏夹里不再保留') + '</span></span></button>' +
        '    <button class="cm-opt copy" data-act="cm-copy"><span class="cm-opt-ic">📋</span>' +
        '      <span class="cm-opt-main"><span class="cm-opt-title">复制到此处</span>' +
        '      <span class="cm-opt-sub">' + (d.cmMode === 'guide' ? '两个收纳夹各留一份' : '两个收藏夹各留一份') + '</span></span></button>' +
        '    <button class="cm-cancel" data-act="close-cm">取消</button>' +
        '  </div></div>' : '') +

      /* 图标选择器 */
      (d.ipVisible ?
        '<div class="ui-mask in" data-act="close-ip"></div>' +
        '<div class="ui-sheet in ip-sheet">' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.ipTitle) + '</div>' +
        '    <button class="sheet-done" data-act="close-ip">完成</button></div>' +
        '  <div class="ip-scroll">' +
        '    <div class="ip-preview">' +
        (d.ipIsGuide ? '<img class="mk" src="' + esc(d.ipMarker) + '" alt="">' : '<img src="images/fav/fav-' + esc(d.ipShape) + '-' + esc(d.ipColorIdx) + '.png" alt="">') +
        '      <span>' + (d.ipIsGuide ? '先选符号，再选颜色（预览就是地图上的样子）' : '先选形状，再选颜色') + '</span></div>' +
        '    <div class="ip-shapes">' + (d.ipShapes || []).map(s =>
          '<button class="ip-shape' + (d.ipShape === s.key ? ' on' : '') + '" data-act="ip-shape" data-arg="' + esc(s.key) + '">' +
          (d.ipIsGuide
            ? '<img class="mk" src="images/marker/marker-' + esc(s.key) + '-' + esc(favicon.markerColorIdx(d.ipColorIdx)) + '-big.png" alt="">'
            : '<img src="images/fav/fav-' + esc(s.key) + '-' + esc(d.ipColorIdx) + '.png" alt="">') +
          '<span>' + esc(s.name) + '</span></button>').join('') + '</div>' +
        '    <div class="ip-colors">' + favicon.COLORS.map((c, i) =>
          '<button class="ip-color' + (d.ipColorIdx === i ? ' on' : '') + '" data-act="ip-color" data-arg="' + i + '" style="background:' + c + '"></button>').join('') + '</div>' +
        '    <div class="ip-actions">' +
        '      <button class="btn btn-s line" data-act="close-ip">取消</button>' +
        '      <button class="btn btn-s" data-act="confirm-ip">用这个图标</button>' +
        '    </div>' +
        '  </div></div>' : '')
    );
  },

  /* ============ 事件绑定 ============ */
  bind(root) {
    const s = root.querySelector('#favSearch');
    if (s) s.addEventListener('input', () => this.onSearchInput(s.value));
    const nf = root.querySelector('#nfName');
    if (nf) {
      nf.addEventListener('input', () => this.onNfInput(nf.value));
      nf.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmNF(); });
    }
    // 拖放：行 draggable → 文件夹卡片 dropzone
    root.querySelectorAll('[data-drag]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        const kind = row.getAttribute('data-drag');
        this.onDragStart(kind, row.getAttribute('data-id'), row.getAttribute('data-fid'), row.getAttribute('data-name'));
        try { e.dataTransfer.setData('text/plain', row.getAttribute('data-id')); } catch (err) { /* ignore */ }
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => this.onDragEnd());
    });
    root.querySelectorAll('[data-drop]').forEach((card) => {
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-on'); });
      card.addEventListener('dragleave', () => card.classList.remove('drop-on'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drop-on');
        this._targetFid = card.getAttribute('data-drop');
        this.onFolderDrop(card.getAttribute('data-drop'), card.getAttribute('data-name'));
      });
    });

    const arg2 = (fn) => (e, arg) => {
      const [a, b] = String(arg).split('|');
      fn.call(this, a, b);
    };
    this.on(root, 'switch-tab', (e, t) => this.switchTab(t));
    this.on(root, 'toggle-search', () => this.toggleSearch());
    this.on(root, 'clear-search', () => this.clearSearch());
    this.on(root, 'go-map', () => router.navigate('/map'));
    this.on(root, 'go-guides', () => router.navigate('/guides'));
    this.on(root, 'add-folder', () => this.addFolder());
    this.on(root, 'toggle-folder', (e, id) => this.toggleFolder(id));
    this.on(root, 'toggle-open', (e, id) => this.toggleOpen(id));
    this.on(root, 'toggle-point', arg2((fid, key) => this.togglePoint(fid, key)));
    this.on(root, 'open-point', arg2((fid, key) => this.openPoint(fid, key)));
    this.on(root, 'open-icon', arg2((fid, key) => this.openIconPicker(fid, key)));
    this.on(root, 'del-point', arg2((fid, key) => this.removePointAt(fid, key)));
    this.on(root, 'share-point', arg2((fid, key) => this.onSharePack('favPoint', key, fid)));
    this.on(root, 'move-up-pt', arg2((fid, key) => this.movePoint(fid, key, -1)));
    this.on(root, 'move-down-pt', arg2((fid, key) => this.movePoint(fid, key, 1)));
    this.on(root, 'move-up-folder', (e, id) => this.moveFolder(id, -1));
    this.on(root, 'move-down-folder', (e, id) => this.moveFolder(id, 1));
    this.on(root, 'open-folder-sheet', (e, id) => this.openFolderSheet(id));
    this.on(root, 'close-folder-sheet', () => this.closeFolderSheet());
    this.on(root, 'share-folder', () => this.onSharePack('favFolder', this.data.fsId));
    this.on(root, 'folder-icon', () => this.openFolderIconPicker());
    this.on(root, 'folder-rename', () => this.sheetRename());
    this.on(root, 'folder-delete', () => this.sheetDelete());
    this.on(root, 'toggle-fv-eye', (e, id) => this.toggleFvEye(id));
    this.on(root, 'toggle-fv-open', (e, id) => this.toggleFvOpen(id));
    this.on(root, 'toggle-fg-eye', (e, gid) => this.toggleFgEye(gid));
    this.on(root, 'open-follow-guide', (e, gid) => this.openFollowGuide(gid));
    this.on(root, 'share-guide', (e, gid) => this.onSharePack('guide', gid));
    this.on(root, 'del-guide', arg2((fid, gid) => this.removeGuideRow(fid, gid)));
    this.on(root, 'move-up-fg', arg2((fid, gid) => this.moveGuide(fid, gid, -1)));
    this.on(root, 'move-down-fg', arg2((fid, gid) => this.moveGuide(fid, gid, 1)));
    this.on(root, 'move-up-fvf', (e, id) => this.moveFvFolder(id, -1));
    this.on(root, 'move-down-fvf', (e, id) => this.moveFvFolder(id, 1));
    this.on(root, 'open-fv-sheet', (e, id) => this.openFvSheet(id));
    this.on(root, 'close-fv-sheet', () => this.closeFvSheet());
    this.on(root, 'fv-icon', () => this.openFvIconPicker());
    this.on(root, 'fv-rename', () => this.fvRename());
    this.on(root, 'fv-delete', () => this.fvDelete());
    this.on(root, 'close-nf', () => this.closeNF());
    this.on(root, 'confirm-nf', () => this.confirmNF());
    this.on(root, 'close-cm', () => this.closeCM());
    this.on(root, 'cm-move', () => this.confirmTransfer('move'));
    this.on(root, 'cm-copy', () => this.confirmTransfer('copy'));
    this.on(root, 'ip-shape', (e, k) => this.pickIpShape(k));
    this.on(root, 'ip-color', (e, i) => this.pickIpColor(i));
    this.on(root, 'close-ip', () => this.closeIconPicker());
    this.on(root, 'confirm-ip', () => this.confirmIconPicker());
  }
};

export default mixin(page);
