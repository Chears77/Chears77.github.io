/**
 * pages/index.js —— 首页（网页版）
 *
 * 功能对齐小程序 index 页：
 *   · 粘贴攻略文本 → 本地解析 → 生成攻略 → 跳地图（只显示这一篇）
 *   · 最近解析列表 → 半屏查看 → 在地图中打开
 *   · 选现成热门行程（templates，零网络直出 / 实时解析两条路）
 *   · 链接识别提示 + 失败卡片
 * 差异：wx.* 全部换成 ui/router/store；api.analyze（已下线）改走 localparse.parseText。
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import guides from '../lib/guides.js';
import history from '../lib/history.js';
import device from '../lib/device.js';
import localparse from '../lib/localparse.js';
import templates from '../lib/templates.js';
import categories from '../lib/categories.js';

const MIN_ANALYZE_LEN = 10;

const page = {
  data: {
    guideContent: '',
    contentLen: 0,
    expanded: false,
    taH: 340,
    loading: false,
    shortTip: false,
    urlTip: false,
    recentList: [],
    tplSheetVisible: false,
    tplKw: '',
    tplList: [],
    viewing: null,
    showFailCard: false,
    failMsg: ''
  },

  /* ============ 生命周期 ============ */
  onLoad() {
    this._recentRaw = {};
    this._shortExpanded = false;
  },
  onShow() {
    this.loadRecent();
    this.setData({ tplList: templates.list().slice(0, 30) }, true);
  },

  /* ============ 输入 ============ */
  onGuide(v) {
    const isUrl = /^https?:\/\//i.test(v || '');
    this._shortExpanded = false;
    this.setData({
      guideContent: v,
      contentLen: (v || '').length,
      shortTip: !isUrl && (v || '').length > 0 && (v || '').length < MIN_ANALYZE_LEN,
      urlTip: isUrl
    }, true);
  },
  toggleExpand() {
    const next = !this.data.expanded;
    this.setData({ expanded: next, taH: next ? this.computeTaHeight(this.data.guideContent) : 340 }, true);
  },
  computeTaHeight(text) {
    const lines = String(text || '').split('\n').length;
    const vh = window.innerHeight || 700;
    return Math.max(340, Math.min(lines * 44 + 60, Math.round(vh * 0.62)));
  },
  clearGuide() {
    this.onGuide('');
  },
  copyLink() {
    const v = (this.data.guideContent || '').trim();
    if (!v) { ui.toast('内容框是空的', 'none'); return; }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      ui.toast('当前环境不支持复制，请手动选择复制', 'none');
      return;
    }
    navigator.clipboard.writeText(v)
      .then(() => ui.toast('已复制', 'success'))
      .catch(() => ui.toast('复制失败，请手动选择复制', 'none'));
  },

  /* ============ 解析主链路 ============ */
  async startAnalyze(opts) {
    const o = (opts && typeof opts === 'object' && !opts.type && !opts.currentTarget) ? opts : {};
    const input = (this.data.guideContent || '').trim();
    if (!input) { ui.toast('请先粘贴攻略内容', 'none'); return; }
    if (this.data.loading) return;
    const isUrl = /^https?:\/\//i.test(input);

    // 短文本：本地解析需要正文里有具体地名（R72 口径：不再调模型扩写）
    if (!isUrl && input.length < MIN_ANALYZE_LEN && !this._shortExpanded) {
      const go = await ui.modal({
        title: '内容太短了',
        content: '「' + input + '」只有 ' + input.length + ' 个字，解析需要正文里出现具体地名。可以多写几句行程，或从现成行程里挑一条。',
        confirmText: '挑现成行程',
        cancelText: '我自己写'
      });
      if (go) this.openTplSheet();
      return;
    }
    this._shortExpanded = false;
    this.setData({ loading: true, showFailCard: false }, true);
    ui.loading('正在提取地点…');
    this._stageTimer = setTimeout(() => { if (this.data.loading) ui.loading('正在定位坐标…'); }, 5000);

    try {
      // 网页版没有在线解析通道（R72 下线口径），一律走本地规则引擎；
      // 链接粘贴给出失败卡片（网页版抓不到跨域正文）
      if (isUrl) {
        ui.hideLoading();
        this.setData({ showFailCard: true, failMsg: '网页版读不了链接正文，请在浏览器里复制正文粘贴进来', loading: false }, true);
        return;
      }
      const r = await localparse.parseText(input);
      clearTimeout(this._stageTimer);
      if (r.code !== 0) {
        ui.hideLoading();
        ui.toast(r.code === 1003 ? '内容太少，读不出地点。多写几句具体地名，或从现成行程里挑一条' : (r.message || '解析失败，请稍后再试'), 'none');
        this.setData({ loading: false }, true);
        return;
      }
      const data = r.data || {};
      const points = (data.points || []).filter(p => p && p.name);
      if (!points.length) {
        ui.hideLoading();
        ui.toast(r.message || '没有从内容里识别出地点，请检查输入', 'none');
        this.setData({ loading: false }, true);
        return;
      }

      const guide = guides.create({
        deviceId: device.getDeviceId(),
        name: (o.title || data.title || '').trim() || '我的点位地图',
        sourceUrl: '',
        sourceTitle: data.sourceTitle || '',
        rawText: input,
        city: (data.regionHint || data.title || '').slice(0, 30) || '',
        routeCenter: data.routeCenter || null,
        points: points.map(p => ({
          name: p.name,
          category: p.category,
          group: p.group || '',
          section: p.section || '',
          primary: p.primary !== false,
          reason: p.reason,
          quote: p.quote,
          imageUrls: (p.imageUrls || []).slice(0, 6),
          colorOverride: p.colorOverride || '',
          latitude: p.latitude,
          longitude: p.longitude,
          located: p.located
        }))
      });
      store.set('current_map', guide);
      history.upsert(guide);
      store.set('guide_refresh_token', { token: Date.now() });
      store.set('map_refresh_token', { token: Date.now(), source: 'parse' });
      if (o.isolate !== false) {
        guides.setSoloVisible(guide.id);
        store.set('map_isolate_guide', { id: guide.id, name: guide.name });
        store.set('map_fit_guide', guide.id);
      }
      ui.hideLoading();
      const locatedCount = points.filter(p => p.located).length;
      this.loadRecent();
      this.setData({ loading: false, guideContent: '', contentLen: 0, shortTip: false, urlTip: false }, true);
      if (locatedCount === 0) {
        ui.toast('识别出 ' + points.length + ' 个地点但都没定位到，可进地图后手动补坐标', 'none');
      } else if (locatedCount < points.length) {
        ui.toast('已标出 ' + points.length + ' 个点位（' + locatedCount + ' 个已定位）', 'none');
      }
      router.navigate('/map');
    } catch (e) {
      clearTimeout(this._stageTimer);
      ui.hideLoading();
      ui.toast('解析出错：' + (e && e.message ? e.message : '未知错误'), 'none');
      this.setData({ loading: false }, true);
    }
  },

  /* ============ 现成行程弹层 ============ */
  gotoHotGuides() { this.openTplSheet(); },
  openTplSheet() { this.setData({ tplSheetVisible: true, tplList: this.filterTpl('') }, true); },
  closeTplSheet() { this.setData({ tplSheetVisible: false }, true); },
  onTplKw(v) { this.setData({ tplKw: v, tplList: this.filterTpl(v) }, true); },
  clearTplKw() { this.onTplKw(''); },
  filterTpl(kw) {
    const k = String(kw || '').trim();
    const all = templates.list();
    if (!k) return all.slice(0, 30);
    return templates.search(k).slice(0, 30);
  },
  async pickTpl(id) {
    if (this.data.loading) return;
    const t = templates.get(id);
    if (!t) return;
    // ① 零网络直出
    if (templates.fullyBaked(id)) {
      const points = templates.pointsOf(id);
      if (points.length) {
        const title = templates.tripTitle(t);
        const guide = guides.create({
          deviceId: device.getDeviceId(),
          name: title,
          sourceUrl: '', sourceTitle: title,
          rawText: templates.textOf(id),
          city: (t.name || title).slice(0, 30) || '',
          routeCenter: templates.centerOf(points),
          points
        });
        store.set('current_map', guide);
        history.upsert(guide);
        store.set('guide_refresh_token', { token: Date.now() });
        store.set('map_refresh_token', { token: Date.now(), source: 'parse' });
        guides.setSoloVisible(guide.id);
        store.set('map_isolate_guide', { id: guide.id, name: guide.name });
        store.set('map_fit_guide', guide.id);
        this.setData({ guideContent: '', contentLen: 0, shortTip: false, tplSheetVisible: false }, true);
        this.loadRecent();
        ui.toast('已标出 ' + points.length + ' 个点位', 'none');
        router.navigate('/map');
        return;
      }
    }
    // ② 兜底：文本回填 + 实时解析
    const text = templates.textOf(id);
    const title = t.name + t.days + '日行程';
    this._shortExpanded = true;
    this.setData({ guideContent: text, contentLen: text.length, shortTip: false, tplSheetVisible: false }, true);
    this.startAnalyze({ title, isolate: true });
  },

  /* ============ 最近解析 ============ */
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
  loadRecent() {
    this._recentRaw = this._recentRaw || {};
    const list = guides.getList().slice(0, 5).map((g) => {
      this._recentRaw[g.id] = g;
      return {
        key: g.id,
        name: g.name || '未命名攻略',
        count: (g.points || []).length,
        timeText: this.timeText(g.updateTime || g.createTime)
      };
    });
    this.setData({ recentList: list }, true);
  },
  openRecent(key) {
    const item = this.data.recentList.find(x => x.key === key);
    if (!item) return;
    const m = (this._recentRaw && this._recentRaw[key]) || guides.getById(key) || {};
    const rows = (m.points || []).filter(p => p && p.name).map((p, idx) => ({
      idx,
      name: p.name,
      reason: p.reason || p.quote || '',
      color: p.colorOverride || categories.colorOf(p.category)
    }));
    this._viewRaw = m;
    this.setData({
      viewing: {
        key, name: item.name, count: item.count, timeText: item.timeText,
        text: m.rawText || '', rows
      }
    }, true);
  },
  closeView() { this.setData({ viewing: null }, true); },
  openViewMap() {
    const v = this.data.viewing;
    if (!v) return;
    const raw = this._viewRaw || {};
    const gid = v.key || raw.id || '';
    if (gid) {
      guides.setCurrent(gid);
      guides.setSoloVisible(gid);
      store.set('map_isolate_guide', { id: gid, name: raw.name || v.name || '未命名攻略' });
      store.set('map_fit_guide', gid);
      store.set('map_layer_intent', 'guide');
    }
    store.set('guide_refresh_token', { token: Date.now() });
    this.setData({ viewing: null }, true);
    router.navigate('/map');
  },
  closeFail() { this.setData({ showFailCard: false }, true); },

  /* ============ 渲染 ============ */
  render() {
    const d = this.data;
    const taStyle = d.expanded ? 'height:' + d.taH + 'px' : 'height:340px';
    const tplRows = (d.tplList || []).map(t =>
      '<div class="li" data-act="pick-tpl" data-arg="' + esc(t.id) + '">' +
      '  <div class="li-main"><div class="li-t">' + esc(t.name) + '</div>' +
      '    <div class="li-s">' + esc(t.tag || '') + '</div></div>' +
      '  <span class="tag green">' + esc(t.days) + ' 日</span>' +
      '  <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
      '</div>'
    ).join('');

    const recentRows = (d.recentList || []).map(r =>
      '<div class="li" data-act="open-recent" data-arg="' + esc(r.key) + '">' +
      '  <div class="li-main"><div class="li-t">' + esc(r.name) + '</div>' +
      '    <div class="li-s">' + esc(r.count) + ' 个点位 · ' + esc(r.timeText) + '</div></div>' +
      '  <svg class="li-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
      '</div>'
    ).join('');

    const viewRows = (d.viewing && d.viewing.rows || []).map(r =>
      '<div class="pt-row"><span class="pt-dot" style="background:' + esc(r.color || '#12B76A') + '"></span>' +
      '<div class="pt-main"><div class="pt-name">' + esc(r.name) + '</div>' +
      (r.reason ? '<div class="pt-reason">' + esc(r.reason) + '</div>' : '') + '</div></div>'
    ).join('');

    return (
      '<div class="brandhead">' +
      '  <div class="brandhead-row">' +
      '    <div class="brandhead-logo">觅</div>' +
      '    <div><div class="brandhead-name">觅点寻迹</div>' +
      '    <div class="brandhead-slogan">攻略点位地图 · 粘贴攻略文本，推荐地点自动标上地图</div></div>' +
      '  </div>' +
      '</div>' +

      '<div class="card card-pad">' +
      '  <div class="field-l"><span class="tag green">第一步</span> 把攻略标到地图</div>' +
      '  <div class="ta-wrap">' +
      '    <textarea class="field-ta guide-input" id="guideInput" style="' + taStyle + '" placeholder="把攻略文本粘贴到这里（出行安排、景点清单都可以）">' + esc(d.guideContent) + '</textarea>' +
      '  </div>' +
      (d.shortTip ? '<div class="short-tip">内容太少，识别不出地点。多写几句具体地名，例如「第一天 宽窄巷子、武侯祠」</div>' : '') +
      (d.urlTip ? '<div class="short-tip">网页版读不了网页正文。请在浏览器里复制正文粘贴进来，或点「选现成行程」挑一条</div>' : '') +
      '  <div class="ta-foot">' +
      '    <span class="ta-count">' + esc(d.contentLen) + ' 字</span>' +
      '    <span class="ta-foot-btns">' +
      '      <button class="btn-s line" data-act="toggle-expand">' + (d.expanded ? '收起' : '扩框') + '</button>' +
      '      <button class="btn-s line" data-act="clear-guide">清空</button>' +
      '      <button class="btn-s line" data-act="copy-link">复制</button>' +
      '    </span>' +
      '  </div>' +
      '  <button class="btn block" data-act="start-analyze" ' + (d.loading ? 'disabled' : '') + '>' + (d.loading ? '正在解析…' : '攻略解析') + '</button>' +
      '  <div class="no-guide">没有攻略，选现成<span class="no-guide-link" data-act="open-tpl">热门攻略</span></div>' +
      '</div>' +

      (d.showFailCard ?
        '<div class="card card-pad fail-card">' +
        '  <div class="fail-title">这个链接暂时无法自动读取</div>' +
        '  <div class="fail-msg">' + esc(d.failMsg) + '</div>' +
        '  <div class="fail-actions">' +
        '    <button class="btn btn-s" data-act="open-tpl">选现成行程</button>' +
        '    <button class="btn-s line" data-act="close-fail">关闭</button>' +
        '  </div>' +
        '  <div class="fail-tip">在浏览器里打开链接，全选正文复制，再粘贴到上面的内容框</div>' +
        '</div>' : '') +

      ((d.recentList || []).length ?
        '<div class="card">' +
        '  <div class="card-pad" style="padding-bottom:6px"><div class="field-l"><span class="tag">最近</span> 最近解析</div></div>' +
        '  <div class="list" style="margin:0;box-shadow:none">' + recentRows + '</div>' +
        '</div>' : '') +

      (d.tplSheetVisible ?
        '<div class="ui-mask in" data-act="close-tpl"></div>' +
        '<div class="ui-sheet in tpl-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">选现成行程</div>' +
        '    <button class="sheet-close" data-act="close-tpl">✕</button></div>' +
        '  <div class="tpl-sub">选一个现成行程，自动标上地图。全程免费，不用填任何 Key</div>' +
        '  <div class="tpl-search">' +
        '    <input class="field-input" id="tplKw" placeholder="搜城市，如「成都」「川西」" value="' + esc(d.tplKw) + '">' +
        '  </div>' +
        '  <div class="tpl-body">' + tplRows +
        (tplRows ? '' : '<div class="empty"><div class="empty-t">没有匹配的行程，换个词试试</div></div>') +
        '  </div>' +
        '  <div class="tpl-foot">想让行程更贴身？把你要去的具体地名写进上面的内容框，再点「攻略解析」</div>' +
        '</div>' : '') +

      (d.viewing ?
        '<div class="ui-mask in" data-act="close-view"></div>' +
        '<div class="ui-sheet in view-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="sheet-head"><div class="sheet-title">' + esc(d.viewing.name) + '</div>' +
        '    <button class="sheet-close" data-act="close-view">✕</button></div>' +
        '  <div class="sheet-meta">' + esc(d.viewing.count) + ' 个点位 · ' + esc(d.viewing.timeText) + '</div>' +
        '  <div class="sheet-body">' +
        (d.viewing.text ? '<div class="gt-text">' + esc(d.viewing.text) + '</div>' : '') +
        viewRows +
        '  </div>' +
        '  <div style="padding:12px"><button class="btn block" style="margin:0" data-act="open-view-map">在地图中打开</button></div>' +
        '</div>' : '') +

      '<div class="bottom-space"></div>'
    );
  },

  /* ============ 事件绑定 ============ */
  bind(root) {
    // 输入框：受控但不重渲染（避免打断输入）
    const ta = root.querySelector('#guideInput');
    if (ta) {
      ta.addEventListener('input', () => this.onGuide(ta.value));
      ta.addEventListener('blur', () => this.rerender());
    }
    const kw = root.querySelector('#tplKw');
    if (kw) {
      kw.addEventListener('input', () => this.onTplKw(kw.value));
    }
    this.on(root, 'start-analyze', () => this.startAnalyze());
    this.on(root, 'toggle-expand', () => this.toggleExpand());
    this.on(root, 'clear-guide', () => this.clearGuide());
    this.on(root, 'copy-link', () => this.copyLink());
    this.on(root, 'open-tpl', () => this.openTplSheet());
    this.on(root, 'close-tpl', () => this.closeTplSheet());
    this.on(root, 'pick-tpl', (e, id) => this.pickTpl(id));
    this.on(root, 'open-recent', (e, key) => this.openRecent(key));
    this.on(root, 'close-view', () => this.closeView());
    this.on(root, 'open-view-map', () => this.openViewMap());
    this.on(root, 'close-fail', () => this.closeFail());
  }
};

export default mixin(page);
