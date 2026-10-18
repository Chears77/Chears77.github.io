/**
 * pages/map.js —— 地图 Tab（网页版 · 腾讯地图 JS API GL）
 *
 * 功能对齐小程序 map 页（第十四轮～第八十五轮全部口径）：
 *   · 双图层：攻略层（所有 showOnMap 攻略）+ 点位收藏层，一键切三种模式
 *   · 「眼睛推导」：小眼睛 showOnMap 是唯一事实源（R43 定稿，R81 延续）
 *   · marker 三态：攻略点（圆+符号）/ 收藏点（纯形状）/ 共同点（圆环+收藏形状）
 *   · callout 文字一律常显，同坐标合并名字，重叠按格折叠（R26/R67）
 *   · 点位弹框：三态星 / 归属行 / 距我多远 / 详情 / 编辑 / 导航 / 分享
 *   · 长按空白新增点位（600ms）+ 逆地理命名 + 收藏提示换夹
 *   · 搜索面板（本地点位 + 腾讯关键词 + 历史）、攻略对照面板（改原文/重新标点位）
 *   · 未定位点位列表、图层选择面板、收藏夹/攻略可见性复选
 *
 * 与小程序的关键差异：
 *   · <map> 组件 → TMap.Map + MultiMarker（图标）+ MultiLabel（常显文字）
 *   · ★ R85 孤儿 callout 的结构性解法：每轮 rebuild 直接销毁并重建 marker/label
 *     两个图层实例 —— 「置空→重画」是物理事实，不存在增量合并留孤儿的可能
 *   · wx.chooseLocation → 自研搜索面板（qqmap.search + 本地点位）
 *   · wx.getLocation → navigator.geolocation（WGS-84，需转 GCJ-02）
 *   · 画布挂 #map-layer（fixed 层），页面重渲染不销毁地图实例
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import categories from '../lib/categories.js';
import geo from '../lib/geo.js';
import favorites from '../lib/favorites.js';
import guides from '../lib/guides.js';
import follow from '../lib/follow.js';
import favicon from '../lib/favicon.js';
import qqmap from '../lib/qqmap.js';
import regen from '../lib/regen.js';
import share from '../lib/share.js';
import pe from '../components/pointedit.js';

const DEFAULT_CENTER = { latitude: 30.5728, longitude: 104.0668 };
const MY_OFFSET = 10000;
const STORAGE_LAYERS = 'map_layers';
const STORAGE_HISTORY = 'find_history';
const STORAGE_LOCATE = 'map_locate_point';
const GROUP_COLORS = categories.PALETTE.slice();
const LONG_PRESS_MS = 600;
const LOCATE_SCALE = 15;

/* ===== WGS-84 → GCJ-02（火星坐标）转换 =====
 * HTML5 navigator.geolocation 规范定义返回 WGS-84；腾讯地图用 GCJ-02。
 * 国内直连场景（无 Google 服务）坐标源就是 WGS-84，必须转换，否则蓝点会偏几百米。 */
const GJ_A = 6378245.0, GJ_EE = 0.00669342162296594323;
function _outOfChina(lng, lat) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function _tLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return r;
}
function _tLng(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return r;
}
function wgs84ToGcj02(lng, lat) {
  if (_outOfChina(lng, lat)) return { longitude: lng, latitude: lat };
  let dLat = _tLat(lng - 105.0, lat - 35.0);
  let dLng = _tLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((GJ_A * (1 - GJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (GJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { longitude: lng + dLng, latitude: lat + dLat };
}

/** 蓝点图标（运行时画，避免新增图片资源；canvas 不可用时退回 SVG dataURL） */
function blueDotSrc() {
  try {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const x = c.getContext && c.getContext('2d');
    if (!x) throw new Error('no 2d context');
    x.beginPath(); x.arc(12, 12, 8, 0, Math.PI * 2);
    x.fillStyle = '#1E88E5'; x.fill();
    x.lineWidth = 2.5; x.strokeStyle = '#FFFFFF'; x.stroke();
    x.beginPath(); x.arc(12, 12, 3, 0, Math.PI * 2);
    x.fillStyle = '#FFFFFF'; x.fill();
    const url = c.toDataURL();
    if (url && url.length > 100) return url;
    throw new Error('empty dataURL');
  } catch (e) {
    // canvas 不可用（极端环境）：退回 SVG dataURL 蓝点，保证功能不瘸
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='8' fill='%231E88E5' stroke='%23FFFFFF' stroke-width='2.5'/%3E%3Ccircle cx='12' cy='12' r='3' fill='%23FFFFFF'/%3E%3C/svg%3E";
  }
}

/** 等 TMap 就绪（script 在 index.html 里同步加载，正常这里立即命中） */
function waitTMap(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (window.TMap) return resolve(window.TMap);
    const t0 = Date.now();
    const tick = () => {
      if (window.TMap) return resolve(window.TMap);
      if (Date.now() - t0 > timeout) return reject(new Error('地图组件加载超时'));
      setTimeout(tick, 120);
    };
    tick();
  });
}

const page = {
  data: {
    // 图层
    layerMode: 'both',
    guideLayerOn: true,
    favLayerOn: true,
    layerPanelVisible: false,
    favLayerPickerVisible: false,
    favLayerPickerRows: [],
    guideLayerPickerVisible: false,
    guideLayerRows: [],
    // 顶部信息
    soloGuideId: '',
    soloGuideName: '',
    isolatedGuideCount: 0,
    isolatedGuideLocated: 0,
    isolatedGuideMissing: 0,
    guideRowsOn: [],
    favFolderCount: 0,
    guideOnCount: 0,
    guideMissingCount: 0,
    currentGuideId: '',
    currentGuideName: '',
    guideCount: 0,
    // 折叠提示
    denseHidden: 0,
    zoomHint: '',
    hasMap: false,
    // 未定位
    missingCount: 0,
    missingPoints: [],
    showMissingList: false,
    // 点位弹框
    ptPopVisible: false,
    ptPop: {
      mode: 'guide', title: '', reason: '', key: '', lat: 0, lng: 0,
      starred: false, guided: false, starState: 'none',
      starIcon: 'images/marker/star-gray-big.png',
      owner: '', owners: [], starHint: '', distanceText: ''
    },
    // 收藏提示
    ptToastVisible: false,
    ptToastFade: false,
    ptToastKind: '点位收藏',
    ptToastIcon: '',
    ptToastPoint: '',
    ptToastName: '',
    ptToastSuffix: '',
    favPickerVisible: false,
    favPickerRows: [],
    favPickerPointId: '',
    favPickerKey: '',
    // 攻略对照面板
    guideSheetVisible: false,
    guideRows2: [],
    guideText: '',
    currentGuideName2: '',
    gsHeight: 380,
    gsBusy: false,
    gsEditVisible: false,
    gsEditText: '',
    // 搜索面板
    searchPanelVisible: false,
    searchKw: '',
    searchResults: [],
    searchHistory: [],
    searching: false,
    searchTip: '',
    searchOnline: false
  },

  /* ================= 生命周期 ================= */

  async onLoad() {
    // 图层偏好（兼容老存储 {guide,fav} → mode）
    const layers = store.get(STORAGE_LAYERS) || {};
    let layerMode = layers.mode;
    if (!layerMode) {
      const g = layers.guide !== false, f = layers.fav !== false;
      layerMode = g && f ? 'both' : (g ? 'guide' : (f ? 'fav' : 'guide'));
    }
    this.setData({
      layerMode,
      guideLayerOn: layerMode !== 'fav',
      favLayerOn: layerMode !== 'guide'
    });
    this._scaleVal = 12;
    this._lastFoldScale = 12;
    this._winH = window.innerHeight || 667;
    this._gsMin = 170;
    this._gsMax = Math.round(this._winH * 0.84);

    try { guides.migrateLegacy(); } catch (e) { /* ignore */ }
    this.rebuild();
    await this._initMap();
  },

  /** 建地图实例 + 两个图层（marker / label）+ 事件 */
  async _initMap() {
    const host = document.getElementById('map-layer');
    if (!host) return;
    let TMap;
    try { TMap = await waitTMap(); } catch (e) { ui.toast('地图组件加载失败，请刷新重试', 'none'); return; }
    this._TMap = TMap;
    host.innerHTML = '<div id="mapCanvas" style="width:100%;height:100%"></div>';
    const map = new TMap.Map(document.getElementById('mapCanvas'), {
      center: new TMap.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude),
      zoom: 12,
      viewMode: '2D'
    });
    this._map = map;

    // ---- marker 点击 ----
    if (this._markerLayer) {
      this._markerLayer.on('click', (ev) => {
        if (this._regionChanged) return;
        const gid = ev.geometry && ev.geometry.id;
        if (typeof gid !== 'string') return;
        this._onMarkerTap(gid);
      });
    }

    // ---- 地图点击：长按新增 vs 空白点击 ----
    map.on('click', (ev) => {
      if (this._longPressed) {
        this._longPressed = false;
        const la = ev.latLng.getLat(), ln = ev.latLng.getLng();
        this.markSelectedAndShow('', Number(la), Number(ln));
        return;
      }
      this._longPressed = false;
      this.onMapBlankTap();
    });

    // ---- 自定义长按（TMap 无原生 longpress）----
    const el = document.getElementById('mapCanvas');
    const pressStart = (cx, cy) => {
      this._pressX = cx; this._pressY = cy; this._pressMoved = false;
      clearTimeout(this._longPressTimer);
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        if (this._pressMoved) return;
        this._longPressed = true;               // 等随后的 click 事件落地
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
      }, LONG_PRESS_MS);
    };
    const pressMove = (cx, cy) => {
      if (this._pressX == null) return;
      if (Math.abs(cx - this._pressX) > 8 || Math.abs(cy - this._pressY) > 8) {
        this._pressMoved = true;
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
    };
    const pressEnd = () => {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    };
    el.addEventListener('mousedown', (e) => pressStart(e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => pressMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', pressEnd);
    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) pressStart(t.clientX, t.clientY); }, { passive: true });
    el.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) pressMove(t.clientX, t.clientY); }, { passive: true });
    el.addEventListener('touchend', pressEnd);

    // ---- 视野变化：记 scale / 手势结束重算折叠 ----
    map.on('zoom_changed', () => { this._syncScale(); });
    map.on('pan_changed', () => { this._syncScale(); });
    map.on('bounds_changed', () => { this._syncScale(); });
    map.on('idle', () => {
      this._syncScale();
      this._regionChanged = true;
      clearTimeout(this._regionTimer);
      this._regionTimer = setTimeout(() => { this._regionChanged = false; }, 320);
      const s = this._scaleVal || 12;
      if (s !== this._lastFoldScale) {
        clearTimeout(this._foldTimer);
        this._foldTimer = setTimeout(() => {
          this._foldTimer = null;
          this._lastFoldScale = s;
          if (this._built && (this.data.hasMap)) this.rebuild();
        }, 180);
      }
    });

    // 已授权过定位 → 静默取一次（不弹权限窗，原则同小程序）
    this._trySilentLocate();

    // onLoad 里 rebuild 早于本实例（_applyMarkers 当时直接 return，图层没落地），
    // 这里补一次让 MultiMarker/MultiLabel 真正建起来，fitAll 才有 _lastMarkers 可适配
    this.rebuild();
    this.fitAll();
  },

  _syncScale() {
    if (!this._map || !this._map.getZoom) return;
    try {
      const z = this._map.getZoom();
      if (typeof z === 'number' && z > 0) this._scaleVal = Math.round(z);
    } catch (e) { /* ignore */ }
  },

  onHide() {
    this._clearMapTimers();
    // 离开地图页：销毁实例，清画布（避免后台定时器空转）
    try {
      if (this._markerLayer) { this._markerLayer.setMap(null); this._markerLayer = null; }
      if (this._labelLayer) { this._labelLayer.setMap(null); this._labelLayer = null; }
      if (this._myDot) { this._myDot.setMap(null); this._myDot = null; }
      if (this._selLayer) { this._selLayer.setMap(null); this._selLayer = null; }
      if (this._map) { this._map.destroy(); this._map = null; }
      const host = document.getElementById('map-layer');
      if (host) host.innerHTML = '';
    } catch (e) { /* ignore */ }
    this.hidePtToast();
  },

  _clearMapTimers() {
    this.hidePtToast();
    clearTimeout(this._regionTimer);
    clearTimeout(this._foldTimer);
    clearTimeout(this._programMoveTimer);
    clearTimeout(this._longPressTimer);
    clearTimeout(this._regeoTimer);
    clearTimeout(this._searchTimer);
    clearTimeout(this._fitGuideTimer);
    clearTimeout(this._locateScaleTimer);
    this._regionTimer = this._foldTimer = this._programMoveTimer = null;
    this._longPressTimer = this._regeoTimer = this._searchTimer = null;
    this._fitGuideTimer = this._locateScaleTimer = null;
    this._myLocPending = false;
    this._myLocCbs = [];
    this._regionChanged = false;
    this._programMove = false;
    this._pressStart = 0;
    this._pressMoved = false;
  },

  /** 页面每次显示（从分享页/详情返回也走这里） */
  onShow() {
    if (!this._map) { this.rebuild(); return; }

    const isolate = store.get('map_isolate_guide');
    const fitGid = store.get('map_fit_guide');
    const focusGid = store.get('map_focus_gid');

    let focusApplied = false;
    if (focusGid) {
      store.remove('map_focus_gid');
      const reason = store.get('map_focus_reason') || '';
      store.remove('map_focus_reason');
      const g = guides.getById(focusGid);
      if (g) {
        guides.setCurrent(g.id);
        focusApplied = true;
        ui.toast(reason === 'share' ? ('已收到《' + g.name + '》') : '长按地图即可新增点位', 'none');
      }
    }
    const layerIntent = store.get('map_layer_intent');
    let layerIntentApplied = false;
    if (layerIntent) {
      store.remove('map_layer_intent');
      this.setData({
        layerMode: layerIntent,
        guideLayerOn: layerIntent !== 'fav',
        favLayerOn: layerIntent !== 'guide'
      });
      layerIntentApplied = true;
    }
    let isoApplied = false;
    if (isolate && isolate.id) {
      store.remove('map_isolate_guide');
      const g = guides.getById(isolate.id);
      if (g) {
        guides.setCurrent(g.id);
        this.setData({
          layerMode: 'guide', guideLayerOn: true, favLayerOn: false,
          activeKey: 'all', filterMode: 'all'
        });
        isoApplied = true;
      }
    }
    const guideTok = (store.get('guide_refresh_token') || {}).token || 0;
    const favTok = (store.get('fav_refresh_token') || {}).token || 0;

    let forceRebuild = isoApplied || layerIntentApplied || focusApplied;
    const locate = store.get(STORAGE_LOCATE);
    if (locate && locate.lat && locate.lng) {
      store.remove(STORAGE_LOCATE);
      forceRebuild = true;
      this.locatePoint(locate);
    }

    if (guideTok !== this._lastGuideTok || favTok !== this._lastFavTok || !this._built || forceRebuild) {
      this._lastGuideTok = guideTok;
      this._lastFavTok = favTok;
      this.rebuild();
    }

    const fitTargetGid = fitGid || (focusApplied ? focusGid : '');
    if (fitTargetGid) {
      if (fitGid) store.remove('map_fit_guide');
      clearTimeout(this._fitGuideTimer);
      this._fitGuideTimer = setTimeout(() => {
        this._fitGuideTimer = null;
        const fg = guides.getById(fitTargetGid);
        if (!fg || fg.showOnMap === false) return;
        if (!this.data.hasMap) return;
        this.fitAll(fitTargetGid);
      }, 320);
    }
  },

  /* ================= marker 重建 =================
   * ★ R85 孤儿 callout 的结构性解法：
   *   微信 <map> 按 marker.id 增量合并，删掉的 marker 其 ALWAYS callout 可能留在原生层。
   *   网页版每轮 rebuild 都**销毁并重建** MultiMarker / MultiLabel 两个实例 ——
   *   「置空→重画」是物理事实，从根上不存在增量合并留孤儿的可能。
   *   签名/序号闸门/_mapDirty 那套补漏在这里不再需要（没有增量合并这回事）。
   */
  rebuild() {
    const cur = guides.current();
    const currentGuideId = cur ? cur.id : '';
    const currentGuideName = cur ? cur.name : '';
    const allGuides = guides.getList();

    // ---- 收藏层 ----
    const favPts = this.data.favLayerOn ? favorites.visiblePoints() : [];
    const favBySource = {};
    const favByNear = {};
    for (const f of favPts) {
      if (f.fromGuideId && f.fromPointId) favBySource['g:' + f.fromGuideId + ':' + f.fromPointId] = f;
      favByNear['n:' + this.nearKey(f.name, f.latitude, f.longitude)] = f;
    }

    // ---- 攻略层：所有打开的攻略 ----
    const guideStack = [];
    const guideMarkers = [];
    const missing = [];
    const groupSet = [];
    const bothOn = this.data.guideLayerOn && this.data.favLayerOn;
    const visibleGuides = this.data.guideLayerOn
      ? allGuides.filter(g => g.showOnMap !== false)
      : [];

    const favConsumed = {};
    for (const g of visibleGuides) {
      (g.points || []).forEach((p) => {
        if (!p || !p.name) return;
        const grp = (p.group || '其他').trim();
        if (groupSet.indexOf(grp) < 0) groupSet.push(grp);
        if (!(p.latitude && p.longitude)) {
          missing.push({ gid: g.id, pid: p.id, name: p.name, guideName: g.name });
          return;
        }
        const favCopy = favBySource['g:' + g.id + ':' + p.id]
          || favByNear['n:' + this.nearKey(p.name, p.latitude, p.longitude)];
        const isCommon = !!(bothOn && favCopy);
        if (favCopy) favConsumed[favCopy.id || favCopy._key || ''] = true;

        guideStack.push({
          guideId: g.id, guideName: g.name, pointId: p.id, point: p,
          common: isCommon, favCopy: favCopy || null
        });
        guideMarkers.push({
          _gid: 'g' + (guideStack.length - 1),
          latitude: p.latitude,
          longitude: p.longitude,
          iconPath: isCommon
            ? favicon.mapPinPath(favCopy, true)
            : this._guideMarkerIcon(g, p),
          width: 26,
          height: 26
        });
      });
    }

    // ---- 收藏层 marker（攻略层已覆盖的跳过） ----
    const favStack = [];
    const favMarkers = [];
    for (const f of favPts) {
      if (!f.latitude || !f.longitude) continue;
      if (favConsumed[f.id || '']) continue;
      favStack.push(f);
      favMarkers.push({
        _gid: 'f' + (favStack.length - 1),
        latitude: f.latitude,
        longitude: f.longitude,
        iconPath: favicon.mapPinPath(f, false),
        width: 26,
        height: 26
      });
    }

    this._guideStack = guideStack;
    this._favStack = favStack;

    // ---- 同坐标合并名字 ----
    const markers = [];
    const coordSeen = {};
    for (const m of guideMarkers.concat(favMarkers)) {
      const k = (Math.round(m.latitude * 10000) / 10000) + ',' + (Math.round(m.longitude * 10000) / 10000);
      if (coordSeen[k] !== undefined) {
        const prev = markers[coordSeen[k]];
        const nm = this._markerName(m);
        if (nm) {
          prev._names = (prev._names || [this._markerName(prev)]).filter(Boolean);
          if (prev._names.indexOf(nm) < 0) prev._names.push(nm);
        }
        continue;
      }
      coordSeen[k] = markers.length;
      markers.push(m);
    }

    // ---- 重叠折叠（与缩放无关，只看同屏距离）----
    const OVERLAP_PX = 64;
    let denseHidden = 0;
    if (markers.length > 1) {
      const degPerPx = 0.000171 * Math.pow(2, 12 - (this._scaleVal || 12));
      const cell = OVERLAP_PX * degPerPx;
      const grid = {};
      const kept = [];
      for (const m of markers) {
        const gx = Math.round(m.latitude / cell);
        const gy = Math.round(m.longitude / cell);
        const gk = gx + '_' + gy;
        if (grid[gk]) {
          const prev = grid[gk];
          const nm = this._markerName(m);
          if (nm) {
            prev._names = (prev._names || [this._markerName(prev)]).filter(Boolean);
            if (prev._names.indexOf(nm) < 0) prev._names.push(nm);
          }
          denseHidden++;
          continue;
        }
        grid[gk] = m;
        kept.push(m);
      }
      markers.length = 0;
      markers.push.apply(markers, kept);
    }

    // ---- callout 文字一律常显；拥挤时只做非致命降级 ----
    const crowded = markers.length > 30;
    const labelGeoms = [];
    for (let mi = markers.length - 1; mi >= 0; mi--) {
      const m = markers[mi];
      const nm = (m._names && m._names.length)
        ? m._names.filter(Boolean).slice(0, 3).join(' / ')
        : this._markerName(m);
      if (!nm) { markers.splice(mi, 1); continue; }
      m._label = geo.truncate(nm, crowded ? 8 : 12);
      labelGeoms.push({ id: m._gid, content: m._label });
    }

    // ---- 选中落点（大图钉）----
    if (this.data.selPin && this.data.selPin.latitude) {
      markers.push({
        _gid: 'sel',
        latitude: this.data.selPin.latitude,
        longitude: this.data.selPin.longitude,
        iconPath: 'images/ui/pin-selected.png',
        width: 34,
        height: 34
      });
    }

    const groupColorMap = {};
    groupSet.forEach((g, i) => { groupColorMap[g] = GROUP_COLORS[i % GROUP_COLORS.length]; });
    this._groupColorMap = groupColorMap;

    const missingPoints = missing.map(m => {
      const cat = categories.getCategory('qita');
      return {
        gid: m.gid, pid: m.pid, name: m.name, guideName: m.guideName,
        color: categories.PALETTE[cat.colorIdx]
      };
    });

    const favFolderCount = favorites.getTree().length;
    const guideOnList = allGuides.filter(g => g.showOnMap !== false);

    this._built = true;
    const guideRowsOn = visibleGuides.map(g => ({ id: g.id, name: g.name || '未命名攻略' }));
    const soloGuide = (this.data.guideLayerOn && visibleGuides.length === 1) ? visibleGuides[0] : null;
    const isolatedGuideCount = soloGuide ? (soloGuide.points || []).length : 0;
    const isolatedGuideMissing = soloGuide
      ? (soloGuide.points || []).filter(p => !p.latitude || !p.longitude).length
      : 0;
    const isolatedGuideLocated = Math.max(0, isolatedGuideCount - isolatedGuideMissing);

    this.setData({
      hasMap: markers.length > 0,
      guideRowsOn,
      soloGuideId: soloGuide ? soloGuide.id : '',
      soloGuideName: soloGuide ? (soloGuide.name || '未命名攻略') : '',
      guideShown: guideMarkers.length,
      isolatedGuideCount,
      isolatedGuideLocated,
      isolatedGuideMissing,
      favShown: guideMarkers.filter((m, i) => guideStack[i].common).length + favMarkers.length,
      favFolderCount,
      guideOnCount: guideOnList.length,
      guideMissingCount: missing.length,
      currentGuideId, currentGuideName,
      guideCount: allGuides.length,
      missingCount: missing.length, missingPoints,
      denseHidden,
      zoomHint: denseHidden ? ('有 ' + denseHidden + ' 个点位重叠折叠了，放大即可分开') : ''
    });

    this._applyMarkers(markers, labelGeoms, crowded);
    if (this.data.guideSheetVisible && cur) this.refreshGuideSheet(cur);
  },

  /** 把 markers / labels 落到腾讯地图图层（销毁重建 = R85 结构性修复） */
  _applyMarkers(markers, labelGeoms, crowded) {
    if (!this._map || !this._TMap) return;
    const TMap = this._TMap;
    this._lastMarkers = markers;   // fitAll / _posOf 反查用
    const styles = {};
    const geoms = [];
    for (const m of markers) {
      const sk = m._gid + ':' + (m.iconPath || '');
      if (!styles[sk]) {
        styles[sk] = new TMap.MarkerStyle({
          width: m.width || 26,
          height: m.height || 26,
          src: m.iconPath,
          anchor: (m._gid === 'sel') ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }
        });
      }
      geoms.push({
        id: m._gid,
        styleId: sk,
        position: new TMap.LatLng(m.latitude, m.longitude)
      });
    }
    // 我的位置蓝点（常开，与小程序 showLocation 同语义）
    if (this._myLat != null && this._myLng != null) {
      if (!this._myDotSrc) this._myDotSrc = blueDotSrc();
      if (!styles.__my) styles.__my = new TMap.MarkerStyle({ width: 22, height: 22, src: this._myDotSrc });
      geoms.push({ id: 'my', styleId: '__my', position: new TMap.LatLng(this._myLat, this._myLng) });
    }

    // 销毁旧层 → 建新层（增量合并不存在，孤儿 callout 无从产生）
    try { if (this._markerLayer) this._markerLayer.setMap(null); } catch (e) { /* ignore */ }
    try { if (this._labelLayer) this._labelLayer.setMap(null); } catch (e) { /* ignore */ }

    if (geoms.length) {
      this._markerLayer = new TMap.MultiMarker({
        id: 'markers',
        map: this._map,
        styles,
        geometries: geoms
      });
      this._markerLayer.on('click', (ev) => {
        if (this._regionChanged) return;
        const gid = ev.geometry && ev.geometry.id;
        if (typeof gid !== 'string' || gid === 'my') return;
        this._onMarkerTap(gid);
      });
    } else {
      this._markerLayer = null;
    }

    if (labelGeoms.length) {
      this._labelLayer = new TMap.MultiLabel({
        id: 'labels',
        map: this._map,
        styles: {
          name: new TMap.LabelStyle({
            color: '#1F2937',
            size: crowded ? 10 : 12,
            backgroundColor: '#FFFFFF',
            borderColor: 'rgba(15,23,42,0.08)',
            borderRadius: 4,
            padding: 3,
            offsetX: 0,
            offsetY: 18
          })
        },
        geometries: labelGeoms.map(g => ({
          id: g.id,
          content: g.content,
          styleId: 'name',
          position: this._posOf(g.id)
        }))
      });
    } else {
      this._labelLayer = null;
    }
  },

  _posOf(gid) {
    for (const m of (this._lastMarkers || [])) {
      if (m._gid === gid) return new this._TMap.LatLng(m.latitude, m.longitude);
    }
    return new this._TMap.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude);
  },

  /** marker 点击 → 找到对应点位开弹框 */
  _onMarkerTap(gid) {
    if (gid === 'sel') return;
    if (gid[0] === 'f') {
      const f = (this._favStack || [])[Number(gid.slice(1))];
      if (f) { this.focusPoint(f); this.openFavPop(f); }
      return;
    }
    const item = (this._guideStack || [])[Number(gid.slice(1))];
    if (!item) return;
    this.focusIfOutside(item.point);
    this.openGuidePop(item);
  },

  nearKey(name, lat, lng) {
    const la = typeof lat === 'number' ? Math.round(lat * 1000) : '';
    const lo = typeof lng === 'number' ? Math.round(lng * 1000) : '';
    return String(name || '').trim().toLowerCase() + '|' + la + '|' + lo;
  },

  /** 占位名称清洗（R48 唯一出口：落库 / 展示 / 回填都走它） */
  _cleanName(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const PH = ['正在识别位置', '附近位置', '新点位', '未命名', '识别中', '未知位置'];
    for (const p of PH) { if (s.indexOf(p) >= 0) return ''; }
    if (/^[\d.\-,\s]+$/.test(s)) return '';
    if (s.replace(/\s/g, '').length < 2) return '';
    return s;
  },

  _guideMarkerIcon(g, p) {
    return favicon.guideIconOf(g, p, categories.markerIcon(p && p.category)).marker;
  },

  _markerName(m) {
    if (!m) return '';
    const gid = m._gid || '';
    if (gid[0] === 'g') {
      const s = this._guideStack && this._guideStack[Number(gid.slice(1))];
      return this._cleanName((s && s.point && s.point.name) || (s && s.guideName) || '');
    }
    if (gid[0] === 'f') {
      const f = this._favStack && this._favStack[Number(gid.slice(1))];
      return this._cleanName((f && f.name) || '');
    }
    return '';
  },

  /* ================= 图层 ================= */
  openLayerPanel() {
    this.setData({ layerPanelVisible: true, ptPopVisible: false, searchPanelVisible: false });
  },
  closeLayerPanel() { this.setData({ layerPanelVisible: false }); },

  /** 进入「只看这一篇」：只写眼睛 + 切图层（R43：眼睛是唯一事实源） */
  enterIsolate(id) {
    if (!id) return;
    guides.setSoloVisible(id);
    guides.setCurrent(id);
    this.setData({
      layerMode: 'guide',
      guideLayerOn: true,
      favLayerOn: false,
      activeKey: 'all',
      filterMode: 'all'
    }, () => this.rebuild());
  },

  /** 选图层模式：纯开关，绝不碰小眼睛、绝不动视野 */
  pickLayerMode(mode) {
    if (!mode) return;
    if (mode === this.data.layerMode) { this.rebuild(); return; }
    this.setData({
      layerMode: mode,
      guideLayerOn: mode !== 'fav',
      favLayerOn: mode !== 'guide'
    }, () => {
      store.set(STORAGE_LAYERS, { mode });
      this.rebuild();
    });
  },

  toggleFavLayer() {
    const favLayerOn = !this.data.favLayerOn;
    const mode = favLayerOn ? (this.data.guideLayerOn ? 'both' : 'fav') : 'guide';
    this.setData({ favLayerOn, layerMode: mode }, () => {
      store.set(STORAGE_LAYERS, { mode });
      this.rebuild();
    });
  },

  toggleGuideLayer() {
    const guideLayerOn = !this.data.guideLayerOn;
    const mode = guideLayerOn ? (this.data.favLayerOn ? 'both' : 'guide') : 'fav';
    this.setData({ guideLayerOn, layerMode: mode }, () => {
      store.set(STORAGE_LAYERS, { mode });
      this.rebuild();
    });
  },

  openGuideLayerPickerFromPanel() {
    this.setData({ layerPanelVisible: false });
    this.openGuideLayerPicker();
  },
  openFavLayerPickerFromPanel() {
    this.setData({ layerPanelVisible: false });
    this.openFavLayerPicker();
  },

  /** 把视野框到点位集合上（传 gid 只框那篇攻略） */
  fitAll(gid) {
    if (!this._map) return;
    let pts;
    if (gid) {
      pts = (this._guideStack || [])
        .filter(s => s.guideId === gid)
        .map(s => s.point)
        .filter(p => p && p.latitude && p.longitude)
        .map(p => ({ latitude: p.latitude, longitude: p.longitude }));
      if (!pts.length) {
        const g = guides.getById(gid);
        if (g && g.routeCenter && g.routeCenter.latitude && g.routeCenter.longitude) {
          this._programMove = true;
          clearTimeout(this._programMoveTimer);
          this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 1200);
          this._map.setCenter(new this._TMap.LatLng(g.routeCenter.latitude, g.routeCenter.longitude));
          this._map.setZoom(6);
          return;
        }
      }
    } else {
      pts = (this._lastMarkers || [])
        .filter(m => m.latitude && m.longitude && m._gid !== 'my')
        .map(m => ({ latitude: m.latitude, longitude: m.longitude }));
    }
    if (!pts.length) return;
    this._programMove = true;
    clearTimeout(this._programMoveTimer);
    this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 1200);
    try {
      if (pts.length === 1) {
        this._map.setCenter(new this._TMap.LatLng(pts[0].latitude, pts[0].longitude));
        this._map.setZoom(15);
      } else {
        let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
        for (const p of pts) {
          if (p.latitude < minLa) minLa = p.latitude;
          if (p.latitude > maxLa) maxLa = p.latitude;
          if (p.longitude < minLo) minLo = p.longitude;
          if (p.longitude > maxLo) maxLo = p.longitude;
        }
        const bounds = new this._TMap.LatLngBounds(
          new this._TMap.LatLng(minLa, minLo),
          new this._TMap.LatLng(maxLa, maxLo)
        );
        this._map.fitBounds(bounds, { padding: 70 });
      }
      setTimeout(() => this._syncScale(), 600);
    } catch (e) { /* ignore */ }
  },

  /* ================= 收藏夹 / 攻略可见性复选 ================= */
  openFavLayerPicker() {
    const rows = favorites.getTree().map(n => ({
      id: n.id,
      name: n.name,
      count: (n.points || []).length,
      checked: n.showOnMap !== false
    }));
    this.setData({ favLayerPickerVisible: true, favLayerPickerRows: rows, ptPopVisible: false });
  },
  closeFavLayerPicker() { this.setData({ favLayerPickerVisible: false }); },
  toggleFavLayerRow(id) {
    const row = this.data.favLayerPickerRows.find(r => r.id === id);
    if (!row) return;
    favorites.setFolderVisible(id, !row.checked);
    const rows = this.data.favLayerPickerRows.map(r => (
      r.id === id ? Object.assign({}, r, { checked: !r.checked }) : r
    ));
    this.setData({ favLayerPickerRows: rows });
    this.rebuild();
  },

  openGuideLayerPicker() {
    const rows = guides.getList().map(g => ({
      id: g.id,
      name: g.name || '未命名攻略',
      count: (g.points || []).length,
      located: (g.points || []).filter(p => p.latitude && p.longitude).length,
      on: g.showOnMap !== false
    }));
    this.setData({ guideLayerPickerVisible: true, guideLayerRows: rows, ptPopVisible: false });
  },
  closeGuideLayerPicker() { this.setData({ guideLayerPickerVisible: false }); },
  toggleGuideLayerRow(id) {
    const row = this.data.guideLayerRows.find(r => r.id === id);
    if (!row) return;
    guides.setVisible(id, !row.on);
    const rows = this.data.guideLayerRows.map(r => (
      r.id === id ? Object.assign({}, r, { on: !r.on }) : r
    ));
    this.setData({ guideLayerRows: rows });
    this.rebuild();
  },

  /* ================= 点位交互 ================= */
  focusIfOutside(p) {
    if (!p || !p.latitude || !p.longitude || !this._map) return;
    const c = this._map.getCenter();
    if (!c) return;
    const dLat = Math.abs(c.getLat() - p.latitude);
    const dLng = Math.abs(c.getLng() - p.longitude);
    const span = Math.max(0.02, 0.6 / Math.pow(2, (this._scaleVal || 12) - 12));
    if (dLat > span || dLng > span) {
      this._programMove = true;
      clearTimeout(this._programMoveTimer);
      this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 900);
      this._map.setCenter(new this._TMap.LatLng(p.latitude, p.longitude));
    }
  },

  focusPoint(p) {
    if (p && p.latitude && p.longitude && this._map) {
      this._programMove = true;
      clearTimeout(this._programMoveTimer);
      this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 900);
      this._map.setCenter(new this._TMap.LatLng(p.latitude, p.longitude));
    }
  },

  buildOwners(followNames, folderNames) {
    const owners = [];
    const strip = (s) => String(s == null ? '' : s).trim()
      .replace(/^[《【\[]+/, '').replace(/[》】\]]+$/, '').trim();
    const fl = (followNames || []).map(strip).filter(Boolean);
    const fd = (folderNames || []).map(strip).filter(Boolean);
    // R46/R48：攻略归属只到收纳夹；点位归属只到收藏夹名（都不再拼攻略名）
    if (fl.length) {
      owners.push({ type: 'guide', name: fl[0], label: '攻略收藏·' + fl.join(' / ') });
    }
    if (fd.length) {
      owners.push({ type: 'fav', name: fd[0], label: '点位收藏·' + fd.join(' / ') });
    }
    return owners;
  },

  buildPop(d) {
    const o = d || {};
    const mode = o.mode || 'new';
    const faved = !!o.starred;
    const guided = !!o.guided;
    let starState = 'none';
    if (faved && guided) starState = 'both';
    else if (faved) starState = 'point';
    else if (guided) starState = 'guide';
    const starRec = o.starRec || null;
    const starIcon = this._starButtonIcon(faved, guided, starRec);
    return {
      mode,
      guideId: o.guideId || '',
      pointId: o.pointId || '',
      favKey: o.favKey || '',
      favNodeId: o.favNodeId || '',
      title: o.title || '未命名',
      reason: o.reason || '',
      lat: o.lat || 0,
      lng: o.lng || 0,
      owner: o.owner || '',
      owners: o.owners || [],
      starred: faved,
      guided,
      starState,
      starIcon,
      favShape: (starRec && starRec.favShape) || '',
      favColorIdx: starRec ? starRec.favColorIdx : undefined,
      guideName: o.guideName || '',
      recognizing: !!o.recognizing,
      starHint: o.starHint || (faved ? '已收进点位收藏，点击移出' : ''),
      newStarKey: '',
      distanceText: this._distanceTextOf(o.lat, o.lng)
    };
  },

  _distanceTextOf(lat, lng) {
    const myLat = this._myLat, myLng = this._myLng;
    if (myLat == null || myLng == null) return '';
    if (!lat || !lng) return '';
    let m = 0;
    try { m = geo.distanceMeters(myLat, myLng, Number(lat), Number(lng)); } catch (e) { return ''; }
    if (!isFinite(m)) return '';
    if (m < 50) return '就在附近';
    return '约 ' + geo.formatDistance(m);
  },

  _starButtonIcon(faved, guided, rec) {
    const state = faved ? (guided ? 'both' : 'point') : (guided ? 'guide' : 'none');
    return favicon.display(rec || {}, { kind: 'point', state }).path;
  },

  showPop(d, keepSel) {
    this.setData({
      ptPopVisible: true,
      selPin: keepSel ? this.data.selPin : null,
      searchPanelVisible: false,
      guideSheetVisible: false,
      ptPop: this.buildPop(d)
    });
    this._ensureMyLocation(() => {
      if (!this.data.ptPopVisible) return;
      const txt = this._distanceTextOf(this.data.ptPop.lat, this.data.ptPop.lng);
      if (txt) this.setData({ 'ptPop.distanceText': txt });
    });
  },

  _ensureMyLocation(cb) {
    const done = () => { if (typeof cb === 'function') cb(); };
    if (this._myLat != null && this._myLng != null) { done(); return; }
    if (this._myLocPending) { this._myLocCbs.push(cb); return; }
    this._myLocPending = true;
    this._myLocCbs = [cb];
    const finish = (ok) => {
      this._myLocPending = false;
      const cbs = this._myLocCbs || [];
      this._myLocCbs = [];
      if (ok) {
        cbs.forEach(fn => { if (typeof fn === 'function') fn(); });
        this.rebuild();   // 蓝点上图
      }
    };
    if (!navigator.geolocation) { finish(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude);
        this._myLat = c.latitude;
        this._myLng = c.longitude;
        finish(true);
      },
      () => finish(false),
      { timeout: 8000, maximumAge: 60000 }
    );
  },

  /** 已授权过定位 → 静默取一次（不弹权限窗） */
  _trySilentLocate() {
    if (!navigator.permissions || !navigator.permissions.query) {
      // 不支持 Permissions API：不主动要（保持「权限只在定位按钮处要」原则）
      return;
    }
    try {
      navigator.permissions.query({ name: 'geolocation' }).then((st) => {
        if (st.state === 'granted') this._ensureMyLocation(() => {});
      }).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  },

  favFolderNamesOf(pointId) {
    const ids = favorites.nodeIdsOfSource(pointId);
    if (!ids.length) return [];
    return favorites.getTree().filter(n => ids.indexOf(n.id) >= 0).map(n => n.name);
  },

  openGuidePop(item) {
    const p = item.point;
    const starred = favorites.isStarred(item.pointId);
    const guideNames = [item.guideName];
    if (p.id) {
      for (const g of guides.getList()) {
        if (g.id === item.guideId) continue;
        if ((g.points || []).some(x => x.id === p.id)) guideNames.push(g.name || '未命名攻略');
      }
    }
    const folderNames = this.favFolderNamesOf(item.pointId);
    const followNames = follow.folderObjsOfGuide(item.guideId).map(f => f.name);
    const guided = followNames.length > 0 || this._guideFollowed(item.guideId);
    const starRec = starred ? (favorites.getBySource(item.pointId) || null) : null;
    this.showPop({
      mode: 'guide',
      guideId: item.guideId,
      pointId: item.pointId,
      title: p.name || '未命名',
      reason: p.reason || p.quote || '',
      lat: p.latitude || 0,
      lng: p.longitude || 0,
      owners: this.buildOwners(followNames, folderNames),
      guided,
      starred,
      starRec,
      guideName: item.guideName || '',
      followNames
    });
  },

  _guideFollowed(guideId) {
    if (!guideId) return false;
    try { return follow.isFollowed(guideId); } catch (e) { return false; }
  },

  openFavPop(f) {
    const folderNames = [];
    const ids = favorites.nodeIdsOf(f.id || '');
    for (const n of favorites.getTree()) {
      if (ids.indexOf(n.id) >= 0) folderNames.push(n.name);
    }
    const guideNames = [];
    if (f.fromGuideId) {
      const fg = guides.getById(f.fromGuideId);
      if (fg) guideNames.push(fg.name || '未命名攻略');
    }
    if (f.fromPointId) {
      for (const g of guides.getList()) {
        if (g.id === f.fromGuideId) continue;
        if ((g.points || []).some(x => x.id === f.fromPointId)) guideNames.push(g.name || '未命名攻略');
      }
    }
    this.showPop({
      mode: 'fav',
      title: f.name || '未命名',
      reason: f.note || f.reason || '',
      lat: f.latitude || 0,
      lng: f.longitude || 0,
      owners: this.buildOwners([], folderNames),
      favKey: f.id || '',
      favNodeId: f._nodeId || '',
      guided: !!(f.fromGuideId && this._guideFollowed(f.fromGuideId)),
      starred: true,
      starRec: f,
      favFolder: folderNames[0] || ''
    });
  },

  closePtPop() {
    this.setData({ ptPopVisible: false, selPin: null }, () => this.rebuild());
  },

  /** 右上角三态星：收藏 / 取消收藏 */
  onPopStar() {
    const pop = this.data.ptPop;
    if (!pop) return;
    if (pop.mode === 'guide') {
      const item = (this._guideStack || []).find(x => x.guideId === pop.guideId && x.pointId === pop.pointId);
      const guide = guides.getById(pop.guideId);
      const gName = this._cleanName(item && item.point && item.point.name) || this._cleanName(pop.title);
      const point = item
        ? Object.assign({}, item.point, { name: gName })
        : { name: gName, latitude: pop.lat, longitude: pop.lng };
      if (!point.latitude) { ui.toast('这个点还没有坐标', 'none'); return; }
      if (favorites.isStarred(pop.pointId)) {
        favorites.removeBySourceAll(pop.pointId);
        this._refreshPopStar(false);
        this.hidePtToast();
        ui.toast('已取消收藏', 'none');
      } else {
        const def = favorites.ensureDefault();
        favorites.starFromGuide(def.id, point, guide);
        this._lastStarCtx = {
          point, guide, pointId: pop.pointId,
          guideId: pop.guideId, guideName: item ? item.guideName : (guide && guide.name) || ''
        };
        this._refreshPopStar(true);
        const rec = favorites.getBySource(pop.pointId) || point;
        const ic = favicon.display(rec, { kind: 'point', isFav: true });
        this.showPtToast(def.name, pop.pointId, {
          icon: ic.path,
          fromGuideName: (item && item.guideName) || (guide && guide.name) || ''
        });
      }
      this.rebuild();
      return;
    }
    if (pop.mode === 'fav') {
      const f = (this._favStack || []).find(x => (x.id || '') === (pop.favKey || ''));
      const nodeId = pop.favNodeId || (f && f._nodeId) || '';
      if (!nodeId) { ui.toast('找不到所属收藏夹', 'none'); return; }
      favorites.removePoint(nodeId, pop.favKey);
      this.setData({ ptPopVisible: false, selPin: null }, () => this.rebuild());
      ui.toast('已取消收藏', 'none');
      return;
    }
    // new：快速收藏到默认夹（R46：再点一次按 key 取消）
    if (pop.starred) {
      const key = pop.newStarKey || favorites.pKey({
        name: this._cleanName(pop.title), latitude: pop.lat, longitude: pop.lng
      });
      const nodeIds = favorites.nodeIdsOf(key);
      if (nodeIds.length) {
        nodeIds.forEach((nid) => favorites.removePoint(nid, key));
        this._refreshPopAfterNewStar(null, pop);
        this.hidePtToast();
        this.rebuild();
        ui.toast('已取消收藏', 'none');
        return;
      }
    }
    const def = favorites.ensureDefault();
    const savedName = this._cleanName(pop.title);
    const added = favorites.addItem({
      name: savedName,
      category: 'qita',
      reason: pop.reason || '',
      latitude: pop.lat,
      longitude: pop.lng,
      poiName: savedName
    }, [def.id]);
    this._refreshPopAfterNewStar(def, pop);
    this.rebuild();
    const ic = favicon.display({}, { kind: 'point', isFav: true });
    this.showPtToast(def.name, '', { icon: ic.path, newStarKey: pop.newStarKey });
    if (!added.length) ui.toast('已在收藏夹中', 'none');
  },

  _refreshPopStar(faved) {
    const pop = this.data.ptPop;
    if (!pop) return;
    const guided = !!pop.guided;
    const rec = faved
      ? (favorites.getBySource(pop.pointId) || { favShape: pop.favShape, favColorIdx: pop.favColorIdx })
      : null;
    const starIcon = favicon.display(rec || {}, {
      kind: 'point',
      state: faved ? (guided ? 'both' : 'point') : (guided ? 'guide' : 'none')
    }).path;
    let owners = pop.owners || [];
    if (faved) {
      const names = this.favFolderNamesOf(pop.pointId);
      const label = '点位收藏·' + (names.length ? names.join(' / ') : '我的点位');
      const has = owners.some(o => o.type === 'fav');
      owners = has ? owners.map(o => (o.type === 'fav' ? Object.assign({}, o, { label }) : o))
        : owners.concat([{ type: 'fav', name: names[0] || '我的点位', label }]);
    } else {
      owners = owners.filter(o => o.type !== 'fav');
    }
    this.setData({
      'ptPop.starred': faved,
      'ptPop.starState': faved ? (guided ? 'both' : 'point') : (guided ? 'guide' : 'none'),
      'ptPop.starIcon': starIcon,
      'ptPop.starHint': '',
      'ptPop.owners': owners,
      'ptPop.favShape': rec ? rec.favShape : '',
      'ptPop.favColorIdx': rec ? rec.favColorIdx : undefined
    });
  },

  _refreshPopAfterNewStar(def, pop) {
    const collected = !!def;
    const starIcon = collected
      ? favicon.display({}, { kind: 'point', isFav: true }).path
      : favicon.display({}, { kind: 'point', state: 'none' }).path;
    let owners = (pop.owners || []);
    if (collected) {
      const label = '点位收藏·' + (def.name || '我的点位');
      owners = owners.filter(o => o.type !== 'fav')
        .concat([{ type: 'fav', name: def.name, label }]);
    } else {
      owners = owners.filter(o => o.type !== 'fav');
    }
    const newStarKey = collected
      ? favorites.pKey({ name: this._cleanName(pop.title), latitude: pop.lat, longitude: pop.lng })
      : '';
    this.setData({
      'ptPop.starred': collected,
      'ptPop.starState': collected ? (pop.guided ? 'both' : 'point') : (pop.guided ? 'guide' : 'none'),
      'ptPop.starIcon': starIcon,
      'ptPop.starHint': '',
      'ptPop.owners': owners,
      'ptPop.newStarKey': newStarKey
    });
  },

  /* ===== 收藏成功底部提示（R63 统一节拍：停留 2.6s + 淡出）===== */
  showPtToast(folderName, pointId, opt) {
    const o = opt || {};
    const isGuide = o.kind === 'guide';
    this.setData({
      ptToastVisible: true,
      ptToastFade: false,
      ptToastKind: isGuide ? '攻略收藏' : '点位收藏',
      ptToastIcon: o.icon || favicon.STAR_LINE_GRAY,
      ptToastPoint: '',
      ptToastName: folderName || (isGuide ? '攻略夹' : '我的点位'),
      ptToastSuffix: isGuide ? '点此可换攻略夹' : '',
      favPickerPointId: pointId || '',
      favPickerKey: o.newStarKey || ''
    });
    clearTimeout(this._ptToastTimer);
    this._ptToastTimer = setTimeout(() => this.setData({ ptToastFade: true }, true), 2600);
    this._ptToastTimer2 = setTimeout(() => this.setData({ ptToastVisible: false }, true), 2860);
  },
  hidePtToast() {
    clearTimeout(this._ptToastTimer);
    clearTimeout(this._ptToastTimer2);
    this.setData({ ptToastVisible: false, ptToastFade: false }, true);
  },

  openPtFolderPicker() {
    const pid = this.data.favPickerPointId;
    const key = this.data.favPickerKey || '';
    if (!pid && !key) return;
    this.hidePtToast();
    const ctx = this._lastStarCtx || {};
    const rows = favorites.getTree().map(n => ({
      id: n.id,
      name: n.name,
      count: (n.points || []).length,
      checked: (pid ? favorites.nodeIdsOfSource(pid) : favorites.nodeIdsOf(key)).indexOf(n.id) >= 0
    }));
    this.setData({ ptToastVisible: false, favPickerVisible: true, favPickerRows: rows });
    this._ptPickCtx = ctx;
  },
  closeFavPicker() { this.setData({ favPickerVisible: false }); },
  toggleFavPickerRow(id) {
    const pid = this.data.favPickerPointId;
    const key = this.data.favPickerKey || '';
    const ctx = this._ptPickCtx || {};
    const row = this.data.favPickerRows.find(r => r.id === id);
    if (!row || (!pid && !key)) return;
    if (pid) {
      if (row.checked) {
        favorites.removeBySource(id, pid);
      } else {
        favorites.starFromGuide(id, ctx.point || { name: this.data.ptPop.title, latitude: this.data.ptPop.lat, longitude: this.data.ptPop.lng }, ctx.guide);
      }
    } else if (row.checked) {
      favorites.removePoint(id, key);
    } else {
      favorites.addPoint(id, {
        name: this.data.ptPop.title,
        category: 'qita',
        reason: this.data.ptPop.reason || '',
        latitude: this.data.ptPop.lat,
        longitude: this.data.ptPop.lng,
        poiName: this.data.ptPop.title
      });
    }
    const rows = this.data.favPickerRows.map(r => (
      r.id === id ? Object.assign({}, r, { checked: !r.checked }) : r
    ));
    this.setData({ favPickerRows: rows });
    this.rebuild();
  },

  /** 「详情」：打开统一点位详情弹窗 */
  onPopDetail() {
    const pop = this.data.ptPop;
    if (!pop) return;
    if (pop.mode === 'guide') {
      const item = (this._guideStack || []).find(x => x.guideId === pop.guideId && x.pointId === pop.pointId);
      const dName = this._cleanName(item && item.point && item.point.name) || this._cleanName(pop.title);
      const point = item
        ? Object.assign({}, item.point, { name: dName })
        : { name: dName, latitude: pop.lat, longitude: pop.lng, id: pop.pointId };
      if (!point.latitude) { ui.toast('这个点还没有坐标，先去编辑页补一下', 'none'); return; }
      this.setData({ ptPopVisible: false, selPin: null }, () => this.rebuild());
      pe.open({ mode: 'guide', guideId: pop.guideId, point, key: pop.pointId, onSaved: () => this.rebuild() });
      return;
    }
    const f = (this._favStack || []).find(x => (x.id || '') === (pop.favKey || ''));
    if (!f) { this.closePtPop(); return; }
    this.setData({ ptPopVisible: false, selPin: null }, () => this.rebuild());
    pe.open({ mode: 'fav', point: f, key: pop.favKey, fid: pop.favNodeId, onSaved: () => this.rebuild() });
  },

  /** 「编辑」：新点位弹框专用（占位名不带入输入框） */
  onPopEdit() {
    const pop = this.data.ptPop;
    if (!pop || pop.mode !== 'new') return;
    this.setData({ ptPopVisible: false, selPin: null }, () => this.rebuild());
    const cleanTitle = this._cleanName(pop.title);
    pe.open({
      mode: 'new',
      point: { name: (pop.recognizing || !cleanTitle) ? '' : cleanTitle, latitude: pop.lat, longitude: pop.lng },
      address: pop.reason || '',
      onSaved: () => this.rebuild()
    });
  },

  /** 导航：拉起腾讯地图 URI（App 或网页）*/
  onPtPopNav() {
    const pop = this.data.ptPop;
    if (!pop || !pop.lat || !pop.lng) { ui.toast('缺少坐标', 'none'); return; }
    const navName = this._cleanName(pop.title) || '地图位置';
    const url = 'https://apis.map.qq.com/uri/v1/routeplan?type=drive&to='
      + encodeURIComponent(navName) + '&tocoord=' + pop.lat + ',' + pop.lng
      + '&referer=midianxunji';
    window.open(url, '_blank');
  },

  /** 分享按钮统一入口 */
  onSharePack(kind) {
    if (kind === 'loc') {
      const p = this.data.ptPop || {};
      if (!p.lat || !p.lng) {
        ui.toast('这个位置没有坐标，分享不了', 'none');
        return;
      }
      share.openPanel({
        kind: 'loc',
        name: this._cleanName(p.title) || '地图位置',
        lat: p.lat,
        lng: p.lng,
        category: p.category || 'qita'
      });
      return;
    }
    const gid = this.activeGuideId();
    const g = gid ? guides.getById(gid) : guides.current();
    if (!g) {
      ui.toast('还没有可分享的攻略', 'none');
      return;
    }
    share.openPanel({ kind: 'guide', id: g.id });
  },

  /* ================= 长按空白新增 ================= */
  markSelectedAndShow(name, lat, lng) {
    if (lat == null || lng == null) return;
    this.setData({ selPin: { latitude: lat, longitude: lng } }, () => this.rebuild());
    const hasName = !!(name && String(name).trim());
    this.showPop({
      mode: 'new',
      title: hasName ? String(name).trim() : '正在识别位置…',
      recognizing: !hasName,
      reason: '',
      lat, lng,
      owner: '长按地图落点',
      owners: [],
      starred: false
    }, true);
    if (!hasName) this.reverseName(lat, lng);
    this.regeoFallback(lat, lng);
  },

  /** 识别兜底：等待上限 8 秒 */
  regeoFallback(lat, lng) {
    clearTimeout(this._regeoTimer);
    this._regeoTimer = setTimeout(() => {
      const pop = this.data.ptPop;
      if (!this.data.ptPopVisible || pop.mode !== 'new' || !pop.recognizing) return;
      this.setData({
        'ptPop.title': '附近位置',
        'ptPop.recognizing': false,
        'ptPop.reason': '坐标 ' + Number(lng).toFixed(5) + ', ' + Number(lat).toFixed(5) + ' · 点「编辑」可补充名称'
      });
    }, 8000);
  },

  regeoMiss(lat, lng) {
    const pop = this.data.ptPop;
    if (!this.data.ptPopVisible || pop.mode !== 'new') return;
    clearTimeout(this._regeoTimer);
    this.setData({
      'ptPop.title': '附近位置',
      'ptPop.recognizing': false,
      'ptPop.reason': '坐标 ' + Number(lng).toFixed(5) + ', ' + Number(lat).toFixed(5) + ' · 点「编辑」可补充名称'
    });
  },

  /** 坐标 → 地名（腾讯直连；失败走兜底文案） */
  reverseName(lat, lng) {
    const apply = (name, addr) => {
      const pop = this.data.ptPop;
      if (!this.data.ptPopVisible || pop.mode !== 'new') return;
      clearTimeout(this._regeoTimer);
      const nm = this._cleanName(name);
      this.setData({
        'ptPop.recognizing': false,
        'ptPop.title': nm || '附近位置',
        'ptPop.reason': addr || ('坐标 ' + Number(lng).toFixed(5) + ', ' + Number(lat).toFixed(5))
      });
    };
    if (qqmap.hasKey()) {
      qqmap.regeo(lat, lng).then((r) => {
        if (r && r.code === 0 && r.data && (r.data.name || r.data.region)) {
          apply(String(r.data.name || r.data.region).trim(), String(r.data.address || r.data.region || '').trim());
          return;
        }
        this.regeoMiss(lat, lng);
      }).catch(() => this.regeoMiss(lat, lng));
      return;
    }
    this.regeoMiss(lat, lng);
  },

  onMapBlankTap() {
    if (this._regionChanged) return;
    if (this.data.guideSheetVisible) return;
    this.setData({ ptPopVisible: false, selPin: null, showMissingList: false }, () => this.rebuild());
  },

  /* ================= 搜索面板 =================
   * 网页版没有 wx.chooseLocation，复活小程序里「自研搜索面板」：
   * 本地点位（收藏 + 攻略）+ 腾讯关键词搜索 + 历史记录。
   */
  openSearchPanel() {
    const history = this.readHistory();
    this.setData({
      searchPanelVisible: true,
      searchKw: '',
      searchResults: [],
      searchHistory: history,
      searchTip: '',
      searchOnline: qqmap.hasKey(),
      ptPopVisible: false
    });
  },
  closeSearch() { this.setData({ searchPanelVisible: false, searchKw: '', searchResults: [] }); },

  readHistory() {
    try {
      const l = store.get(STORAGE_HISTORY);
      return Array.isArray(l) ? l.slice(0, 12) : [];
    } catch (e) { return []; }
  },
  writeHistory(item) {
    if (!item || !item.name) return;
    let list = this.readHistory().filter(x => x.name !== item.name);
    list.unshift({ name: item.name, address: item.address || '', latitude: item.latitude, longitude: item.longitude });
    list = list.slice(0, 12);
    try { store.set(STORAGE_HISTORY, list); } catch (e) { /* ignore */ }
    this.setData({ searchHistory: list });
  },
  clearHistory() {
    try { store.remove(STORAGE_HISTORY); } catch (e) { /* ignore */ }
    this.setData({ searchHistory: [] });
  },

  onSearchInput(kw) {
    this.setData({ searchKw: kw });
    clearTimeout(this._searchTimer);
    if (!kw || !kw.trim()) {
      this.setData({ searchResults: [], searching: false, searchTip: '' });
      return;
    }
    this.setData({ searching: true, searchTip: '' });
    this._searchTimer = setTimeout(() => this.doSearch(kw.trim()), 320);
  },

  onSearchConfirm() {
    const kw = (this.data.searchKw || '').trim();
    if (!kw) return;
    clearTimeout(this._searchTimer);
    this.setData({ searching: true, searchTip: '' });
    this.doSearch(kw);
  },

  localSearch(kw) {
    const k = kw.toLowerCase();
    const out = [];
    for (const f of favorites.allPoints()) {
      if (f.name && String(f.name).toLowerCase().indexOf(k) >= 0) {
        out.push({
          local: true,
          kind: 'fav',
          key: f.id || '',
          name: f.name,
          address: f.note || f.reason || '我的点位收藏',
          latitude: f.latitude,
          longitude: f.longitude
        });
      }
    }
    for (const g of guides.getList()) {
      for (const p of (g.points || [])) {
        if (p.name && String(p.name).toLowerCase().indexOf(k) >= 0) {
          out.push({
            local: true,
            kind: 'guide',
            gid: g.id,
            guideName: g.name || '未命名攻略',
            pid: p.id,
            name: p.name,
            address: p.reason ? String(p.reason).slice(0, 40) : ('攻略《' + (g.name || '') + '》'),
            latitude: p.latitude,
            longitude: p.longitude
          });
        }
      }
    }
    return out.slice(0, 12);
  },

  doSearch(kw) {
    const locals = this.localSearch(kw);
    let near = {};
    const c = this._map && this._map.getCenter ? this._map.getCenter() : null;
    if (c) near = { latitude: c.getLat(), longitude: c.getLng() };

    const finish = (remoteList, tip) => {
      if (kw !== (this.data.searchKw || '').trim()) return;
      const merged = locals.concat(remoteList || []).slice(0, 30);
      this.setData({
        searching: false,
        searchResults: merged,
        searchTip: merged.length ? '' : (tip || '没找到相关地点，换个关键词试试')
      });
    };

    if (!qqmap.hasKey()) {
      finish([], locals.length ? '' : '暂未配置腾讯地图 Key，只能搜本地点位');
      return;
    }
    qqmap.search(kw, near).then((res) => {
      const r = res || {};
      if (r.code === 0) { finish(r.data, ''); return; }
      const msg = (r.message || '');
      let tip = '地图搜索暂时不可用';
      if (r.message === 'NO_KEY') tip = '暂未配置腾讯地图 Key，只能搜本地点位';
      else if (/199/.test(String(r.code)) || /未开启/.test(msg)) tip = '腾讯 Key 未开启 WebServiceAPI';
      else if (/111|签名/.test(String(r.code) + msg)) tip = '腾讯 Key 签名校验失败';
      finish([], locals.length ? '' : tip);
    }).catch(() => finish([], locals.length ? '' : '地图搜索失败，请稍后再试'));
  },

  pickResult(i) {
    const r = this.data.searchResults[Number(i)];
    if (!r) return;
    this.writeHistory(r);
    this.setData({ searchPanelVisible: false });
    if (r.local) {
      if (!(r.latitude && r.longitude)) {
        ui.toast('这个点还没定位，去编辑页补坐标', 'none');
        return;
      }
      if (r.kind === 'fav') {
        const f = (this._favStack || []).find(x => (x.id || '') === (r.key || ''));
        if (f) { this.focusPoint(f); this.openFavPop(f); return; }
        ui.toast('点位收藏图层未打开，已定位到该点', 'none');
        return;
      }
      const g = guides.getById(r.gid);
      const p = g ? (g.points || []).find(x => x.id === r.pid) : null;
      if (g && p) {
        this.focusIfOutside(p);
        this.openGuidePop({ guideId: g.id, guideName: g.name, pointId: p.id, point: p });
        return;
      }
      ui.toast('攻略图层未打开，已定位到该点', 'none');
      return;
    }
    this.markSelectedAndShow(r.name || '', Number(r.latitude), Number(r.longitude));
  },

  pickHistory(i) {
    const r = this.data.searchHistory[Number(i)];
    if (!r) return;
    this.setData({ searchPanelVisible: false });
    this.markSelectedAndShow(r.name || '', Number(r.latitude), Number(r.longitude));
  },

  clearSearchKw() {
    clearTimeout(this._searchTimer);
    this.setData({ searchKw: '', searchResults: [], searching: false, searchTip: '' });
  },

  /* ================= 攻略原文对照 ================= */
  refreshGuideSheet(g) {
    const groups = [];
    for (const p of (g.points || [])) {
      if (!p || !p.name) continue;
      const key = (p.group || '其他').trim();
      let bucket = groups.find(x => x.name === key);
      if (!bucket) {
        bucket = { gkey: key + groups.length, name: key, color: (this._groupColorMap || {})[key] || '#12B76A', points: [] };
        groups.push(bucket);
      }
      bucket.points.push({ pkey: (p.id || p.name) + bucket.points.length, name: p.name, reason: p.reason || '', quote: p.quote || '' });
    }
    this.setData({
      guideRows2: groups,
      guideText: g.rawText || '',
      currentGuideName2: g.name || '攻略内容'
    });
  },

  openGuideSheet() {
    const g = this.activeGuide();
    if (!g) { ui.toast('还没有攻略', 'none'); return; }
    this.setData({
      guideSheetVisible: true,
      ptPopVisible: false,
      searchPanelVisible: false,
      selPin: null
    });
    this.refreshGuideSheet(g);
    this.rebuild();
  },
  closeGuideSheet() { this.setData({ guideSheetVisible: false }); },

  openGsEdit() {
    const g = this.activeGuide();
    if (!g) { ui.toast('还没有攻略', 'none'); return; }
    this.setData({ gsEditVisible: true, gsEditText: g.rawText || '' });
  },
  onGsEditInput(v) { this.setData({ gsEditText: v }); },
  closeGsEdit() { this.setData({ gsEditVisible: false }); },
  saveGsEdit() {
    const id = this.activeGuideId();
    if (!id) return;
    guides.update(id, { rawText: this.data.gsEditText || '' });
    this.setData({ gsEditVisible: false });
    const cur = guides.getById(id);
    if (cur && this.data.guideSheetVisible) this.refreshGuideSheet(cur);
    store.set('guide_refresh_token', { token: Date.now() });
    ui.toast('攻略内容已保存', 'success');
  },

  /** 重新标点位：原有点位作废，按当前攻略内容重新解析 */
  regenSheetGuide() {
    const id = this.activeGuideId();
    const g = guides.getById(id);
    if (!g) { ui.toast('还没有攻略', 'none'); return; }
    if (this.data.gsBusy) return;
    ui.modal({
      title: '按当前攻略内容重新解析？',
      content: '现在这些点位会全部作废，只按攻略里的内容重新解析一遍。同名点位会尽量把之前补过的坐标沿用过来。',
      confirmText: '重新解析'
    }).then((ok) => {
      if (!ok) return;
      this.setData({ gsBusy: true });
      ui.loading('正在重新解析…');
      regen.regenPoints(id).then((res) => {
        ui.hideLoading();
        this.setData({ gsBusy: false });
        this.rebuild();
        const cur = guides.getById(id);
        if (cur && this.data.guideSheetVisible) this.refreshGuideSheet(cur);
        ui.toast('已重新标出 ' + res.count + ' 个点位', 'none');
      }).catch((err) => {
        ui.hideLoading();
        this.setData({ gsBusy: false });
        ui.toast((err && err.message) || '解析失败，请稍后再试', 'none');
      });
    });
  },

  /* 拖动顶端放大 / 缩小攻略框 */
  onGsGrabStart(clientY) {
    this._gsBaseY = clientY;
    this._gsBaseH = this.data.gsHeight;
  },
  onGsGrabMove(clientY) {
    if (this._gsBaseY == null) return;
    const dy = this._gsBaseY - clientY;
    const h = Math.max(this._gsMin, Math.min(this._gsMax, this._gsBaseH + dy));
    this.setData({ gsHeight: Math.round(h) }, true);
  },
  onGsGrabEnd() { this._gsBaseY = null; },

  /* ================= 定位 ================= */
  locateMe() {
    this.hidePtToast();
    this._programMove = true;
    clearTimeout(this._programMoveTimer);
    this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 1600);
    this.setData({
      ptToastVisible: false,
      favPickerVisible: false,
      ptPopVisible: false,
      selPin: null,
      showMissingList: false
    });
    if (!navigator.geolocation) {
      this._programMove = false;
      ui.toast('当前浏览器不支持定位', 'none');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude);
        this._myLat = c.latitude;
        this._myLng = c.longitude;
        this._scaleVal = LOCATE_SCALE;
        this._lastFoldScale = LOCATE_SCALE;
        if (this._map) {
          this._map.setCenter(new this._TMap.LatLng(c.latitude, c.longitude));
          this._map.setZoom(LOCATE_SCALE);
        }
        this.rebuild();   // 蓝点上图
        clearTimeout(this._locateScaleTimer);
        this._locateScaleTimer = setTimeout(() => { this._programMove = false; }, 700);
      },
      () => {
        this._programMove = false;
        ui.toast('无法获取位置', 'none');
      },
      { timeout: 8000, maximumAge: 0, enableHighAccuracy: true }
    );
  },

  activeGuideId() {
    return this.data.soloGuideId || this.data.currentGuideId || '';
  },
  activeGuide() {
    const id = this.activeGuideId();
    return (id && guides.getById(id)) || guides.current() || null;
  },

  onEditPoints() {
    const id = this.activeGuideId();
    if (!id) { ui.toast('还没有攻略可编辑', 'none'); return; }
    router.navigate('/review?gid=' + encodeURIComponent(id));
  },

  toggleMissingList() { this.setData({ showMissingList: !this.data.showMissingList, ptPopVisible: false }); },
  fixMissing(i) {
    const m = this.data.missingPoints[Number(i)];
    if (!m) return;
    router.navigate('/review?gid=' + encodeURIComponent(m.gid) + '&focus=' + encodeURIComponent(m.pid || ''));
  },

  /** 把地图定位到某个具体点位（点位详情「在地图看」） */
  locatePoint(locate) {
    const lat = Number(locate.lat);
    const lng = Number(locate.lng);
    if (!lat || !lng) return;
    if (locate.gid) {
      guides.setVisible(locate.gid, true);
      guides.setCurrent(locate.gid);
    }
    if (locate.fid) {
      favorites.setFolderVisible(locate.fid, true);
      this.setData({ favLayerOn: true, guideLayerOn: true, layerMode: 'both' });
    }
    this._programMove = true;
    clearTimeout(this._programMoveTimer);
    this._programMoveTimer = setTimeout(() => { this._programMove = false; }, 1200);
    this.setData({
      activeKey: 'all',
      filterMode: 'all',
      ptPopVisible: false,
      selPin: { latitude: lat, longitude: lng }
    }, () => {
      this.rebuild();
      if (this._map) {
        this._map.setCenter(new this._TMap.LatLng(lat, lng));
        this._map.setZoom(16);
        this._scaleVal = 16;
        this._lastFoldScale = 16;
      }
    });
    ui.toast(locate.name ? ('已定位到「' + geo.truncate(locate.name, 6) + '」') : '已定位到该点位', 'none');
  },

  /* ================= 渲染 ================= */
  render() {
    const d = this.data;
    const tools = [];
    if (d.soloGuideId) {
      tools.push('<button class="map-tool-btn" data-act="edit-points" title="编辑点位">✏️</button>');
    }
    tools.push('<button class="map-tool-btn" data-act="open-guide-sheet" title="攻略内容">📄</button>');
    tools.push('<button class="map-tool-btn" data-act="open-search" title="搜索">🔍</button>');
    tools.push('<button class="map-tool-btn" data-act="locate-me" title="定位">🧭</button>');

    return (
      '<div class="page map-page">' +

      /* ===== 顶部：图层按钮 + 聚焦信息条 ===== */
      '<div class="map-top">' +
      '  <button class="map-layer-btn" data-act="open-layer-panel">图层</button>' +
      (d.soloGuideId ?
        '<div class="iso-bar">' +
        '  <div class="iso-name">' + esc(d.soloGuideName) + '</div>' +
        '  <div class="iso-caps">' +
        '    <span class="cap total">共 ' + esc(d.isolatedGuideCount) + '</span>' +
        '    <span class="cap ok">已定位 ' + esc(d.isolatedGuideLocated) + '</span>' +
        '    <span class="cap miss">未定位 ' + esc(d.isolatedGuideMissing) + '</span>' +
        '  </div>' +
        '  <button class="iso-missing" data-act="toggle-missing">未定位点位</button>' +
        '</div>'
        :
        '<div class="map-stat">攻略 ' + esc(d.guideOnCount) + ' 篇 · 收藏夹 ' + esc(d.favFolderCount) + ' 个 · 攻略未定位 ' + esc(d.guideMissingCount) + '</div>') +
      '</div>' +

      /* ===== 右侧工具 ===== */
      '<div class="map-tools">' + tools.join('') + '</div>' +

      /* ===== 折叠提示 ===== */
      (d.zoomHint ? '<div class="map-zoom-hint">' + esc(d.zoomHint) + '</div>' : '') +

      /* ===== 点位弹框 ===== */
      (d.ptPopVisible ?
        '<div class="pt-pop">' +
        '  <div class="pt-pop-head">' +
        '    <div class="pt-pop-title">' + esc(d.ptPop.title) + (d.ptPop.recognizing ? '（识别中…）' : '') + '</div>' +
        '    <button class="pt-pop-star ' + (d.ptPop.starred ? 'on' : '') + '" data-act="pop-star" title="收藏">' +
        '      <img src="' + esc(d.ptPop.starIcon) + '" alt=""></button>' +
        '    <button class="pt-pop-close" data-act="close-pop">✕</button>' +
        '  </div>' +
        (d.ptPop.owner ? '<div class="pt-pop-owner">' + esc(d.ptPop.owner) + '</div>' : '') +
        (d.ptPop.reason ? '<div class="pt-pop-reason">' + esc(d.ptPop.reason) + '</div>' : '') +
        (d.ptPop.distanceText ? '<div class="pt-pop-dist">📍 ' + esc(d.ptPop.distanceText) + '</div>' : '') +
        ((d.ptPop.owners || []).length ?
          '<div class="pt-pop-owners">' +
          (d.ptPop.owners || []).map(o =>
            '<span class="owner-tag ' + (o.type === 'guide' ? 't-guide' : 't-fav') + '">' + esc(o.label) + '</span>').join('') +
          '</div>'
          : '') +
        '  <div class="pt-pop-acts">' +
        (d.ptPop.mode === 'new' ?
          '<button class="btn btn-s line" data-act="pop-edit">✏️ 编辑</button>' +
          '<button class="btn btn-s" data-act="pop-star">' + (d.ptPop.starred ? '★ 已收藏' : '☆ 收藏') + '</button>'
          :
          '<button class="btn btn-s line" data-act="pop-detail">详情</button>') +
        '    <button class="btn btn-s line" data-act="pop-nav">导航</button>' +
        '    <button class="btn btn-s" data-act="pop-share" data-arg="loc">分享</button>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 收藏成功提示 ===== */
      (d.ptToastVisible ?
        '<div class="pt-toast ' + (d.ptToastFade ? 'fade' : '') + '">' +
        '  <div class="pt-toast-main">' +
        '    <img class="pt-toast-ic" src="' + esc(d.ptToastIcon) + '" alt="">' +
        '    <span class="pt-toast-text">已收藏到</span>' +
        '    <button class="pt-toast-name" data-act="open-pt-picker">' + esc(d.ptToastKind) + ' · ' + esc(d.ptToastName) + '</button>' +
        (d.ptToastSuffix ? '<span class="pt-toast-suffix">' + esc(d.ptToastSuffix) + '</span>' : '') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 未定位点位列表 ===== */
      (d.showMissingList ?
        '<div class="missing-panel">' +
        '  <div class="missing-head">未定位点位（' + esc(d.missingCount) + '）' +
        '    <button class="sheet-close" data-act="toggle-missing">✕</button></div>' +
        '  <div class="missing-list">' +
        ((d.missingPoints || []).length ?
          (d.missingPoints || []).map((m, i) =>
            '<button class="missing-row" data-act="fix-missing" data-arg="' + i + '">' +
            '  <span class="missing-dot" style="background:' + esc(m.color) + '"></span>' +
            '  <span class="missing-name">' + esc(m.name) + '</span>' +
            '  <span class="missing-guide">' + esc(m.guideName) + '</span>' +
            '  <span class="missing-go">去补坐标 →</span>' +
            '</button>').join('')
          : '<div class="missing-empty">全部点位都已定位 ✓</div>') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 图层面板 ===== */
      (d.layerPanelVisible ?
        '<div class="ui-mask in" data-act="close-layer-panel"></div>' +
        '<div class="ui-sheet in layer-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">地图图层</div>' +
        '    <button class="sheet-close" data-act="close-layer-panel">✕</button></div>' +
        '  <div class="sheet-body">' +
      '    <div class="layer-modes">' +
      '      <button class="layer-mode ' + (d.layerMode === 'both' ? 'on' : '') + '" data-act="pick-layer" data-arg="both"><span class="lm-ic">🗺️</span>都看</button>' +
      '      <button class="layer-mode ' + (d.layerMode === 'guide' ? 'on' : '') + '" data-act="pick-layer" data-arg="guide"><span class="lm-ic">📄</span>只看攻略</button>' +
      '      <button class="layer-mode ' + (d.layerMode === 'fav' ? 'on' : '') + '" data-act="pick-layer" data-arg="fav"><span class="lm-ic">⭐</span>只看收藏</button>' +
      '    </div>' +
        '    <button class="fs-row" data-act="open-fav-picker">' +
        '      <span class="fs-row-main"><span class="fs-row-title">点位收藏夹（' + esc(d.favFolderCount) + '）</span>' +
        '      <span class="fs-row-sub">勾选哪些收藏夹的点位上图</span></span>' +
        '      <img class="m-arrow" src="images/ui/chevron-right.png" alt=""></button>' +
        '    <button class="fs-row" data-act="open-guide-picker">' +
        '      <span class="fs-row-main"><span class="fs-row-title">攻略（' + esc(d.guideOnCount) + ' 篇亮着 · 未定位 ' + esc(d.guideMissingCount) + '）</span>' +
        '      <span class="fs-row-sub">勾选哪些攻略的点位上图</span></span>' +
        '      <img class="m-arrow" src="images/ui/chevron-right.png" alt=""></button>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 收藏夹可见性复选 ===== */
      (d.favLayerPickerVisible ?
        '<div class="ui-mask in" data-act="close-fav-picker"></div>' +
        '<div class="ui-sheet in favpick-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">哪些收藏夹上图</div>' +
        '    <button class="sheet-close" data-act="close-fav-picker">✕</button></div>' +
        '  <div class="favpick-scroll">' +
        (d.favLayerPickerRows || []).map(r =>
          '<button class="favpick-row" data-act="toggle-fav-layer" data-arg="' + esc(r.id) + '">' +
          '<span class="favpick-check ' + (r.checked ? 'on' : '') + '">' + (r.checked ? '✓' : '') + '</span>' +
          '<span class="favpick-name">' + esc(r.name) + '</span>' +
          '<span class="favpick-count">' + esc(r.count) + ' 个</span></button>').join('') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 攻略可见性复选 ===== */
      (d.guideLayerPickerVisible ?
        '<div class="ui-mask in" data-act="close-guide-picker"></div>' +
        '<div class="ui-sheet in favpick-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">哪些攻略上图</div>' +
        '    <button class="sheet-close" data-act="close-guide-picker">✕</button></div>' +
        '  <div class="favpick-scroll">' +
        (d.guideLayerRows || []).map(r =>
          '<button class="favpick-row" data-act="toggle-guide-layer" data-arg="' + esc(r.id) + '">' +
          '<span class="favpick-check ' + (r.on ? 'on' : '') + '">' + (r.on ? '✓' : '') + '</span>' +
          '<span class="favpick-name">' + esc(r.name) + '</span>' +
          '<span class="favpick-count">' + esc(r.located) + '/' + esc(r.count) + ' 定位</span></button>').join('') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 收藏夹复选（换夹） ===== */
      (d.favPickerVisible ?
        '<div class="ui-mask in" data-act="close-pt-picker"></div>' +
        '<div class="ui-sheet in favpick-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">收藏到哪个夹</div>' +
        '    <button class="sheet-close" data-act="close-pt-picker">✕</button></div>' +
        '  <div class="favpick-scroll">' +
        (d.favPickerRows || []).map(r =>
          '<button class="favpick-row" data-act="toggle-pt-picker-row" data-arg="' + esc(r.id) + '">' +
          '<span class="favpick-check ' + (r.checked ? 'on' : '') + '">' + (r.checked ? '✓' : '') + '</span>' +
          '<span class="favpick-name">' + esc(r.name) + '</span>' +
          '<span class="favpick-count">' + esc(r.count) + ' 个</span></button>').join('') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 搜索面板 ===== */
      (d.searchPanelVisible ?
        '<div class="ui-mask in" data-act="close-search"></div>' +
        '<div class="ui-sheet in search-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">搜索地点</div>' +
        '    <button class="sheet-close" data-act="close-search">✕</button></div>' +
        '  <div class="sheet-body">' +
        '    <div class="sp-search-box">' +
        '      <input id="mapSearchKw" class="sp-input" value="' + esc(d.searchKw) + '" placeholder="搜地点名 / 我的点位" maxlength="30">' +
        (d.searchKw ? '<button class="sp-clear" data-act="clear-search-kw">✕</button>' : '') +
        '      <button class="sp-go" data-act="search-confirm">搜索</button>' +
        '    </div>' +
        (d.searching ? '<div class="sp-tip">搜索中…</div>' : '') +
        (d.searchTip && !d.searching ? '<div class="sp-tip">' + esc(d.searchTip) + '</div>' : '') +
        ((d.searchResults || []).length ?
          '<div class="sp-results">' +
          (d.searchResults || []).map((r, i) =>
            '<button class="sp-row" data-act="pick-result" data-arg="' + i + '">' +
            '  <span class="sp-row-ic">' + (r.local ? '📌' : '📍') + '</span>' +
            '  <span class="sp-row-main"><span class="sp-row-name">' + esc(r.name) + '</span>' +
            '  <span class="sp-row-sub">' + esc(r.address || '') + '</span></span>' +
            '</button>').join('') +
          '</div>'
          : '') +
        ((d.searchHistory || []).length ?
          '<div class="sp-history">' +
          '  <div class="sp-history-head">最近搜索<button class="sp-history-clear" data-act="clear-history">清空</button></div>' +
          (d.searchHistory || []).map((h, i) =>
            '<button class="sp-row" data-act="pick-history" data-arg="' + i + '">' +
            '  <span class="sp-row-ic">🕘</span>' +
            '  <span class="sp-row-main"><span class="sp-row-name">' + esc(h.name) + '</span>' +
            '  <span class="sp-row-sub">' + esc(h.address || '') + '</span></span>' +
            '</button>').join('') +
          '</div>'
          : '') +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 攻略对照面板 ===== */
      (d.guideSheetVisible ?
        '<div class="gt-sheet show" style="height:' + esc(d.gsHeight) + 'px">' +
        '  <div class="gt-grab" data-act="gs-grab">' +
        '    <div class="gt-bar"></div>' +
        '    <span class="gt-grab-hint">拖动调整高度</span>' +
        '  </div>' +
        '  <div class="gt-head">' +
        '    <div class="gt-title">' + esc(d.currentGuideName2) + '</div>' +
        '    <button class="gt-close" data-act="close-guide-sheet">✕</button>' +
        '  </div>' +
        '  <div class="gt-scroll">' +
        (d.guideRows2 || []).map(grp =>
          '<div class="gs-group">' +
          '  <div class="gs-group-name"><span class="gs-dot" style="background:' + esc(grp.color) + '"></span>' + esc(grp.name) + '</div>' +
          (grp.points || []).map(pt =>
            '    <div class="gs-point"><span class="gs-point-name">' + esc(pt.name) + '</span>' +
            (pt.reason ? '<span class="gs-point-reason">' + esc(pt.reason) + '</span>' : (pt.quote ? '<span class="gs-point-reason">「' + esc(pt.quote) + '」</span>' : '')) +
            '</div>').join('') +
          '</div>').join('') +
        (d.guideText ? '<div class="gs-raw">' + esc(d.guideText) + '</div>' : '') +
        '  </div>' +
        '  <div class="gs-actions">' +
        '    <button class="btn btn-s line" data-act="gs-edit">✏️ 修改攻略内容</button>' +
        '    <button class="btn btn-s line" data-act="gs-regen">' + (d.gsBusy ? '处理中…' : '🔄 重新标点位') + '</button>' +
        '    <button class="btn btn-s" data-act="share-guide">分享这篇</button>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 攻略内容编辑弹层 ===== */
      (d.gsEditVisible ?
        '<div class="ui-mask in" data-act="close-gs-edit"></div>' +
        '<div class="ui-sheet in text-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">修改攻略内容</div>' +
        '    <button class="sheet-close" data-act="close-gs-edit">✕</button></div>' +
        '  <div class="text-edit-body">' +
        '    <textarea class="field-ta" id="mapGsText" placeholder="粘贴或编辑这篇攻略的正文…">' + esc(d.gsEditText) + '</textarea>' +
        '    <div class="text-edit-tip">改完点「保存」即写回这篇攻略</div>' +
        '  </div>' +
        '  <div class="text-actions">' +
        '    <button class="btn btn-s line" data-act="close-gs-edit">取消</button>' +
        '    <button class="btn btn-s" data-act="save-gs-edit">保存</button>' +
        '  </div>' +
        '</div>'
        : '') +

      '</div>'
    );
  },

  bind(root) {
    this.on(root, 'open-layer-panel', () => this.openLayerPanel());
    this.on(root, 'close-layer-panel', () => this.closeLayerPanel());
    this.on(root, 'pick-layer', (e, m) => this.pickLayerMode(m));
    this.on(root, 'open-fav-picker', () => this.openFavLayerPickerFromPanel());
    this.on(root, 'open-guide-picker', () => this.openGuideLayerPickerFromPanel());
    this.on(root, 'close-fav-picker', () => this.closeFavLayerPicker());
    this.on(root, 'close-guide-picker', () => this.closeGuideLayerPicker());
    this.on(root, 'toggle-fav-layer', (e, id) => this.toggleFavLayerRow(id));
    this.on(root, 'toggle-guide-layer', (e, id) => this.toggleGuideLayerRow(id));

    this.on(root, 'close-pop', () => this.closePtPop());
    this.on(root, 'pop-star', () => this.onPopStar());
    this.on(root, 'pop-detail', () => this.onPopDetail());
    this.on(root, 'pop-edit', () => this.onPopEdit());
    this.on(root, 'pop-nav', () => this.onPtPopNav());
    this.on(root, 'pop-share', () => this.onSharePack('loc'));
    this.on(root, 'open-pt-picker', () => this.openPtFolderPicker());
    this.on(root, 'close-pt-picker', () => this.closeFavPicker());
    this.on(root, 'toggle-pt-picker-row', (e, id) => this.toggleFavPickerRow(id));

    this.on(root, 'toggle-missing', () => this.toggleMissingList());
    this.on(root, 'fix-missing', (e, i) => this.fixMissing(i));

    this.on(root, 'edit-points', () => this.onEditPoints());
    this.on(root, 'open-guide-sheet', () => this.openGuideSheet());
    this.on(root, 'close-guide-sheet', () => this.closeGuideSheet());
    this.on(root, 'open-search', () => this.openSearchPanel());
    this.on(root, 'close-search', () => this.closeSearch());
    this.on(root, 'clear-search-kw', () => this.clearSearchKw());
    this.on(root, 'search-confirm', () => this.onSearchConfirm());
    this.on(root, 'pick-result', (e, i) => this.pickResult(i));
    this.on(root, 'pick-history', (e, i) => this.pickHistory(i));
    this.on(root, 'clear-history', () => this.clearHistory());
    this.on(root, 'locate-me', () => this.locateMe());

    this.on(root, 'gs-edit', () => this.openGsEdit());
    this.on(root, 'gs-regen', () => this.regenSheetGuide());
    this.on(root, 'close-gs-edit', () => this.closeGsEdit());
    this.on(root, 'save-gs-edit', () => this.saveGsEdit());
    this.on(root, 'share-guide', () => this.onSharePack('guide'));

    // 搜索输入（受控，不整页重渲染）
    const sk = root.querySelector('#mapSearchKw');
    if (sk) {
      sk.addEventListener('input', () => this.onSearchInput(sk.value));
      sk.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.onSearchConfirm(); });
    }
    // 攻略正文编辑（受控）
    const gt = root.querySelector('#mapGsText');
    if (gt) {
      gt.addEventListener('input', () => this.onGsEditInput(gt.value));
    }
    // 攻略面板拖拽调高度
    const grab = root.querySelector('[data-act="gs-grab"]');
    if (grab) {
      const start = (cy) => this.onGsGrabStart(cy);
      const move = (cy) => this.onGsGrabMove(cy);
      grab.addEventListener('mousedown', (e) => { start(e.clientY); e.preventDefault(); });
      window.addEventListener('mousemove', (e) => { if (this._gsBaseY != null) move(e.clientY); });
      window.addEventListener('mouseup', () => this.onGsGrabEnd());
      grab.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) start(t.clientY); }, { passive: true });
      grab.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) move(t.clientY); }, { passive: true });
      grab.addEventListener('touchend', () => this.onGsGrabEnd());
    }
  }
};

export default mixin(page);
