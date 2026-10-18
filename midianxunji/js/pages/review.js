/**
 * pages/review.js —— 点位复核 / 攻略编辑页（网页版）
 *
 * 功能对齐小程序 review 页（第六十六轮「点位收藏同款文件夹模型」）：
 *   · 攻略点位按文件夹分组（文件夹卡片 → 点位行，与收藏页同一结构）
 *   · 文件夹：眼睛（整夹上图）/ 折叠 / 上移下移排序 / 更多（加点位·换色·改名·删除）
 *   · 点位：眼睛（单点上图）/ 图标（符号+颜色）/ 定位（重新选点）/ 收藏星 / 删除 /
 *     上移下移（夹内排序）/ 拖拽到别的文件夹（跨夹移动）
 *   · 改动自动保存（防抖 300ms），无保存按钮
 *   · 攻略原文对照半屏；点位详情走 pointedit 组件
 *
 * 与小程序的关键差异：
 *   · 触摸长按拖拽引擎 → HTML5 draggable（桌面可靠）+ 上移/下移按钮（触摸友好）
 *   · wx.chooseLocation → mappicker.pickPointOnMap（腾讯地图点击选点 + 逆地理命名）
 *   · wx.showModal({editable}) 改名 → window.prompt
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import categories from '../lib/categories.js';
import favorites from '../lib/favorites.js';
import guides from '../lib/guides.js';
import favicon from '../lib/favicon.js';
import pe from '../components/pointedit.js';
import { pickPointOnMap } from '../mappicker.js';

const UNGROUPED = '__ungrouped__';
const STAR_GRAY = 'images/marker/star-gray-big.png';

const page = {
  data: {
    gid: '',
    points: [],
    folderMeta: [],
    folders: [],
    focusId: '',
    sourceTitle: '',
    sourceUrl: '',
    mapName: '',
    totalCount: 0,
    unlocatedCount: 0,
    // 文件夹操作弹层
    fsId: '',
    fsName: '',
    fsUngrouped: false,
    // 整体换色
    recolorVisible: false,
    recolorCi: 1,
    recolorMarkerCi: favicon.markerColorIdx(1),
    recolorFid: '',
    // 新建 / 改名
    nfVisible: false,
    nfName: '',
    nfMode: 'create',
    nfTargetId: '',
    // 图标选择器
    ipVisible: false,
    ipTitle: '',
    ipShape: 'mountain',
    ipColorIdx: 1,
    ipMarkerCi: favicon.markerColorIdx(1),
    ipGi: -1,
    shapes: favicon.GUIDE_SHAPES,
    colors: favicon.COLORS,
    // 攻略原文对照
    guideTextVisible: false,
    guideText: '',
    // 收藏提示 + 换夹
    favToastVisible: false,
    favToastName: '',
    favToastKey: '',
    favPickerVisible: false,
    favPickerRows: [],
    // 自动保存
    savedTip: false
  },

  onLoad(query) {
    const q = query || {};
    this._folderOpen = this._folderOpen || {};
    this._keepEmpty = this._keepEmpty || {};

    if (q.gid) {
      this._gid = q.gid;
      const g = guides.getById(q.gid);
      if (!g) { ui.toast('攻略不存在', 'none'); return; }
      // R66/R68：把现有 group 自动归并成文件夹，且必须在归并后重读
      guides.ensureFolders(q.gid);
      const g2 = guides.getById(q.gid) || g;
      this.setData({
        points: (g2.points || []).map((p, i) => this.decorate(p, i)),
        folderMeta: guides.getFolders(q.gid),
        sourceTitle: g2.sourceTitle || '',
        sourceUrl: g2.sourceUrl || '',
        mapName: g2.name || '未命名攻略'
      });
      this.sync();
      return;
    }

    // 无 gid：网页版解析入口都是「即建攻略即进地图」，不存在草稿态
    this.setData({ points: [], folders: [], totalCount: 0, unlocatedCount: 0 });
  },

  /* ===== 数据装配 ===== */

  mapIconOf(p, isFav, isCommon) {
    if (isFav) {
      const pid = (p && typeof p.id === 'string' && p.id.indexOf('gp_') === 0) ? p.id : '';
      const copy = pid ? favorites.getBySource(pid) : null;
      return favicon.display(copy || p || {}, {
        kind: 'point', isFav: true, isCommon: !!isCommon
      }).path;
    }
    const sym = p && p.favShape;
    if (sym && favicon.isGuideShape(sym)) {
      return favicon.display({ favShape: sym, favColorIdx: p.favColorIdx }, { kind: 'guide', isFav: false }).path;
    }
    return categories.markerIcon(p.category || categories.DEFAULT_CATEGORY);
  },

  decorate(p, i) {
    const pid = (p && typeof p.id === 'string' && p.id.indexOf('gp_') === 0) ? p.id : 'p_' + i;
    const cat = categories.getCategory(p.category || categories.DEFAULT_CATEGORY);
    const catColor = categories.PALETTE[cat.colorIdx] || categories.PALETTE[8];
    const rawSym = (p && favicon.isGuideShape(p.favShape)) ? p.favShape : '';
    const rawCi = (p && typeof p.favColorIdx === 'number') ? p.favColorIdx : null;
    const isFav = favorites.isStarred(pid) || favorites.isFav(favorites.keyOf(p));
    return {
      id: pid,
      name: p.name || '',
      folderId: p.folderId || '',
      category: cat.key,
      categoryName: cat.name,
      color: p.colorOverride || catColor,
      colorOverride: p.colorOverride || '',
      group: p.group || '',
      primary: p.primary !== false,
      reason: p.reason || '',
      quote: p.quote || '',
      imageUrls: p.imageUrls || [],
      latitude: p.latitude || null,
      longitude: p.longitude || null,
      located: !!(p.latitude && p.longitude),
      showOnMap: p.showOnMap !== false,
      icon: isFav
        ? favicon.display(favorites.getBySource(pid) || {}, { kind: 'point', isFav: true, isCommon: true }).path
        : favicon.display({ favShape: (favicon.isGuideShape(p.favShape) ? p.favShape : ''), favColorIdx: rawCi }, { kind: 'guide', isFav: false }).path,
      favShape: rawSym,
      favColorIdx: rawCi,
      starred: isFav,
      ptIcon: this.mapIconOf(p, isFav, isFav),
      _gi: 0
    };
  },

  /** 由扁平主数据构建「文件夹视图」 */
  buildFolders(points) {
    const meta = this.data.folderMeta || [];
    const sorted = meta.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const used = {};
    const list = [];
    for (const fm of sorted) {
      used[fm.id] = true;
      const fpts = points.filter(p => (p.folderId || '') === fm.id);
      if (!fpts.length && !(this._keepEmpty && this._keepEmpty[fm.id])) continue;
      list.push({
        id: fm.id, name: fm.name, order: fm.order || 0,
        open: this._folderOpen[fm.id] !== false,
        showOnMap: fm.showOnMap !== false,
        count: fpts.length,
        visibleCount: fpts.filter(p => p.showOnMap !== false).length,
        points: fpts.map(p => Object.assign({}, p)),
        isUngrouped: false
      });
    }
    const un = points.filter(p => !p.folderId || !used[p.folderId]);
    if (un.length) {
      const uOrder = (this._gid && (guides.getById(this._gid) || {}).ungroupedOrder);
      list.push({
        id: UNGROUPED, name: '未分组', order: (typeof uOrder === 'number' ? uOrder : 999),
        open: this._folderOpen[UNGROUPED] !== false, showOnMap: true,
        count: un.length, visibleCount: un.filter(p => p.showOnMap !== false).length,
        points: un.map(p => Object.assign({}, p)), isUngrouped: true
      });
    }
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    return list;
  },

  sync() {
    const points = this.data.points.map((p, i) => this.decorate(p, i));
    points.forEach((p, i) => { p._gi = i; });
    const folders = this.buildFolders(points);
    this.setData({
      points,
      folders,
      totalCount: points.length,
      unlocatedCount: points.filter(p => !p.located).length
    });
  },

  _refreshMeta() {
    this.setData({ folderMeta: guides.getFolders(this._gid) });
  },

  /** 改动自动落盘（防抖 300ms） */
  autoSave() {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this._autoSaveTimer = null;
      if (!this._gid) return;
      if (!this.data.points.length) return;
      this.commitPoints(true);
      this._flashSaved();
    }, 300);
  },

  _flashSaved() {
    if (this._flashTimer) return;
    this.setData({ savedTip: true });
    this._flashTimer = setTimeout(() => {
      this._flashTimer = null;
      this.setData({ savedTip: false });
    }, 1200);
  },

  /* ===== 顶部操作 ===== */

  renameGuide() {
    const name = window.prompt('重命名攻略', this.data.mapName || '');
    if (name == null) return;
    const n = String(name).trim().slice(0, 30);
    if (!n) return;
    this.setData({ mapName: n });
    this.autoSave();
  },

  /** 新增点位：去地图页长按加点（与小程序同口径） */
  addPoint() {
    ui.modal({
      title: '在地图上加点位',
      content: '当前改动会先保存，回到地图后长按地图任意位置即可新增点位（默认进入「未分组」）。',
      confirmText: '去地图',
      cancelText: '留这里'
    }).then((ok) => {
      if (!ok) return;
      this.commitPoints(true);
      if (this._gid) store.set('map_focus_gid', this._gid);
      ui.toast('长按地图即可添加', 'none');
      setTimeout(() => router.navigate('/map'), 400);
    });
  },

  /* ===== 文件夹：折叠 / 眼睛 / 弹层 / 新建 / 改名 / 删除 / 加点位 ===== */

  toggleOpen(id) {
    this._folderOpen[id] = this._folderOpen[id] === false ? true : false;
    this.sync();
  },

  toggleFolder(id) {
    if (id === UNGROUPED) return;
    const f = this.data.folderMeta.find(x => x.id === id);
    const show = f ? f.showOnMap === false : true;
    guides.setFolderVisible(this._gid, id, show);
    this._refreshMeta();
    this.sync();
    ui.toast(show ? '已显示该文件夹' : '已隐藏该文件夹', 'none');
  },

  togglePoint(id) {
    const p = this.data.points.find(x => x.id === id);
    if (!p) return;
    const show = p.showOnMap === false;
    guides.setPointVisibleInFolder(this._gid, id, show);
    this._refreshMeta();
    this.sync();
  },

  openFolderSheet(id) {
    if (id === UNGROUPED) { this.setData({ fsId: UNGROUPED, fsName: '未分组', fsUngrouped: true }); return; }
    const f = this.data.folderMeta.find(x => x.id === id);
    if (!f) return;
    this.setData({ fsId: id, fsName: f.name, fsUngrouped: false });
  },
  closeFolderSheet() { this.setData({ fsId: '', fsName: '', fsUngrouped: false }); },

  sheetRecolor() {
    const id = this.data.fsId;
    this.setData({
      recolorFid: id, fsId: '', fsName: '', fsUngrouped: false,
      recolorVisible: true, recolorCi: 1, recolorMarkerCi: favicon.markerColorIdx(1)
    });
  },
  closeRecolor() { this.setData({ recolorVisible: false, recolorFid: '' }); },
  pickRecolor(i) {
    const ci = Number(i);
    this.setData({ recolorCi: ci, recolorMarkerCi: favicon.markerColorIdx(ci) });
  },

  /**
   * R67 整体换色 + R81 修复（用户反馈「改了没反应」）：
   * 必须「合法符号 + 颜色」成对写，否则颜色被整条忽略（预览即所得：mountain 兜底）。
   */
  confirmRecolor() {
    const id = this.data.recolorFid;
    const fid = (id === UNGROUPED) ? '' : id;
    const ci = this.data.recolorCi;
    const points = this.data.points.map(p => {
      if ((p.folderId || '') !== fid) return p;
      const sym = favicon.isGuideShape(p.favShape) ? p.favShape : 'mountain';
      const np = Object.assign({}, p, { favShape: sym, favColorIdx: ci });
      if (np.starred) {
        const key = favorites.keyOf(np);
        if (key && favorites.nodeIdsOf(key).length) favorites.updateItem(key, { favColorIdx: ci });
      }
      return np;
    });
    this.setData({ points, recolorVisible: false, recolorFid: '' });
    this.sync();
    this.autoSave();
    store.set('guide_refresh_token', { token: Date.now() });
    ui.toast('已整体更换图标颜色', 'none');
  },

  sheetRename() {
    const id = this.data.fsId;
    this.setData({ fsId: '', fsName: '' });
    if (id === UNGROUPED) return;
    this.setData({ nfVisible: true, nfName: '', nfMode: 'rename', nfTargetId: id });
  },

  sheetDelete() {
    const id = this.data.fsId;
    const name = this.data.fsName;
    this.setData({ fsId: '', fsName: '' });
    if (id === UNGROUPED) return;
    ui.modal({
      title: '删除文件夹「' + name + '」？',
      content: '文件夹内的点位不会丢，会自动回到「未分组」。',
      confirmText: '删除',
      confirmColor: '#EF4444'
    }).then((ok) => {
      if (!ok) return;
      guides.deleteFolder(this._gid, id);
      this._refreshMeta();
      this.sync();
      this.autoSave();
      ui.toast('已删除文件夹', 'none');
    });
  },

  sheetAddPoint() {
    const id = this.data.fsId;
    this.setData({ fsId: '', fsName: '' });
    this.addPointToFolder(id);
  },

  openNF(mode, id) {
    this.setData({ nfVisible: true, nfName: '', nfMode: mode || 'create', nfTargetId: id || '' });
  },
  onNfInput(v) { this.setData({ nfName: v }); },
  closeNF() { this.setData({ nfVisible: false }); },

  confirmNF() {
    const name = (this.data.nfName || '').trim();
    if (!name) { ui.toast('名字不能为空', 'none'); return; }
    if (this.data.nfMode === 'rename') {
      if (this.data.nfTargetId && this.data.nfTargetId !== UNGROUPED) {
        guides.renameFolder(this._gid, this.data.nfTargetId, name);
      }
    } else {
      const node = guides.createFolder(this._gid, name);
      if (node) { this._keepEmpty = this._keepEmpty || {}; this._keepEmpty[node.id] = true; }
    }
    this._refreshMeta();
    this.closeNF();
    this.sync();
    ui.toast('已保存', 'none');
  },

  /** 在指定文件夹里加点位：直接在地图上选位置 */
  async addPointToFolder(fid) {
    const r = await pickPointOnMap(null, null, '选择要添加的位置');
    if (!r || r.latitude == null) return;
    const folderName = (this.data.folderMeta.find(f => f.id === fid) || {}).name || '';
    const np = guides.addPoint(this._gid, {
      name: r.name || '未命名点位',
      category: 'jingdian',
      latitude: r.latitude,
      longitude: r.longitude,
      located: true,
      folderId: fid,
      group: folderName,
      primary: true,
      showOnMap: true
    });
    const decorated = this.decorate(np, this.data.points.length);
    this.setData({ points: this.data.points.concat([decorated]) });
    this.sync();
    this.autoSave();
    ui.toast('已添加到「' + (folderName || '未分组') + '」', 'none');
  },

  /* ===== 点位图标：符号 + 颜色 ===== */

  openIconPicker(gi) {
    const point = this.data.points[Number(gi)];
    if (!point) return;
    const pair = favicon.of(point, 'guide');
    this.setData({
      ipVisible: true,
      ipTitle: '「' + (point.name || '点位') + '」的图标',
      ipShape: pair.shape,
      ipColorIdx: pair.colorIdx,
      ipMarkerCi: favicon.markerColorIdx(pair.colorIdx),
      ipGi: Number(gi)
    });
  },
  pickIpShape(k) { this.setData({ ipShape: k }); },
  pickIpColor(i) {
    const ci = Number(i);
    this.setData({ ipColorIdx: ci, ipMarkerCi: favicon.markerColorIdx(ci) });
  },
  closeIconPicker() { this.setData({ ipVisible: false, ipGi: -1 }); },

  confirmIconPicker() {
    const gi = this.data.ipGi;
    const shape = this.data.ipShape;
    const colorIdx = this.data.ipColorIdx;
    if (gi < 0 || !this.data.points[gi]) { this.closeIconPicker(); return; }
    const sym = favicon.isGuideShape(shape) ? shape : 'mountain';
    const point = this.data.points[gi];
    const ptIcon = this.mapIconOf(
      { category: point.category, favShape: sym, favColorIdx: colorIdx },
      !!point.starred,
      !!point.starred
    );
    const points = this.data.points.map((p, i) => (
      i === gi ? Object.assign({}, p, { favShape: sym, favColorIdx: colorIdx, icon: favicon.guidePath(sym, colorIdx), ptIcon }) : p
    ));
    this.setData({ points, ipVisible: false, ipGi: -1 });
    if (point && point.starred) {
      const key = favorites.keyOf(point);
      if (key && favorites.nodeIdsOf(key).length) {
        favorites.updateItem(key, { favColorIdx: colorIdx });
      }
    }
    this.sync();
    this.autoSave();
    store.set('guide_refresh_token', { token: Date.now() });
    ui.toast('已更新图标', 'none');
  },

  /* ===== 收藏星标 ===== */

  toggleFav(id) {
    const idx = this.data.points.findIndex(p => p.id === id);
    if (idx < 0) return;
    const point = this.data.points[idx];

    if (point.starred) {
      const n = favorites.removeBySourceAll(id);
      if (!n) {
        const key = favorites.keyOf(point);
        for (const fid of favorites.nodeIdsOf(key)) favorites.removePoint(fid, key);
      }
      this.hideFavToast();
      this.sync();
      this.autoSave();
      store.set('guide_refresh_token', { token: Date.now() });
      ui.toast('已取消收藏', 'none');
      return;
    }

    const def = favorites.ensureDefault();
    const favColorIdx = (typeof point.favColorIdx === 'number') ? point.favColorIdx : 0;
    const p = Object.assign({}, point, {
      favShape: favicon.isShape(point.favShape) ? point.favShape : 'star',
      favColorIdx
    });
    if (this._gid) favorites.starFromGuide(def.id, p, guides.getById(this._gid));
    else favorites.addItem(p, [def.id]);
    this.sync();
    this.autoSave();
    store.set('guide_refresh_token', { token: Date.now() });
    const key = favorites.keyOf(p);
    this.showFavToast(this._favFolderNames(key), key);
  },

  _favFolderNames(key) {
    if (!key) return [];
    const ids = favorites.nodeIdsOf(key) || [];
    const nodes = favorites.flatNodes();
    return ids.map((id) => {
      const n = nodes.find(x => x.id === id);
      return n ? n.name : '';
    }).filter(Boolean);
  },

  showFavToast(names, key) {
    const list = (names || []).filter(Boolean);
    this.setData({
      favToastVisible: true,
      favToastName: list.length ? list.join(' / ') : '我的点位',
      favToastKey: key || ''
    });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ favToastVisible: false }, true), 2600);
  },
  hideFavToast() {
    clearTimeout(this._toastTimer);
    this.setData({ favToastVisible: false }, true);
  },

  openFavFolderPicker() {
    const key = this.data.favToastKey;
    if (!key) return;
    clearTimeout(this._toastTimer);
    const inIds = favorites.nodeIdsOf(key) || [];
    const rows = favorites.getTree().map(n => ({
      id: n.id,
      name: n.name,
      count: (n.points || []).length,
      checked: inIds.indexOf(n.id) >= 0
    }));
    this.setData({ favToastVisible: false, favPickerVisible: true, favPickerRows: rows });
  },
  closeFavPicker() { this.setData({ favPickerVisible: false }); },

  toggleFavPickerRow(id) {
    const key = this.data.favToastKey || '';
    const row = this.data.favPickerRows.find(r => r.id === id);
    if (!row || !key) return;
    const rows = this.data.favPickerRows.map(r => (
      r.id === id ? Object.assign({}, r, { checked: !r.checked }) : r
    ));
    const ids = rows.filter(r => r.checked).map(r => r.id);
    if (!ids.length) { ui.toast('至少要留一个收藏夹', 'none'); return; }
    favorites.setNodesOf(key, ids);
    this.setData({
      favPickerRows: rows,
      favToastName: rows.filter(r => r.checked).map(r => r.name).join(' / ')
    });
    this.sync();
    this.autoSave();
    store.set('guide_refresh_token', { token: Date.now() });
  },

  /* ===== 删除点位 ===== */

  removePoint(id) {
    const point = this.data.points.find(p => p.id === id);
    if (!point) return;
    ui.modal({
      title: '删除点位',
      content: '「' + (point.name || '未命名') + '」将从这篇攻略里移除，撤销不了。',
      confirmText: '删除',
      confirmColor: '#EF4444'
    }).then((ok) => {
      if (!ok) return;
      const points = this.data.points.filter(p => p.id !== point.id);
      this.setData({ points });
      this.sync();
      this.commitPoints(true);
      ui.toast('已删除', 'none');
    });
  },

  /* ===== 定位（重新选点）===== */

  async onPointRelocate(id) {
    const point = this.data.points.find(p => p.id === id);
    if (!point) return;
    const r = await pickPointOnMap(point.latitude, point.longitude, '重新选择位置');
    if (!r || r.latitude == null) return;
    const idx = this.data.points.findIndex(p => p.id === id);
    if (idx < 0) return;
    const points = this.data.points.map((p, i) => {
      if (i !== idx) return p;
      return Object.assign({}, p, {
        latitude: r.latitude, longitude: r.longitude, located: true,
        name: (r.name && !p.name) ? r.name : p.name
      });
    });
    this.setData({ points });
    this.sync();
    this.autoSave();
    ui.toast('已定位「' + (r.name || point.name) + '」', 'none');
  },

  /* ===== 点位详情 ===== */

  openPointById(id) {
    const point = this.data.points.find(p => p.id === id);
    if (!point) return;
    pe.open({
      mode: 'guide',
      guideId: this._gid,
      point,
      onSaved: () => this.onPeSaved()
    });
  },

  onPeSaved() {
    if (!this._gid) return;
    const g = guides.getById(this._gid);
    if (!g) return;
    this._refreshMeta();
    this.setData({
      points: (g.points || []).map((p, i) => this.decorate(p, i)),
      mapName: g.name || this.data.mapName
    });
    this.sync();
    this._flashSaved();
  },

  /* ===== 排序（网页版：上移/下移按钮 + HTML5 拖拽跨夹）===== */

  moveFolder(fid, dir) {
    if (fid === UNGROUPED) return;
    const metas = (this.data.folderMeta || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const ids = metas.map(m => m.id);
    // 未分组用 ungroupedOrder 参与（guides.reorderFolders 已处理）
    const i = ids.indexOf(fid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const arr = ids.slice();
    arr.splice(i, 1);
    arr.splice(j, 0, fid);
    guides.reorderFolders(this._gid, arr);
    this._refreshMeta();
    this.sync();
    this.autoSave();
  },

  movePointInFolder(fid, pid, dir) {
    const folder = this.data.folders.find(f => f.id === fid);
    if (!folder) return;
    const ids = folder.points.map(p => p.id);
    const i = ids.indexOf(pid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const arr = ids.slice();
    arr.splice(i, 1);
    arr.splice(j, 0, pid);
    guides.reorderPoints(this._gid, (fid === UNGROUPED) ? '' : fid, arr);
    this._refreshMeta();
    this.sync();
    this.autoSave();
  },

  onDragStart(kind, id, fromFid, name) {
    this._drag = { kind, id, fromFid, name };
    document.body.classList.add('rv-dragging');
  },
  onDragEnd() {
    this._drag = null;
    document.body.classList.remove('rv-dragging');
  },

  /** 拖到某个文件夹上：弹「移动」确认（guide 点位只支持移动，不支持复制） */
  onFolderDrop(toFid, toName) {
    const d = this._drag;
    if (!d || d.kind !== 'point') return;
    if ((d.fromFid || '') === toFid) return;
    const fromName = (this.data.folders.find(f => f.id === d.fromFid) || {}).name || '未分组';
    ui.modal({
      title: '移动点位',
      content: '把「' + (d.name || '') + '」从「' + fromName + '」移到「' + toName + '」？',
      confirmText: '移动',
      confirmColor: '#12B76A'
    }).then((ok) => {
      if (!ok) return;
      guides.movePointToFolder(this._gid, d.id, (toFid === UNGROUPED) ? '' : toFid);
      this._refreshMeta();
      this.sync();
      this.autoSave();
      ui.toast('已移到「' + toName + '」', 'none');
    });
  },

  /* ===== 攻略原文对照 ===== */

  openGuideText() {
    let text = '';
    if (this._gid) {
      const g = guides.getById(this._gid);
      text = (g && g.rawText) ? g.rawText : '';
    }
    if (!text) {
      const lines = [];
      for (const p of (this.data.points || [])) {
        if (!p || !p.name) continue;
        let s = '· ' + p.name;
        if (p.reason) s += '：' + p.reason;
        else if (p.quote) s += '：「' + p.quote + '」';
        lines.push(s);
      }
      text = lines.join('\n');
    }
    this.setData({ guideTextVisible: true, guideText: text || '（这篇攻略没有原文）' });
  },
  closeGuideText() { this.setData({ guideTextVisible: false }); },

  /* ===== 保存 ===== */

  commitPoints(silent) {
    if (!this._gid) return false;
    if (!this.data.points.length) {
      if (!silent) ui.toast('请至少保留一个点位', 'none');
      return false;
    }
    const mapName = (this.data.mapName || '').trim() || '未命名攻略';
    guides.update(this._gid, { name: mapName });
    guides.saveLayout(this._gid, this.data.folderMeta, this.data.points);
    store.set('guide_refresh_token', { token: Date.now() });
    return true;
  },

  flushSave() {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = null;
    if (!this._gid) return;
    if (!this.data.points.length) return;
    this.commitPoints(true);
  },

  goBack() {
    router.back('/map');
  },

  onHide() {
    this._keepEmpty = {};
    this.hideFavToast();
    this.flushSave();
  },

  /* ===== 渲染 ===== */
  render() {
    const d = this.data;

    if (!d.points.length) {
      return (
        '<div class="empty">' +
        '  <div class="empty-icon">🗺️</div>' +
        '  <div class="empty-title">还没有可编辑的点位</div>' +
        '  <div class="empty-sub">先去首页解析一篇攻略，或者回到地图长按新增点位</div>' +
        '  <button class="btn" data-act="go-back">返回</button>' +
        '</div>'
      );
    }

    const folderCards = (d.folders || []).map((f, fi) => {
      const rows = (f.points || []).map((p) => {
        const starIcon = p.starred
          ? favicon.path('star', 0)
          : STAR_GRAY;
        const locIcon = p.located ? 'images/marker/pin-located.png' : 'images/ui/pin-relocate.png';
        return (
          '<div class="pt-row" draggable="true" data-drag="point" data-id="' + esc(p.id) + '" data-fid="' + esc(f.id) + '" data-name="' + esc(p.name) + '">' +
          '  <button class="pt-eye" data-act="toggle-point" data-arg="' + esc(p.id) + '" title="是否上图">' +
          '    <img src="' + (p.showOnMap ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>' +
          '  <div class="pt-main" data-act="open-point" data-arg="' + esc(p.id) + '">' +
          '    <div class="pt-name">' + esc(p.name) + '</div>' +
          (p.reason || p.quote ? '<div class="pt-sub">' + esc(p.reason || p.quote) + '</div>' : '') +
          '  </div>' +
          '  <div class="pt-acts">' +
          '    <button class="pt-ico" data-act="open-icon" data-arg="' + esc(p._gi) + '" title="图标">' +
          '      <img src="' + esc(p.ptIcon) + '" alt=""></button>' +
          '    <button class="pt-act ' + (p.located ? 'ok' : 'miss') + '" data-act="relocate" data-arg="' + esc(p.id) + '" title="定位">' +
          '      <img src="' + locIcon + '" alt=""></button>' +
          '    <button class="pt-act ' + (p.starred ? 'star-on' : '') + '" data-act="toggle-fav" data-arg="' + esc(p.id) + '" title="收藏">' +
          '      <img src="' + starIcon + '" alt=""></button>' +
          '    <button class="pt-act danger" data-act="remove-point" data-arg="' + esc(p.id) + '" title="删除">' +
          '      <img src="images/ui/trash.png" alt=""></button>' +
          '  </div>' +
          '  <div class="pt-sort">' +
          '    <button class="pt-act" data-act="move-point" data-arg="' + esc(f.id) + '|' + esc(p.id) + '|-1" title="上移">↑</button>' +
          '    <button class="pt-act" data-act="move-point" data-arg="' + esc(f.id) + '|' + esc(p.id) + '|1" title="下移">↓</button>' +
          '  </div>' +
          '</div>'
        );
      }).join('');
      const isUn = !!f.isUngrouped;
      return (
        '<div class="folder-card" data-drop="' + esc(f.id) + '" data-name="' + esc(f.name) + '">' +
        '  <div class="folder-head">' +
        (isUn ? '<span class="fh-eye fh-eye-none"></span>' :
          '<button class="fh-eye" data-act="toggle-folder" data-arg="' + esc(f.id) + '" title="整夹上图">' +
          '<img src="' + (f.showOnMap ? 'images/ui/eye-green.png' : 'images/ui/eye-off-dark.png') + '" alt=""></button>') +
        '    <div class="fh-left" data-act="toggle-open" data-arg="' + esc(f.id) + '">' +
        '      <div class="folder-info">' +
        '        <div class="folder-name' + (isUn ? ' muted' : '') + '">' + esc(f.name) + '</div>' +
        '        <div class="folder-count">' + esc(f.count) + ' 个点位 · ' + esc(f.visibleCount) + ' 在图上</div>' +
        '      </div>' +
        '    </div>' +
        '    <span class="fh-caret' + (f.open ? '' : ' closed') + '">▾</span>' +
        '    <button class="fh-more" data-act="folder-sheet" data-arg="' + esc(f.id) + '" title="更多">⋯</button>' +
        '  </div>' +
        (f.open ?
          '<div class="folder-body">' +
          (rows || '<div class="pt-empty">这个文件夹还没有点位</div>') +
          '</div>'
          : '') +
        '  <div class="folder-sort">' +
        '    <button class="pt-act" data-act="move-folder" data-arg="' + esc(f.id) + '|-1"' + (fi === 0 ? ' disabled' : '') + ' title="上移">↑</button>' +
        '    <button class="pt-act" data-act="move-folder" data-arg="' + esc(f.id) + '|1"' + (fi === d.folders.length - 1 ? ' disabled' : '') + ' title="下移">↓</button>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="page review-page">' +

      /* 顶部：攻略名（点击可改）*/
      '<div class="head-card">' +
      '  <div class="hc-main" data-act="rename-guide">' +
      '    <div class="hc-name">' + esc(d.mapName || '未命名攻略') + '</div>' +
      '    <span class="hc-edit">✎</span>' +
      '  </div>' +
      '  <div class="hc-sub">' +
      '    <span class="hc-num">' + esc(d.totalCount) + ' 个点位</span>' +
      '    <span class="hc-dot">·</span>' +
      '    <span class="hc-num ' + (d.unlocatedCount ? 'warn' : '') + '">未定位 ' + esc(d.unlocatedCount) + '</span>' +
      '  </div>' +
      '</div>' +

      /* 工具行 */
      '<div class="tool-row">' +
      '  <button class="tool-btn" data-act="guide-text"><img src="images/ui/doc-dark.png" alt=""><span>攻略对照</span></button>' +
      '  <button class="tool-btn primary" data-act="add-point"><img src="images/ui/plus-green.png" alt=""><span>新点位</span></button>' +
      '</div>' +

      '<div class="rv-tip">点眼睛决定点位是否上图；拖动点位行可移到别的文件夹，↑↓ 调整顺序</div>' +

      folderCards +

      /* 新建文件夹 */
      '<button class="add-row" data-act="open-nf" data-arg="create">' +
      '  <img src="images/ui/plus-green.png" alt=""><span>新建文件夹</span>' +
      '</button>' +

      '<div class="bottom-space"></div>' +

      /* 底部操作栏 */
      '<div class="footer">' +
      '  <div class="autosave-tip ' + (d.savedTip ? 'on' : '') + '">' +
      '    <span class="as-dot"></span><span>' + (d.savedTip ? '已自动保存' : '改动会自动保存') + '</span>' +
      '  </div>' +
      '  <button class="btn btn-primary gen-btn" data-act="go-back">返回地图</button>' +
      '</div>' +

      /* ===== 文件夹操作弹层 ===== */
      (d.fsId ?
        '<div class="ui-mask in" data-act="close-folder-sheet"></div>' +
        '<div class="ui-sheet in fs-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.fsName) + '</div>' +
        '    <button class="sheet-close" data-act="close-folder-sheet">✕</button></div>' +
        '  <div class="sheet-body">' +
        '    <button class="fs-row" data-act="sheet-add-point">' +
        '      <img src="images/ui/plus-green.png" alt="">' +
        '      <span class="fs-row-main"><span class="fs-row-title">往这个文件夹加点位</span>' +
        '      <span class="fs-row-sub">直接在地图上选位置，放进这个文件夹</span></span></button>' +
        '    <button class="fs-row" data-act="sheet-recolor">' +
        '      <img src="images/ui/edit-dark.png" alt="">' +
        '      <span class="fs-row-main"><span class="fs-row-title">整体更换图标颜色</span>' +
        '      <span class="fs-row-sub">本文件夹内所有点位换成同一个颜色</span></span></button>' +
        (!d.fsUngrouped ?
          '<button class="fs-row" data-act="sheet-rename">' +
          '  <img src="images/ui/rename-dark.png" alt="">' +
          '  <span class="fs-row-main"><span class="fs-row-title">重命名</span></span></button>' +
          '<button class="fs-row danger" data-act="sheet-delete">' +
          '  <img src="images/ui/trash.png" alt="">' +
          '  <span class="fs-row-main"><span class="fs-row-title">删除文件夹</span>' +
          '  <span class="fs-row-sub">只解散文件夹，点位会自动回到「未分组」</span></span></button>'
          : '') +
        '  </div>' +
        '  <div class="bottom-space"></div>' +
        '</div>'
        : '') +

      /* ===== 整体更换文件夹图标颜色 ===== */
      (d.recolorVisible ?
        '<div class="ui-mask in" data-act="close-recolor"></div>' +
        '<div class="ui-sheet in recolor-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">整体更换图标颜色</div>' +
        '    <button class="sheet-done" data-act="close-recolor">完成</button></div>' +
        '  <div class="recolor-preview">' +
        '    <img class="mk" src="images/marker/marker-' + esc(d.shapes[0].key) + '-' + esc(d.recolorMarkerCi) + '-big.png" alt="">' +
        '    <span>本文件夹内所有点位将统一为这个颜色</span>' +
        '  </div>' +
        '  <div class="ip-colors recolor-colors">' +
        (d.colors || []).map((c, i) =>
          '<button class="ip-color ' + (d.recolorCi === i ? 'on' : '') + '" data-act="pick-recolor" data-arg="' + i + '" style="background:' + c + ';"></button>').join('') +
        '  </div>' +
        '  <div class="recolor-actions">' +
        '    <button class="nf-cancel" data-act="close-recolor">取消</button>' +
        '    <button class="nf-confirm on" data-act="confirm-recolor">应用</button>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 新建 / 改名文件夹 ===== */
      (d.nfVisible ?
        '<div class="ui-mask in" data-act="close-nf"></div>' +
        '<div class="ui-sheet in nf-sheet">' +
        '  <div class="nf-body">' +
        '    <div class="nf-title">' + (d.nfMode === 'rename' ? '修改名称' : '新建文件夹') + '</div>' +
        '    <input class="nf-input" id="rvNfName" value="' + esc(d.nfName) + '" maxlength="12" placeholder="' +
        (d.nfMode === 'rename' ? '输入新的文件夹名' : '例如：第一天 · 成都') + '">' +
        '    <div class="nf-actions">' +
        '      <button class="nf-cancel" data-act="close-nf">取消</button>' +
        '      <button class="nf-confirm ' + (d.nfName ? 'on' : '') + '" data-act="confirm-nf">确定</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 符号 + 颜色选择器 ===== */
      (d.ipVisible ?
        '<div class="ui-mask in" data-act="close-icon"></div>' +
        '<div class="ui-sheet in ip-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.ipTitle) + '</div>' +
        '    <button class="sheet-done" data-act="close-icon">完成</button></div>' +
        '  <div class="ip-scroll">' +
        '    <div class="ip-preview">' +
        '      <img class="mk" src="images/marker/marker-' + esc(d.ipShape) + '-' + esc(d.ipMarkerCi) + '-big.png" alt="">' +
        '      <span>先选符号，再选颜色（地图上就是这个样子）</span>' +
        '    </div>' +
        '    <div class="ip-shapes eight">' +
        (d.shapes || []).map(s =>
          '<button class="ip-shape ' + (d.ipShape === s.key ? 'on' : '') + '" data-act="pick-shape" data-arg="' + esc(s.key) + '">' +
          '<img class="mk" src="images/marker/marker-' + esc(s.key) + '-' + esc(d.ipMarkerCi) + '-big.png" alt="">' +
          '<span>' + esc(s.name) + '</span></button>').join('') +
        '    </div>' +
        '    <div class="ip-colors">' +
        (d.colors || []).map((c, i) =>
          '<button class="ip-color ' + (d.ipColorIdx === i ? 'on' : '') + '" data-act="pick-color" data-arg="' + i + '" style="background:' + c + ';"></button>').join('') +
        '    </div>' +
        '    <div class="ip-actions">' +
        '      <button class="ip-btn" data-act="close-icon">取消</button>' +
        '      <button class="ip-btn primary" data-act="confirm-icon">用这个图标</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 收藏成功提示 ===== */
      (d.favToastVisible ?
        '<div class="rv-toast show">' +
        '  <div class="rvt-main">' +
        '    <div class="rvt-line2">' +
        '      <span class="rvt-text">已收藏到</span>' +
        '      <button class="rvt-name" data-act="open-fav-picker">点位收藏 · ' + esc(d.favToastName) + '</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 换收藏夹 ===== */
      (d.favPickerVisible ?
        '<div class="ui-mask in" data-act="close-fav-picker"></div>' +
        '<div class="ui-sheet in favpick-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">收藏到哪个夹</div>' +
        '    <button class="sheet-done" data-act="close-fav-picker">完成</button></div>' +
        '  <div class="favpick-scroll">' +
        (d.favPickerRows || []).map(r =>
          '<button class="favpick-row" data-act="toggle-fav-row" data-arg="' + esc(r.id) + '">' +
          '<span class="favpick-check ' + (r.checked ? 'on' : '') + '">' + (r.checked ? '✓' : '') + '</span>' +
          '<span class="favpick-name">' + esc(r.name) + '</span>' +
          '<span class="favpick-count">' + esc(r.count) + ' 个</span></button>').join('') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 攻略原文对照半屏 ===== */
      (d.guideTextVisible ?
        '<div class="gt-sheet show">' +
        '  <div class="gt-head">' +
        '    <div class="gt-title">' + esc(d.mapName || '攻略原文') + '</div>' +
        '    <button class="gt-close" data-act="close-guide-text">✕</button>' +
        '  </div>' +
        '  <div class="gt-scroll"><div class="gt-text">' + esc(d.guideText) + '</div></div>' +
        '</div>'
        : '') +

      '</div>'
    );
  },

  bind(root) {
    this.on(root, 'go-back', () => this.goBack());
    this.on(root, 'rename-guide', () => this.renameGuide());
    this.on(root, 'add-point', () => this.addPoint());
    this.on(root, 'guide-text', () => this.openGuideText());
    this.on(root, 'close-guide-text', () => this.closeGuideText());
    this.on(root, 'toggle-open', (e, id) => this.toggleOpen(id));
    this.on(root, 'toggle-folder', (e, id) => this.toggleFolder(id));
    this.on(root, 'toggle-point', (e, id) => this.togglePoint(id));
    this.on(root, 'folder-sheet', (e, id) => this.openFolderSheet(id));
    this.on(root, 'close-folder-sheet', () => this.closeFolderSheet());
    this.on(root, 'sheet-recolor', () => this.sheetRecolor());
    this.on(root, 'close-recolor', () => this.closeRecolor());
    this.on(root, 'pick-recolor', (e, i) => this.pickRecolor(i));
    this.on(root, 'confirm-recolor', () => this.confirmRecolor());
    this.on(root, 'sheet-rename', () => this.sheetRename());
    this.on(root, 'sheet-delete', () => this.sheetDelete());
    this.on(root, 'sheet-add-point', () => this.sheetAddPoint());
    this.on(root, 'open-nf', (e, mode) => this.openNF(mode, ''));
    this.on(root, 'close-nf', () => this.closeNF());
    this.on(root, 'confirm-nf', () => this.confirmNF());
    this.on(root, 'open-icon', (e, gi) => this.openIconPicker(gi));
    this.on(root, 'pick-shape', (e, k) => this.pickIpShape(k));
    this.on(root, 'pick-color', (e, i) => this.pickIpColor(i));
    this.on(root, 'close-icon', () => this.closeIconPicker());
    this.on(root, 'confirm-icon', () => this.confirmIconPicker());
    this.on(root, 'toggle-fav', (e, id) => this.toggleFav(id));
    this.on(root, 'open-fav-picker', () => this.openFavFolderPicker());
    this.on(root, 'close-fav-picker', () => this.closeFavPicker());
    this.on(root, 'toggle-fav-row', (e, id) => this.toggleFavPickerRow(id));
    this.on(root, 'remove-point', (e, id) => this.removePoint(id));
    this.on(root, 'relocate', (e, id) => this.onPointRelocate(id));
    this.on(root, 'open-point', (e, id) => this.openPointById(id));
    this.on(root, 'move-point', (e, arg) => {
      const [fid, pid, dir] = String(arg).split('|');
      this.movePointInFolder(fid, pid, Number(dir));
    });
    this.on(root, 'move-folder', (e, arg) => {
      const [fid, dir] = String(arg).split('|');
      this.moveFolder(fid, Number(dir));
    });

    // 新建夹名称输入（受控，不整页重渲染）
    const nf = root.querySelector('#rvNfName');
    if (nf) {
      nf.addEventListener('input', () => this.onNfInput(nf.value));
      nf.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmNF(); });
    }

    // HTML5 拖放：点位行 → 文件夹卡片（跨夹移动）
    root.querySelectorAll('[data-drag]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        this.onDragStart(row.getAttribute('data-drag'), row.getAttribute('data-id'), row.getAttribute('data-fid'), row.getAttribute('data-name'));
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
        this.onFolderDrop(card.getAttribute('data-drop'), card.getAttribute('data-name'));
      });
    });
  }
};

export default mixin(page);
