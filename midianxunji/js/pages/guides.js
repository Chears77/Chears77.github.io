/**
 * pages/guides.js —— 攻略页（网页版）
 *
 * 功能对齐小程序 guides 页：
 *   · 最近攻略列表（置顶 / 收藏 / 全文 / 分享 / 设置四操作）
 *   · 攻略全文半屏：只读 → 就地编辑保存 → 重新标点位
 *   · 热门行程：正文半屏 → 标到地图（第七十四轮同名族三分支逻辑完整保留）
 *   · 收藏成功提示 + 收纳夹复选换夹
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import guides from '../lib/guides.js';
import follow from '../lib/follow.js';
import templates from '../lib/templates.js';
import regen from '../lib/regen.js';
import localparse from '../lib/localparse.js';
import share from '../lib/share.js';

const GUIDE_DEFAULT_FOLDER = '我的攻略';
const LEGACY_GUIDE_FOLDER = '我的收藏';

const page = {
  data: {
    tab: 'recent',
    list: [],
    totalCount: 0,
    followedCount: 0,
    hotList: [],
    // 设置弹层
    sheetVisible: false,
    activeGuide: null,
    // 全文弹层
    textVisible: false,
    textTitle: '',
    textBody: '',
    textGuideId: '',
    textEditing: false,
    textDraft: '',
    textBusy: false,
    // 热门正文弹层
    hotTextVisible: false,
    hotTextTitle: '',
    hotTextBody: '',
    hotTextId: '',
    hotBusy: false,
    // 收藏提示 + 换夹
    toastVisible: false,
    toastName: '',
    pickerVisible: false,
    pickerRows: [],
    pickerGid: ''
  },

  onLoad() {
    this._toastTimer = 0;
    // 我的页统计格跳转：mine.goStat 写 pending_guides_tab，落到对应子页
    const pend = store.get('pending_guides_tab');
    if (pend) { store.remove('pending_guides_tab'); this.switchTab(pend); }
  },
  onShow() { this.loadList(); },

  /* ============ 列表 ============ */
  timeText(ts) {
    const n = Date.now();
    const d = n - (Number(ts) || n);
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 7 * 86400000) return Math.floor(d / 86400000) + ' 天前';
    const t = new Date(ts);
    return (t.getMonth() + 1) + '月' + t.getDate() + '日';
  },
  loadList() {
    const list = guides.getList().map((g) => {
      const pts = g.points || [];
      return {
        id: g.id,
        name: g.name || '未命名攻略',
        count: pts.length,
        located: pts.filter(p => p.latitude && p.longitude).length,
        unlocated: pts.filter(p => !(p.latitude && p.longitude)).length,
        timeText: this.timeText(g.updateTime || g.createTime),
        pinned: !!g.pinned,
        followed: follow.isFollowed(g.id)
      };
    });
    this.setData({
      list,
      totalCount: list.length,
      followedCount: list.filter(x => x.followed).length
    });
  },
  switchTab(tab) {
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'hot') this.loadHot();
  },
  loadHot() {
    const hotList = templates.list().map((t) => ({
      id: t.id,
      name: templates.tripTitle(t),
      tag: t.tag || '',
      count: templates.pointCount(t),
      preview: (templates.textOf(t.id) || '').replace(/\s+/g, ' ').slice(0, 40)
    }));
    this.setData({ hotList });
  },

  /* ============ 卡片操作 ============ */
  openMap(id) {
    const g = guides.getById(id);
    if (!g) { ui.toast('这篇攻略找不到了', 'none'); return; }
    guides.setCurrent(id);
    guides.setSoloVisible(id);
    store.set('map_isolate_guide', { id, name: g.name || '未命名攻略' });
    store.set('map_fit_guide', id);
    store.set('map_layer_intent', 'guide');
    store.set('guide_refresh_token', { token: Date.now() });
    router.navigate('/map');
  },
  quickFollow(id) {
    if (!id) return;
    if (follow.isFollowed(id)) {
      follow.unfollow(id);
      ui.toast('已取消收藏', 'none');
      this.loadList();
      return;
    }
    // 默认夹「我的攻略」；老夹「我的收藏」改名沿用（R61 口径）
    let target = follow.getFolders().find(f => f.name === GUIDE_DEFAULT_FOLDER);
    if (!target) {
      const legacy = follow.getFolders().find(f => f.name === LEGACY_GUIDE_FOLDER);
      if (legacy) {
        follow.renameFolder(legacy.id, GUIDE_DEFAULT_FOLDER);
        target = follow.getFolders().find(f => f.id === legacy.id) || legacy;
      }
    }
    if (!target) target = follow.createFolder(GUIDE_DEFAULT_FOLDER);
    if (!target) target = follow.getFolders()[0];
    if (!target) return;
    follow.addGuide(target.id, id);
    this.loadList();
    this.showCollectToast(id);
  },
  showCollectToast(gid) {
    const fobs = follow.folderObjsOfGuide(gid);
    const names = fobs.map(f => f.name);
    this.setData({ toastVisible: true, toastName: names.length ? names.join(' / ') : GUIDE_DEFAULT_FOLDER, pickerGid: gid || '' });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastVisible: false }, true), 2600);
  },
  openToastPicker() {
    const gid = this.data.pickerGid;
    if (!gid) return;
    clearTimeout(this._toastTimer);
    const rows = follow.getFolders().map(f => ({
      id: f.id,
      name: f.name,
      count: (f.guideIds || []).length,
      checked: (f.guideIds || []).indexOf(gid) >= 0
    }));
    this.setData({ toastVisible: false, pickerVisible: true, pickerRows: rows, pickerGid: gid });
  },
  closePicker() { this.setData({ pickerVisible: false }, true); },
  togglePickerRow(id) {
    const gid = this.data.pickerGid;
    if (!gid) return;
    const row = this.data.pickerRows.find(r => r.id === id);
    if (!row) return;
    if (row.checked) follow.removeGuide(row.id, gid);
    else follow.addGuide(row.id, gid);
    const rows = follow.getFolders().map(f => ({
      id: f.id, name: f.name, count: (f.guideIds || []).length,
      checked: (f.guideIds || []).indexOf(gid) >= 0
    }));
    this.setData({ pickerRows: rows });
    this.loadList();
  },
  onSharePack(id) {
    const g = id ? guides.getById(id) : null;
    if (!g) { ui.toast('还没有可分享的攻略', 'none'); return; }
    share.openPanel({ kind: 'guide', id: g.id });
  },

  /* ============ 设置弹层 ============ */
  openSheet(id) {
    const item = this.data.list.find(x => x.id === id);
    if (!item) return;
    this.setData({ sheetVisible: true, activeGuide: item });
  },
  closeSheet() { this.setData({ sheetVisible: false }, true); },
  async pinGuide() {
    const g = this.data.activeGuide;
    if (!g) return;
    guides.setPinned(g.id, !g.pinned);
    this.setData({ sheetVisible: false });
    this.loadList();
    ui.toast(g.pinned ? '已取消置顶' : '已置顶', 'none');
  },
  async renameGuide() {
    const g = this.data.activeGuide;
    if (!g) return;
    const name = window.prompt('重命名攻略', g.name || '');
    if (name === null) return;
    const nn = String(name).trim().slice(0, 20);
    if (!nn) return;
    guides.update(g.id, { name: nn });
    this.setData({ sheetVisible: false });
    this.loadList();
    ui.toast('已重命名', 'success');
  },
  async deleteGuide() {
    const g = this.data.activeGuide;
    if (!g) return;
    const ok = await ui.modal({
      title: '删除这篇攻略？',
      content: '《' + g.name + '》及其 ' + g.count + ' 个点位会被删除，已经收藏的点位不受影响。',
      confirmText: '删除',
      confirmColor: '#EF4444'
    });
    if (!ok) return;
    guides.remove(g.id);
    follow.unfollow(g.id);
    this.setData({ sheetVisible: false });
    this.loadList();
    ui.toast('已删除', 'none');
  },

  /* ============ 攻略全文 ============ */
  guideBody(g) {
    if (g.rawText && g.rawText.trim()) return g.rawText;
    const lines = [];
    for (const p of (g.points || [])) {
      if (!p || !p.name) continue;
      let s = '· ' + p.name;
      if (p.reason) s += '：' + p.reason;
      else if (p.quote) s += '：「' + p.quote + '」';
      lines.push(s);
    }
    return lines.join('\n') || '（这篇攻略还没有文本内容）';
  },
  openText(id) {
    const g = guides.getById(id);
    if (!g) return;
    this.setData({
      textVisible: true,
      textTitle: g.name || '未命名攻略',
      textBody: this.guideBody(g),
      textGuideId: id,
      textEditing: false,
      textDraft: ''
    });
  },
  closeText() { this.setData({ textVisible: false, textEditing: false, textDraft: '' }, true); },
  editTextGuide() {
    this.setData({ textEditing: true, textDraft: this.data.textBody }, true);
  },
  onTextInput(v) { this.setData({ textDraft: v }, true); },
  cancelTextEdit() { this.setData({ textEditing: false, textDraft: '' }, true); },
  saveTextEdit() {
    const id = this.data.textGuideId;
    if (!id) return;
    const g = guides.getById(id);
    if (!g) return;
    const text = this.data.textDraft || '';
    guides.update(id, { rawText: text });
    store.set('guide_refresh_token', { token: Date.now() });
    this.setData({ textEditing: false, textBody: text, textDraft: '' });
    this.loadList();
    ui.toast('攻略内容已保存', 'success');
  },
  async regenTextGuide() {
    const id = this.data.textGuideId;
    const g = guides.getById(id);
    if (!g) return;
    if (this.data.textBusy) return;
    const ok = await ui.modal({
      title: '按当前攻略内容重新解析？',
      content: '现在这些点位会全部作废，只按上方攻略内容重新解析一遍。同名点位会尽量把之前补过的坐标沿用过来。',
      confirmText: '重新解析'
    });
    if (!ok) return;
    this.setData({ textBusy: true });
    ui.loading('正在重新解析…');
    try {
      const res = await regen.regenPoints(id);
      ui.hideLoading();
      this.setData({ textBusy: false });
      this.loadList();
      const cur = guides.getById(id);
      if (cur) this.setData({ textBody: this.guideBody(cur), textTitle: cur.name || '未命名攻略' });
      ui.toast('已重新标出 ' + res.count + ' 个点位', 'none');
    } catch (err) {
      ui.hideLoading();
      this.setData({ textBusy: false });
      ui.toast((err && err.message) || '解析失败，请稍后再试', 'none');
    }
  },

  /* ============ 热门攻略 ============ */
  openHotText(id) {
    const t = templates.get(id);
    if (!t) return;
    this.setData({
      hotTextVisible: true,
      hotTextTitle: templates.tripTitle(t),
      hotTextBody: templates.textOf(id),
      hotTextId: id
    });
  },
  closeHotText() { this.setData({ hotTextVisible: false, hotTextId: '' }, true); },
  genHotMap(id) {
    const gid = id || this.data.hotTextId;
    this._createFromTemplate(gid, false);
  },

  /** 第七十四轮同名族三分支：复用 / 另建 / 新建 */
  _createFromTemplate(id, goRecent) {
    const t = templates.get(id);
    if (!t) return;
    const title = templates.tripTitle(t);
    const legacyTitle = t.name + t.days + '日行程';
    const family = guides.getList().filter(g =>
      (g.points || []).length && this._inFamily(g.name, title, legacyTitle));
    const tmplSig = templates.fullyBaked(id) ? this._pointSig(templates.pointsOf(id)) : '';
    const intact = tmplSig ? family.find(g => this._pointSig(g.points || []) === tmplSig) : null;

    if (intact) {
      // ① 没改过 → 复用：置顶 + 跳地图
      guides.touch(intact.id);
      if (goRecent) this.loadList();
      ui.toast('已打开「' + intact.name + '」', 'none');
      this._afterHot(intact.id, intact.name);
      return;
    }
    if (family.length) {
      // ② 改过 → 二选一
      const newest = family.slice().sort((a, b) =>
        (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0))[0];
      const nextName = this._nextFamilyName(title, family);
      ui.modal({
        title: '最近里已经有「' + title + '」',
        content: '这一篇你改过（点位和模板不一样）。可以另建一份全新的「' + nextName + '」放到最近置顶（你改过的那份继续保留），也可以直接打开你改过的那篇。',
        confirmText: '另建一份',
        cancelText: '打开我改过的'
      }).then((res) => {
        if (res) { this._doCreateFromTemplate(id, nextName, goRecent); return; }
        guides.touch(newest.id);
        if (goRecent) this.loadList();
        ui.toast('已打开你改过的「' + newest.name + '」', 'none');
        this._afterHot(newest.id, newest.name);
      });
      return;
    }
    // ③ 最近里没有 → 直接生成
    return this._doCreateFromTemplate(id, title, goRecent);
  },
  _pointSig(points) {
    return (points || []).map(p => String((p && p.name) || '')).sort().join('|');
  },
  _inFamily(name, title, legacyTitle) {
    const s = String(name || '');
    if (s === title || s === legacyTitle) return true;
    return this._familyRe(title).test(s);
  },
  _nextFamilyName(title, family) {
    const re = this._familyRe(title);
    let max = 1;
    (family || []).forEach((g) => {
      const m = re.exec(String((g && g.name) || ''));
      if (m) max = Math.max(max, Number(m[1]) || 1);
    });
    return title + ' ' + (max + 1);
  },
  _familyRe(title) {
    const e = String(title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + e + ' (\\d+)$');
  },
  async _doCreateFromTemplate(id, name, goRecent) {
    const t = templates.get(id);
    if (!t) return;
    const title = name || templates.tripTitle(t);
    const text = templates.textOf(id);

    if (templates.fullyBaked(id)) {
      const points = templates.pointsOf(id);
      if (!points.length) return;
      const center = templates.centerOf(points);
      const guide = guides.create({
        deviceId: store.get('device_id') || '',
        name: title,
        sourceUrl: '',
        sourceTitle: title,
        rawText: text,
        city: (t.name || title).slice(0, 30) || '',
        routeCenter: center,
        points
      });
      store.set('guide_refresh_token', { token: Date.now() });
      if (goRecent) {
        this.loadList();
        ui.toast('已标出 ' + points.length + ' 个点位', 'none');
      } else {
        this.setData({ hotTextVisible: false });
        ui.toast('已标出 ' + points.length + ' 个点位', 'none');
        this._afterHot(guide.id, guide.name);
      }
      return;
    }
    // 兜底：缺坐标 → 本地解析
    if (this.data.hotBusy) return;
    this.setData({ hotBusy: true });
    ui.loading('正在解析…');
    try {
      const r = await localparse.parseText(text);
      ui.hideLoading();
      this.setData({ hotBusy: false });
      if (r.code !== 0 || !(r.data && r.data.points && r.data.points.length)) {
        ui.toast((r && r.message) || '没有识别出地点', 'none');
        return;
      }
      const guide = guides.create({
        deviceId: store.get('device_id') || '',
        name: title,
        sourceUrl: '', sourceTitle: title,
        rawText: text,
        city: (t.name || title).slice(0, 30) || '',
        routeCenter: r.data.routeCenter || null,
        points: r.data.points
      });
      store.set('guide_refresh_token', { token: Date.now() });
      this.setData({ hotTextVisible: false });
      ui.toast('已标出 ' + guide.points.length + ' 个点位', 'none');
      this._afterHot(guide.id, guide.name);
    } catch (e) {
      ui.hideLoading();
      this.setData({ hotBusy: false });
      ui.toast('解析失败，请稍后再试', 'none');
    }
  },
  _afterHot(gid, name) {
    guides.setCurrent(gid);
    guides.setSoloVisible(gid);
    store.set('map_isolate_guide', { id: gid, name: name || '未命名攻略' });
    store.set('map_fit_guide', gid);
    store.set('map_layer_intent', 'guide');
    store.set('guide_refresh_token', { token: Date.now() });
    router.navigate('/map');
  },

  /* ============ 渲染 ============ */
  render() {
    const d = this.data;
    const isRecent = d.tab === 'recent';

    const cards = (d.list || []).map(g =>
      '<div class="g-card' + (g.pinned ? ' pinned' : '') + '" data-act="open-map" data-arg="' + esc(g.id) + '">' +
      '  <div class="g-top">' +
      (g.pinned ? '<img class="g-pin" src="images/ui/pin-dark.png" alt="">' : '') +
      '    <div class="g-name">' + esc(g.name) + '</div>' +
      '    <div class="g-acts">' +
      '      <button class="g-act' + (g.followed ? ' on' : '') + '" data-act="quick-follow" data-arg="' + esc(g.id) + '" title="收藏">' +
      '        <img src="' + (g.followed ? 'images/fav/fav-star-1.png' : 'images/marker/star-gray-big.png') + '" alt=""></button>' +
      '      <button class="g-act" data-act="open-text" data-arg="' + esc(g.id) + '" title="攻略文本">' +
      '        <img src="images/ui/doc-dark.png" alt=""></button>' +
      '      <button class="g-act" data-act="share-pack" data-arg="' + esc(g.id) + '" title="分享">' +
      '        <img src="images/ui/share-dark.png" alt=""></button>' +
      '      <button class="g-act" data-act="open-sheet" data-arg="' + esc(g.id) + '" title="设置">' +
      '        <img src="images/ui/sort.png" alt=""></button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="g-meta"><span class="g-count">' + esc(g.count) + '个点位</span><span class="g-dot">·</span>' +
      '    <span>已定位' + esc(g.located) + '个</span><span class="g-dot">·</span>' +
      '    <span>未定位' + esc(g.unlocated) + '个</span><span class="g-dot">·</span>' +
      '    <span>' + esc(g.timeText) + '</span></div>' +
      '</div>'
    ).join('');

    const hotCards = (d.hotList || []).map(h =>
      '<div class="g-card hot-card" data-act="open-hot-text" data-arg="' + esc(h.id) + '">' +
      '  <div class="g-top"><div class="g-name">' + esc(h.name) + '</div>' +
      (h.tag ? '<span class="g-tag">' + esc(h.tag) + '</span>' : '') + '</div>' +
      '  <div class="g-meta"><span class="g-count">' + esc(h.count) + '个点位</span><span class="g-dot">·</span>' +
      '    <span class="g-preview">' + esc(h.preview) + '</span></div>' +
      '</div>'
    ).join('');

    const pickerRows = (d.pickerRows || []).map(r =>
      '<div class="picker-row" data-act="toggle-picker" data-arg="' + esc(r.id) + '">' +
      '  <span class="picker-check' + (r.checked ? ' on' : '') + '">' + (r.checked ? '✓' : '') + '</span>' +
      '  <span class="picker-name">' + esc(r.name) + '</span>' +
      '  <span class="picker-count">' + esc(r.count) + ' 篇</span>' +
      '</div>'
    ).join('');

    return (
      '<div class="page-head">' +
      '  <div class="page-title">攻略</div>' +
      '  <div class="page-sub">共 ' + esc(d.totalCount) + ' 篇 · 已收藏 ' + esc(d.followedCount) + ' 篇</div>' +
      '</div>' +
      '<div class="seg">' +
      '  <button class="seg-item' + (isRecent ? ' on' : '') + '" data-act="switch-tab" data-arg="recent">最近</button>' +
      '  <button class="seg-item' + (!isRecent ? ' on' : '') + '" data-act="switch-tab" data-arg="hot">热门</button>' +
      '</div>' +

      (isRecent ?
        ((d.list || []).length ?
          '<div class="g-list">' + cards + '</div>' :
          '<div class="empty"><div class="empty-ic">🗺️</div>' +
          '<div class="empty-t">还没有攻略</div>' +
          '<div class="empty-s">把知乎、小红书、抖音的攻略正文粘到首页，一点解析就能标出点位地图</div>' +
          '<button class="btn btn-s" data-act="go-parse">去解析一篇</button></div>')
        :
        ((d.hotList || []).length ?
          '<div class="g-list">' + hotCards + '</div>' :
          '<div class="empty"><div class="empty-ic">🔥</div>' +
          '<div class="empty-t">热门攻略正在路上</div>' +
          '<div class="empty-s">等解析量攒起来，这里会按城市推荐大家都在看的攻略</div></div>')) +

      '<div class="bottom-space"></div>' +

      /* 设置弹层 */
      (d.sheetVisible && d.activeGuide ?
        '<div class="ui-mask in" data-act="close-sheet"></div>' +
        '<div class="ui-sheet in">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.activeGuide.name) + '</div>' +
        '    <button class="sheet-close" data-act="close-sheet">✕</button></div>' +
        '  <div class="sheet-rows">' +
        '    <button class="sheet-row" data-act="pin-guide">' +
        '      <span class="sheet-row-ic">📌</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">' + (d.activeGuide.pinned ? '取消置顶' : '置顶') + '</span>' +
        '      <span class="sheet-row-sub">常看的攻略排到最上面</span></span></button>' +
        '    <button class="sheet-row" data-act="rename-guide">' +
        '      <span class="sheet-row-ic">✏️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">重命名</span>' +
        '      <span class="sheet-row-sub">换个更好记的名字</span></span></button>' +
        '    <button class="sheet-row danger" data-act="delete-guide">' +
        '      <span class="sheet-row-ic">🗑️</span>' +
        '      <span class="sheet-row-main"><span class="sheet-row-title">删除这篇攻略</span>' +
        '      <span class="sheet-row-sub">已收藏的点位不会被删</span></span></button>' +
        '  </div>' +
        '  <div class="bottom-space"></div>' +
        '</div>' : '') +

      /* 全文弹层 */
      (d.textVisible ?
        '<div class="ui-mask in" data-act="close-text"></div>' +
        '<div class="ui-sheet in text-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.textTitle) + '</div>' +
        '    <button class="sheet-close" data-act="close-text">✕</button></div>' +
        (d.textEditing ?
          '<div class="text-edit-body">' +
          '  <textarea class="field-ta" id="textDraft" placeholder="粘贴或编辑这篇攻略的正文…">' + esc(d.textDraft) + '</textarea>' +
          '  <div class="text-edit-tip">改完点「保存」即写回这篇攻略</div>' +
          '</div>' +
          '<div class="text-actions">' +
          '  <button class="btn btn-s line" data-act="cancel-text-edit">取消</button>' +
          '  <button class="btn btn-s" data-act="save-text-edit">保存</button>' +
          '</div>'
          :
          '<div class="text-body"><div class="text-body-text">' + esc(d.textBody) + '</div>' +
          '  <div class="text-body-tip">要改内容就点下面的「修改攻略内容」，正文可以直接在这改，不用跳页</div></div>' +
          '<div class="text-actions">' +
          '  <button class="btn btn-s ghost" data-act="edit-text">✏️ 修改攻略内容</button>' +
          '  <button class="btn btn-s ghost" data-act="regen-text">' + (d.textBusy ? '处理中…' : '🔄 重新标点位') + '</button>' +
          '</div>') +
        '</div>' : '') +

      /* 热门正文弹层 */
      (d.hotTextVisible ?
        '<div class="ui-mask in" data-act="close-hot-text"></div>' +
        '<div class="ui-sheet in text-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.hotTextTitle) + '</div>' +
        '    <button class="sheet-close" data-act="close-hot-text">✕</button></div>' +
        '  <div class="text-body"><div class="text-body-text">' + esc(d.hotTextBody) + '</div></div>' +
        '  <div class="text-actions"><button class="btn" data-act="gen-hot-map">' + (d.hotBusy ? '处理中…' : '标到地图') + '</button></div>' +
        '</div>' : '') +

      /* 收藏提示 */
      (d.toastVisible ?
        '<div class="collect-toast show">' +
        '  <div class="ct-line2"><span class="ct-text">已收藏到</span>' +
        '    <button class="ct-name" data-act="open-toast-picker">攻略收藏 · ' + esc(d.toastName) + '</button></div>' +
        '</div>' : '') +

      /* 换夹弹层 */
      (d.pickerVisible ?
        '<div class="ui-mask in" data-act="close-picker"></div>' +
        '<div class="ui-sheet in picker-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">加入哪个收纳夹</div>' +
        '    <button class="sheet-done" data-act="close-picker">完成</button></div>' +
        '  <div class="picker-scroll">' + pickerRows +
        (pickerRows ? '' : '<div class="picker-empty">还没有收纳夹，先在收藏页建一个</div>') +
        '  </div>' +
        '</div>' : '')
    );
  },

  /* ============ 事件绑定 ============ */
  bind(root) {
    const ta = root.querySelector('#textDraft');
    if (ta) ta.addEventListener('input', () => this.onTextInput(ta.value));
    this.on(root, 'switch-tab', (e, tab) => this.switchTab(tab));
    this.on(root, 'open-map', (e, id) => this.openMap(id));
    this.on(root, 'quick-follow', (e, id) => this.quickFollow(id));
    this.on(root, 'open-text', (e, id) => this.openText(id));
    this.on(root, 'share-pack', (e, id) => this.onSharePack(id));
    this.on(root, 'open-sheet', (e, id) => this.openSheet(id));
    this.on(root, 'close-sheet', () => this.closeSheet());
    this.on(root, 'pin-guide', () => this.pinGuide());
    this.on(root, 'rename-guide', () => this.renameGuide());
    this.on(root, 'delete-guide', () => this.deleteGuide());
    this.on(root, 'close-text', () => this.closeText());
    this.on(root, 'edit-text', () => this.editTextGuide());
    this.on(root, 'cancel-text-edit', () => this.cancelTextEdit());
    this.on(root, 'save-text-edit', () => this.saveTextEdit());
    this.on(root, 'regen-text', () => this.regenTextGuide());
    this.on(root, 'open-hot-text', (e, id) => this.openHotText(id));
    this.on(root, 'close-hot-text', () => this.closeHotText());
    this.on(root, 'gen-hot-map', (e, id) => this.genHotMap(id));
    this.on(root, 'open-toast-picker', () => this.openToastPicker());
    this.on(root, 'close-picker', () => this.closePicker());
    this.on(root, 'toggle-picker', (e, id) => this.togglePickerRow(id));
    this.on(root, 'go-parse', () => router.navigate('/index'));
  }
};

export default mixin(page);
