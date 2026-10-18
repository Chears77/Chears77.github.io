/**
 * pages/mine.js —— 我的（网页版）
 *
 * 功能对齐小程序 mine 页：
 *   · 用户卡（头像 / 昵称 / 资料修改）—— 头像改用本机文件选择，存 IndexedDB
 *   · 数据统计三格（解析攻略 / 收藏攻略 / 收藏点位）
 *   · 数据管理：导出（.mgbak 含图片 / .json / .kml / .csv，网页版全部走浏览器下载）、
 *     导入（粘贴或选本地文件，四种格式自动识别）、清除本地数据
 *   · 其他：地图 Key 设置 / 服务状态自检 / 联系我们
 *
 * 与小程序的关键差异：
 *   · 头像/图片存「图片 id」（img_xxx），渲染时 store.img.url(id) 异步换 dataURL
 *   · 导出不再有「通过微信发送 / 保存到电脑」分支 —— 网页版统一 Blob 下载
 *   · 导入不再需要「先发到微信聊天」—— 浏览器可直接读本地文件
 *   · 无「扫一扫识别」（网页没有扫码能力），二维码海报靠导入文件/粘贴码
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import favorites from '../lib/favorites.js';
import guides from '../lib/guides.js';
import follow from '../lib/follow.js';
import share from '../lib/share.js';
import qqmap from '../lib/qqmap.js';
import geosearch from '../lib/geosearch.js';
import imgpack from '../lib/imgpack.js';
import dl from '../dl.js';

const VERSION = 'v1.0.0';
const CONTACT_MAIL = 'chears77@163.com';

/** UTF-8 字节数（浏览器有 Blob，这里仍保留一个轻量实现用于「内容过大」提示） */
function byteLen(s) {
  const str = String(s || '');
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** 触发下载（网页 Blob / 安卓壳原生桥双通道，见 js/dl.js） */
async function downloadText(fileName, text) {
  await dl.saveText(fileName || 'export.txt', text);
}

/** 读取本地文件为文本（替代 wx.chooseMessageFile + fs.readFile） */
function pickLocalText(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept || '.json,.kml,.csv,.mgbak,.txt';
    inp.onchange = () => {
      const f = (inp.files || [])[0];
      if (!f) { resolve(null); return; }
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result || ''));
      rd.onerror = () => resolve(null);
      rd.readAsText(f, 'utf8');
    };
    inp.click();
  });
}

/** 读取本地图片为 dataURL（头像用） */
function pickLocalImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = (inp.files || [])[0];
      if (!f) { resolve(''); return; }
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result || ''));
      rd.onerror = () => resolve('');
      rd.readAsDataURL(f);
    };
    inp.click();
  });
}

/** 收集备份对象里引用的所有图片 id（清除数据时连图一起删） */
function collectImgIds() {
  const ids = [];
  const seen = {};
  const add = (arr) => {
    for (const u of (arr || [])) {
      const s = String(u || '').trim();
      if (s && !seen[s]) { seen[s] = 1; ids.push(s); }
    }
  };
  const walk = (nodes) => {
    for (const n of (nodes || [])) {
      for (const p of (n.points || [])) add(p.imageUrls);
      walk(n.children || []);
    }
  };
  const fav = store.get('my_favorites');
  walk((fav && fav.tree) || []);
  for (const g of (store.get('my_guides') || [])) {
    for (const p of (g.points || [])) add(p.imageUrls);
  }
  return ids;
}

const page = {
  data: {
    version: VERSION,
    logged: false,
    avatarUrl: '',
    avatarText: '',
    nickName: '',
    bio: '',
    profileReady: false,
    peVisible: false,
    peAvatar: '',
    peNick: '',
    peBio: '',
    // 统计
    statGuides: 0,
    statFollow: 0,
    statPoints: 0,
    storeSize: '',
    // 导入
    importVisible: false,
    importText: '',
    // 导出格式选择
    exVisible: false,
    // 地图 Key 设置弹层
    mapFormVisible: false,
    kQqmap: '',
    kAmap: '',
    mapKeyOn: false,
    // 服务状态自检
    diagVisible: false,
    diagRunning: false,
    diagRows: [],
    diagSummary: ''
  },

  onLoad() {
    this.loadProfile();
    this.loadStats();
  },

  onShow() {
    // 网页版 loading 默认不带 mask，不存在 R84 的遮罩悬挂；这里仅兜底清残留
    ui.forceHideLoading();
    this.loadStats();
    this.loadProfile();
  },

  /* ============ 用户卡 / 资料 ============ */
  loadProfile() {
    const p = store.get('user_profile') || {};
    this.setData({
      logged: !!p.nickName,
      avatarUrl: '',
      nickName: p.nickName || '',
      bio: p.bio || '',
      avatarText: (p.nickName || '我').slice(0, 1),
      profileReady: !!p.nickName
    });
    // 头像是异步资源：先渲染，取到 dataURL 再补一次（避免整页等 IndexedDB）
    if (p.avatarId) {
      store.img.url(p.avatarId).then((url) => {
        if (url) this.setData({ avatarUrl: url });
      }).catch(() => { /* ignore */ });
    }
  },

  /** 点头像 → 选本地图片（替代 open-type="chooseAvatar"） */
  async pickAvatar() {
    const dataUrl = await pickLocalImage();
    if (!dataUrl) return;
    const id = await store.img.save(dataUrl).catch(() => '');
    if (!id) { ui.toast('头像保存失败', 'none'); return; }
    const p = store.get('user_profile') || {};
    p.avatarId = id;
    p.avatarUrl = '';
    store.set('user_profile', p);
    this.setData({ avatarUrl: dataUrl, logged: true });
    ui.toast('头像已更新', 'success');
  },

  openProfileEditor() {
    this.setData({
      peVisible: true,
      peAvatar: this.data.avatarUrl,
      peNick: this.data.nickName,
      peBio: this.data.bio
    });
  },
  closeProfileEditor() { this.setData({ peVisible: false }); },

  async pickPeAvatar() {
    const dataUrl = await pickLocalImage();
    if (!dataUrl) return;
    this.setData({ peAvatar: dataUrl });
  },

  saveProfileEditor() {
    const nick = (this.data.peNick || '').trim();
    const bio = (this.data.peBio || '').trim();
    const prev = store.get('user_profile') || {};
    const p = { nickName: nick, bio, avatarId: prev.avatarId || '', avatarUrl: '' };
    // 弹层里新选了头像：把 dataURL 落成 id 再存
    if (this.data.peAvatar && this.data.peAvatar.indexOf('data:') === 0) {
      store.img.save(this.data.peAvatar).then((id) => {
        if (id) p.avatarId = id;
        store.set('user_profile', p);
        this._afterProfileSaved(nick, bio);
      }).catch(() => {
        store.set('user_profile', p);
        this._afterProfileSaved(nick, bio);
      });
    } else {
      store.set('user_profile', p);
      this._afterProfileSaved(nick, bio);
    }
  },

  _afterProfileSaved(nick, bio) {
    this.setData({
      peVisible: false,
      logged: !!nick,
      nickName: nick,
      bio,
      avatarText: (nick || '我').slice(0, 1),
      profileReady: !!nick
    });
    if (this.data.peAvatar && this.data.peAvatar.indexOf('data:') === 0) {
      this.setData({ avatarUrl: this.data.peAvatar });
    }
    ui.toast('已保存', 'success');
  },

  /* ============ 统计 ============ */
  loadStats() {
    const list = guides.getList();
    const followCount = (list || []).filter(g => follow.isFollowed(g.id)).length;
    let pointCount = 0;
    const walk = (nodes) => {
      for (const n of (nodes || [])) {
        pointCount += (n.points || []).length;
        walk(n.children || []);
      }
    };
    walk(favorites.getTree());
    this.setData({
      statGuides: list.length,
      statFollow: followCount,
      statPoints: pointCount
    });
    this.calcStoreSize();
  },

  calcStoreSize() {
    try {
      const keys = ['my_favorites', 'my_guides', 'follow_store', 'geo_cache', 'geosearch_cache', 'custom_categories'];
      let n = 0;
      for (const k of keys) {
        const v = store.get(k);
        n += v ? JSON.stringify(v).length : 0;
      }
      this.setData({ storeSize: n > 0 ? (n / 1024 / 1024).toFixed(1) + ' MB' : '' });
    } catch (e) { this.setData({ storeSize: '' }); }
  },

  goStat(e) {
    const to = (e && e.getAttribute) ? (e.getAttribute('data-arg') || '') : '';
    if (to === 'guides') {
      store.set('pending_guides_tab', 'recent');
      router.navigate('/guides');
      return;
    }
    store.set('fav_open_tab', to === 'favGuide' ? 'guide' : 'point');
    router.navigate('/favorites');
  },

  /* ============ 导出 ============ */
  exportData() { this.setData({ exVisible: true }); },
  closeExport() { this.setData({ exVisible: false }); },

  pickExport(e) {
    const fmt = (e && e.getAttribute) ? (e.getAttribute('data-arg') || '') : '';
    this.setData({ exVisible: false });
    if (fmt === 'mgbak') this.exportBackup(true);
    else if (fmt === 'json') this.exportBackup(false);
    else if (fmt === 'kml') this.exportKml('all');
    else if (fmt === 'csv') this.exportCsv('all');
  },

  exportBackup(withImages) {
    const payload = {
      app: 'guide-map',
      fmt: withImages ? 'mgbak' : 'json',
      version: 2,
      exportTime: Date.now(),
      favorites: store.get('my_favorites') || null,
      guides: store.get('my_guides') || null,
      followStore: store.get('follow_store') || null,
      categories: store.get('custom_categories') || null
    };
    const fileName = withImages ? 'guide-map-backup.mgbak' : 'guide-map-backup.json';

    if (!withImages) {
      const text = JSON.stringify(payload);
      return this.offerExport(
        text,
        '完整备份（纯数据）',
        '收藏夹 / 攻略 / 收纳夹 / 自定义分类已打包，可完整还原。\n'
          + '⚠ 这份不带图片本体，只带图片引用；换设备后图片会失效。\n'
          + '要连图片一起带走，请选「完整备份 · 含图片」。',
        fileName
      );
    }

    // 带图片：图片 id 已在 IndexedDB，直接打包成 base64 池
    const urls = imgpack.collectUrls(payload);
    if (!urls.length) {
      const text = JSON.stringify(payload);
      return this.offerExport(
        text,
        '完整备份（含图片）',
        '收藏夹 / 攻略 / 收纳夹 / 自定义分类已打包，可完整还原。\n当前还没有图片，所以这份只有数据。',
        fileName,
        { packed: 0, skipped: 0, total: 0 }
      );
    }
    ui.loading('正在打包图片…');
    imgpack.pack(urls).then((r) => {
      ui.hideLoading();
      payload.imgs = r.imgs;
      const text = JSON.stringify(payload);
      this.offerExport(
        text,
        '完整备份（含图片）',
        '收藏夹 / 攻略 / 收纳夹 / 自定义分类 + 图片已打包，导入网页版 / 小程序可完整还原（图片直接能看）。',
        fileName,
        r
      );
    }).catch(() => {
      ui.hideLoading();
      ui.toast('图片打包失败，请重试', 'none');
    });
  },

  /**
   * 导出结果弹层（网页版）：确认 = 下载文件；取消 = 复制文本（不大时）。
   * 不再有微信发送 / 存本机分支 —— 浏览器下载就是唯一且可靠的出路。
   */
  async offerExport(text, title, content, fileName, stat) {
    const size = byteLen(text);
    const tooBig = size > 120 * 1024;
    let body = content || '';
    if (stat && stat.total) {
      body += '\n\n图片：共 ' + stat.total + ' 张，已打包 ' + stat.packed + ' 张';
      body += stat.skipped
        ? ('，跳过 ' + stat.skipped + ' 张（读取失败，这些保留原引用）。')
        : '。';
    }
    if (tooBig) {
      body = ('共 ' + (size / 1024).toFixed(1) + ' KB，文本可能过大，建议下载文件。\n\n') + body;
    }
    const ok = await ui.modal({
      title: tooBig ? '内容较大，建议下载文件' : title,
      content: body,
      confirmText: '下载文件',
      cancelText: tooBig ? '知道了' : '复制文本',
      confirmColor: '#12B76A'
    });
    if (ok) {
      downloadText(fileName, text);
      ui.toast('已开始下载', 'success');
      return;
    }
    if (!tooBig) {
      try {
        await navigator.clipboard.writeText(text);
        ui.toast('已复制', 'success');
      } catch (err) {
        ui.toast('复制失败，请改用下载文件', 'none');
      }
    }
  },

  /** ② CSV 表格：Excel / WPS 直接可开（带 BOM，中文不乱码） */
  exportCsv(kind) {
    const rows = [];
    const cell = (v) => {
      const s = (v == null ? '' : String(v)).replace(/"/g, '""');
      return /[",\n]/.test(s) ? '"' + s + '"' : s;
    };
    const all = kind === 'all';
    const head = all
      ? ['类型', '名称', '分类', '纬度', '经度', '备注', '所属收藏夹', '所属攻略', '来源链接']
      : ['名称', '分类', '纬度', '经度', '备注', '所属收藏夹', '所属攻略', '来源链接'];
    rows.push(head.map(cell).join(','));

    let nFav = 0;
    let nGuide = 0;
    if (kind === 'fav' || all) {
      const walk = (nodes, trail) => {
        for (const n of (nodes || [])) {
          const path = trail ? trail + ' / ' + n.name : n.name;
          for (const p of (n.points || [])) {
            const body = [
              p.name, p.category || '', p.latitude || '', p.longitude || '',
              p.note || p.reason || '', path, p.fromGuideName || '', ''
            ];
            rows.push((all ? ['收藏'].concat(body) : body).map(cell).join(','));
            nFav++;
          }
          walk(n.children || [], path);
        }
      };
      walk(favorites.getTree(), '');
    }
    if (kind === 'guide' || all) {
      for (const g of guides.getList()) {
        for (const p of (g.points || [])) {
          const body = [
            p.name, p.category || '', p.latitude || '', p.longitude || '',
            p.reason || '', '', g.name || '', g.sourceUrl || ''
          ];
          rows.push((all ? ['攻略'].concat(body) : body).map(cell).join(','));
          nGuide++;
        }
      }
    }

    if (rows.length === 1) {
      ui.toast(all ? '还没有任何点位' : (kind === 'fav' ? '还没有收藏点位' : '还没有攻略点位'), 'none');
      return;
    }
    this.offerExport(
      '\ufeff' + rows.join('\n'),
      'CSV 表格已生成',
      '共 ' + (rows.length - 1) + ' 条点位'
        + (all ? ('（收藏 ' + nFav + ' 条 · 攻略 ' + nGuide + ' 条）') : '')
        + '。表头：' + head.join(' / ') + '。\n可直接粘贴进 Excel / WPS。⚠ CSV 是纯表格，不带图片。',
      all ? 'all-points.csv' : (kind + '-points.csv')
    );
  },

  _xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _xmlUnesc(s) {
    return String(s || '')
      .replace(/&lt;img[\s\S]*?&gt;/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  },

  /** ③ KML 地图标记：按收藏夹/攻略分组，点位带备注与图片链接 */
  exportKml(kind) {
    const items = [];
    const all = kind === 'all';
    if (kind === 'fav' || all) {
      const walk = (nodes, trail) => {
        for (const n of (nodes || [])) {
          const path = trail ? trail + ' / ' + n.name : n.name;
          for (const p of (n.points || [])) {
            items.push({
              name: p.name, latitude: p.latitude, longitude: p.longitude,
              desc: p.note || p.reason || '', imgs: p.imageUrls || [],
              folder: all ? ('收藏 · ' + path) : path
            });
          }
          walk(n.children || [], path);
        }
      };
      walk(favorites.getTree(), '');
    }
    if (kind === 'guide' || all) {
      for (const g of guides.getList()) {
        for (const p of (g.points || [])) {
          items.push({
            name: p.name, latitude: p.latitude, longitude: p.longitude,
            desc: p.reason || '', imgs: p.imageUrls || [],
            folder: all ? ('攻略 · ' + (g.name || '')) : (g.name || '')
          });
        }
      }
    }

    // KML 只装得下有坐标的点位（没定位的点导出也没意义）
    const valid = items.filter(it => it.latitude && it.longitude);
    if (!valid.length) {
      ui.toast({
        title: all ? '还没有已定位的点位' : (kind === 'fav' ? '还没有已定位的收藏点位' : '还没有已定位的攻略点位'),
        icon: 'none'
      });
      return;
    }

    const groups = {};
    const order = [];
    for (const it of valid) {
      const k = it.folder || '未分类';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(it);
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    xml += '  <Document>\n';
    xml += '    <name>' + this._xmlEsc(all ? '我的地点' : (kind === 'fav' ? '我的收藏点位' : '攻略点位')) + '</name>\n';
    for (const gname of order) {
      xml += '    <Folder>\n';
      xml += '      <name>' + this._xmlEsc(gname) + '</name>\n';
      for (const it of groups[gname]) {
        xml += '      <Placemark>\n';
        xml += '        <name>' + this._xmlEsc(it.name) + '</name>\n';
        let desc = this._xmlEsc(it.desc);
        for (const u of (it.imgs || []).slice(0, 3)) {
          if (u && String(u).indexOf('http') === 0) {
            desc += (desc ? '\n' : '') + '&lt;img src="' + this._xmlEsc(u) + '" width="300"/&gt;';
          }
        }
        if (desc) xml += '        <description>' + desc + '</description>\n';
        xml += '        <Point><coordinates>' + it.longitude + ',' + it.latitude + ',0</coordinates></Point>\n';
        xml += '      </Placemark>\n';
      }
      xml += '    </Folder>\n';
    }
    xml += '  </Document>\n';
    xml += '</kml>';

    this.offerExport(
      xml,
      'KML 地图标记已生成',
      '共 ' + valid.length + ' 个点位（' + order.length + ' 个分组）。\n\n'
        + '可用 Google Earth / 奥维地图 / 两步路 打开；\n'
        + '也能再导回「导入数据」里（只带回点位和备注）。\n'
        + '⚠ KML 只能带**网络图片**链接，本机图片带不走 —— 要连图一起带走请用「完整备份 · 含图片」。',
      all ? 'all-points.kml' : (kind + '-points.kml')
    );
  },

  /* ============ 导入 ============ */
  openImport() { this.setData({ importVisible: true, importText: '' }); },
  closeImport() { this.setData({ importVisible: false, importText: '' }); },
  onImportInput(v) { this.setData({ importText: v }); },

  async confirmImport() {
    let raw = (this.data.importText || '').trim().replace(/^\ufeff/, '');
    if (!raw) { await this.pickImportFile(); return; }

    if (share.isShareCode(raw)) return this.importShareCode(raw);
    if (share.isImgEnvelope(raw)) return this.importImgEnvelope(raw);
    if (raw[0] === '{' || raw[0] === '[') return this.importJson(raw);
    if (/^\s*<\?xml|<kml[\s>]/i.test(raw)) return this.importKml(raw);
    return this.importCsv(raw);
  },

  /** 选本地文件（网页版可直接读，无需先发微信聊天） */
  async pickImportFile() {
    const text = await pickLocalText('.json,.kml,.csv,.mgbak,.txt');
    if (text == null) return;   // 用户取消
    this.setData({ importText: text });
    await this.confirmImport();
  },

  importShareCode(raw) {
    const r = share.unpackCode(raw);
    if (!r.ok) {
      ui.toast('分享码不完整或已损坏，请让好友重新复制一次', 'none');
      return;
    }
    const res = share.importPack(raw);
    if (!res.ok) { ui.toast('导入失败', 'none'); return; }
    store.set('guide_refresh_token', { token: Date.now() });
    ui.toast('已收到《' + r.data.name + '》', 'none');
    this.afterImport();
  },

  /** ①-c 带图分享信封：解信封 → 落成攻略 → 还原图片 */
  async importImgEnvelope(raw) {
    const peek = (() => {
      try { return share.unpackCode(share.parseImgEnvelope(raw).code); } catch (e) { return null; }
    })();
    const name = (peek && peek.ok && peek.data && peek.data.name) || '好友带图分享';
    const ok = await ui.modal({
      title: '收到带图分享',
      content: '「' + name + '」将保存为一篇攻略并标到地图。里面的图片会一起还原，可直接查看。',
      confirmText: '导入',
      confirmColor: '#12B76A'
    });
    if (!ok) return;
    ui.loading('正在导入…');
    try {
      const res = await share.importEnvelope(raw);
      ui.hideLoading();
      if (!res.ok) {
        ui.toast('信封损坏，请让好友重新发一次', 'none');
        return;
      }
      store.set('guide_refresh_token', { token: Date.now() });
      this.afterImport();
      const imgLine = res.hasImage
        ? ('\n图片：还原 ' + res.restored + ' 张' + (res.failed ? ('，' + res.failed + ' 张写入失败') : '。'))
        : '';
      ui.modal({
        title: '导入完成',
        content: '已收到《' + name + '》，共 ' + res.count + ' 个点位。' + imgLine,
        showCancel: false,
        confirmText: '知道了'
      });
    } catch (e) {
      ui.hideLoading();
      ui.toast('导入失败，请重试', 'none');
    }
  },

  importJson(raw) {
    let data = null;
    try { data = JSON.parse(raw); } catch (e) {
      ui.toast('内容不是有效的备份数据', 'none');
      return;
    }
    if (!data || data.app !== 'guide-map') {
      ui.toast('没有找到地点数据，请粘贴导出的原文', 'none');
      return;
    }
    if (data.fmt === 'mgbak') return this.importBackup(data);
    ui.modal({
      title: '确认导入？',
      content: '将覆盖本机的收藏夹、攻略、收纳夹与自定义分类（头像昵称与 Key 设置不受影响）。'
        + '\n⚠ 这份是纯数据备份，不带图片本体；图片引用换设备后会失效。',
      confirmColor: '#12B76A'
    }).then((r) => {
      if (!r) return;
      if (data.favorites) store.set('my_favorites', data.favorites);
      if (data.guides) store.set('my_guides', data.guides);
      if (data.followStore) store.set('follow_store', data.followStore);
      if (data.categories) store.set('custom_categories', data.categories);
      this.afterImport();
    });
  },

  /** ①-b 含图片的完整备份：写存储 → 还原图片 → 改写引用 → 再写一次存储 → 出报告 */
  async importBackup(data) {
    const imgCount = (data.imgs && Object.keys(data.imgs).length) || 0;
    const nFav = ((data.favorites && data.favorites.tree) || []).length;
    const nGuide = (data.guides || []).length;
    let nPts = 0;
    const countPts = (nodes) => {
      for (const nd of (nodes || [])) {
        nPts += ((nd && nd.points) || []).length;
        countPts((nd && nd.children) || []);
      }
    };
    countPts((data.favorites && data.favorites.tree) || []);
    for (const g of (data.guides || [])) nPts += (g.points || []).length;

    const ok = await ui.modal({
      title: '导入这份备份？',
      content: '备份内容：' + nFav + ' 个收藏夹 · ' + nGuide + ' 篇攻略 · ' + nPts + ' 个点位'
        + (imgCount ? (' · ' + imgCount + ' 张图片') : '')
        + '\n\n将覆盖本机的收藏夹、攻略、收纳夹与自定义分类（头像昵称与 Key 设置不受影响）。',
      confirmColor: '#12B76A',
      confirmText: '导入'
    });
    if (!ok) return;
    if (data.favorites) store.set('my_favorites', data.favorites);
    if (data.guides) store.set('my_guides', data.guides);
    if (data.followStore) store.set('follow_store', data.followStore);
    if (data.categories) store.set('custom_categories', data.categories);

    if (!imgCount) {
      this.afterImport();
      ui.modal({
        title: '导入完成', showCancel: false, confirmText: '知道了',
        content: '已还原 ' + nFav + ' 个收藏夹 · ' + nGuide + ' 篇攻略 · ' + nPts + ' 个点位。\n这份备份里没有图片。'
      });
      return;
    }
    ui.loading('正在还原图片…');
    try {
      const res = await imgpack.unpack(data.imgs);
      ui.hideLoading();
      const replaced = imgpack.rewriteUrls(data, res.pathMap);
      // store.set 存的是引用：必须先改对象再写一次，替换才生效
      if (data.favorites) store.set('my_favorites', data.favorites);
      if (data.guides) store.set('my_guides', data.guides);
      this.afterImport();
      ui.modal({
        title: '导入完成', showCancel: false, confirmText: '知道了',
        content: '已还原 ' + nFav + ' 个收藏夹 · ' + nGuide + ' 篇攻略 · ' + nPts + ' 个点位。\n'
          + '图片：还原 ' + res.restored + ' 张，替换 ' + replaced + ' 处引用'
          + (res.failed ? ('；' + res.failed + ' 张写入失败，这些位置仍是原引用。') : '。')
      });
    } catch (e) {
      ui.hideLoading();
      ui.toast('图片还原失败，数据已导入', 'none');
      this.afterImport();
    }
  },

  /** ② CSV 导入：按「所属收藏夹」列分夹写入 */
  importCsv(raw) {
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      ui.toast('CSV 至少要有一行数据', 'none');
      return;
    }
    const splitCsvLine = (line) => {
      const out = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
          } else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    };

    const head = splitCsvLine(lines[0]);
    const col = (names) => {
      for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
      return -1;
    };
    const iName = col(['名称', '名字', 'name', '点位', '地点']);
    const iLat = col(['纬度', 'lat', 'latitude']);
    const iLng = col(['经度', 'lng', 'lon', 'longitude']);
    if (iName < 0 || iLat < 0 || iLng < 0) {
      ui.modal({
        title: '表头对不上',
        content: 'CSV 至少需要「名称」「纬度」「经度」三列。当前表头：' + head.join(' / '),
        showCancel: false
      });
      return;
    }
    const iCat = col(['分类', 'category']);
    const iNote = col(['备注', '说明', 'note', 'reason']);
    const iFolder = col(['所属收藏夹', '收藏夹', 'folder']);
    const iGuide = col(['所属攻略', '攻略', 'guide']);

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      const lat = parseFloat(c[iLat]);
      const lng = parseFloat(c[iLng]);
      const name = (c[iName] || '').trim();
      if (!name || isNaN(lat) || isNaN(lng)) continue;
      items.push({
        name, category: iCat >= 0 ? (c[iCat] || '') : '', latitude: lat, longitude: lng,
        note: iNote >= 0 ? (c[iNote] || '') : '', folder: iFolder >= 0 ? (c[iFolder] || '') : '',
        guide: iGuide >= 0 ? (c[iGuide] || '') : ''
      });
    }
    if (!items.length) {
      ui.toast('没有解析出有效点位', 'none');
      return;
    }

    ui.modal({
      title: '导入 ' + items.length + ' 个点位？',
      content: '将按「所属收藏夹」列写入收藏夹（没有这一列就统一放进「CSV 导入」夹）。已有点位不会被删除。',
      confirmColor: '#12B76A'
    }).then((r) => {
      if (!r) return;
      const tree = favorites.getTree();
      const byName = {};
      for (const n of tree) byName[n.name] = n.id;
      const def = favorites.ensureDefault();
      let okc = 0;
      for (const it of items) {
        let fid = it.folder ? byName[it.folder] : '';
        if (it.folder && !fid) {
          const node = favorites.createFolder(it.folder.slice(0, 12));
          byName[node.name] = node.id;
          fid = node.id;
        }
        favorites.addItem({
          name: it.name, category: it.category || '', latitude: it.latitude,
          longitude: it.longitude, note: it.note, reason: it.note, group: it.guide || 'CSV 导入',
          imageUrls: []
        }, [fid || def.id]);
        okc++;
      }
      ui.toast('已导入 ' + okc + ' 个点位', 'success');
      this.afterImport();
    });
  },

  /** ③ KML 导入：解析 Placemark，按 Folder 名分夹写入（正则解析，KML 结构固定够用） */
  importKml(raw) {
    const items = [];
    const folderRe = /<Folder>([\s\S]*?)<\/Folder>/g;
    const pmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g;
    const pushBlock = (block, folderName) => {
      let m;
      pmRe.lastIndex = 0;
      while ((m = pmRe.exec(block)) !== null) {
        const blk = m[1];
        const co = /<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)/.exec(blk);
        if (!co) continue;
        const lng = parseFloat(co[1]);
        const lat = parseFloat(co[2]);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const nm = /<name>([\s\S]*?)<\/name>/.exec(blk);
        const ds = /<description>([\s\S]*?)<\/description>/.exec(blk);
        items.push({
          name: this._xmlUnesc(nm ? nm[1] : ''),
          latitude: lat,
          longitude: lng,
          note: ds ? this._xmlUnesc(ds[1]) : '',
          folder: folderName || ''
        });
      }
    };

    let fm;
    folderRe.lastIndex = 0;
    while ((fm = folderRe.exec(raw)) !== null) {
      const fBlock = fm[1];
      const nm = /<name>([\s\S]*?)<\/name>/.exec(fBlock);
      const folderName = nm ? this._xmlUnesc(nm[1]) : '';
      pushBlock(fBlock, folderName);
    }
    // 没有 Folder 包裹的顶层 Placemark
    // ⚠ 必须先把已经处理过的 Folder 整块剔除再扫，否则 Folder 里的点位会被算第二遍
    pushBlock(raw.replace(folderRe, ''), '');

    if (!items.length) {
      ui.toast('没有解析出有效 Placemark', 'none');
      return;
    }

    ui.modal({
      title: '导入 ' + items.length + ' 个点位？',
      content: (items[0].folder ? '将按 KML 里的 Folder 名写入收藏夹。' : '将统一放进「KML 导入」收藏夹。') + '已有点位不会被删除。',
      confirmColor: '#12B76A'
    }).then((r) => {
      if (!r) return;
      const tree = favorites.getTree();
      const byName = {};
      for (const n of tree) byName[n.name] = n.id;
      const def = favorites.ensureDefault();
      let okc = 0;
      for (const it of items) {
        let fid = it.folder ? byName[it.folder] : '';
        if (it.folder && !fid) {
          const node = favorites.createFolder(it.folder.slice(0, 12));
          byName[node.name] = node.id;
          fid = node.id;
        }
        favorites.addItem({
          name: it.name, category: '', latitude: it.latitude, longitude: it.longitude,
          note: it.note, reason: it.note, group: 'KML 导入', imageUrls: []
        }, [fid || def.id]);
        okc++;
      }
      ui.toast('已导入 ' + okc + ' 个点位', 'success');
      this.afterImport();
    });
  },

  afterImport() {
    store.set('guide_refresh_token', { token: Date.now() });
    this.closeImport();
    this.loadStats();
  },

  /* ============ 清除本地数据 ============ */
  async clearLocal() {
    const ok = await ui.modal({
      title: '清除本机数据？',
      content: '将删除本机的收藏夹、攻略、收纳夹与浏览记录，且无法恢复（数据只存在这台设备上）。建议先「导出地点数据」留一份备份。',
      confirmText: '清除',
      confirmColor: '#EF4444'
    });
    if (!ok) return;
    // 先把图片 id 收集出来（清了存储就找不回来了）
    const imgIds = collectImgIds();
    ['my_favorites', 'my_guides', 'follow_store', 'custom_categories',
      'guide_refresh_token', 'map_locate_point', 'search_history_map',
      'geo_cache', 'geosearch_cache', 'geo_quota_date',
      // R74 口径：地图/页面态一并清掉，否则清完数据地图还停在旧的
      //   聚焦攻略、图层偏好、待定位标记上。
      'current_guide_id', 'map_isolate_guide', 'map_fit_guide', 'map_layer_intent',
      'map_focus_gid', 'map_focus_reason', 'map_layers', 'find_history',
      'fav_refresh_token', 'fav_open_tab', 'pending_guides_tab'].forEach(k => {
        store.remove(k);
      });
    // R74（关键）：删完必须主动写一个新的刷新 token。
    //   地图页 onShow 靠 token 变化判断是否重建 marker —— 删成空值会被判「没变」而不重建。
    const now = Date.now();
    store.set('guide_refresh_token', { token: now });
    store.set('fav_refresh_token', { token: now + 1 });
    // IndexedDB 里的图片本体逐个删（存储 key 清了就再也收集不到）
    for (const id of imgIds) {
      try { await store.img.remove(id); } catch (e) { /* ignore */ }
    }
    this.loadStats();
    ui.toast('已清除', 'none');
  },

  /* ============ 服务状态自检 ============ */
  openDiag() {
    this.setData({ diagVisible: true, diagRows: [], diagSummary: '' });
    this.runDiag();
  },
  closeDiag() { this.setData({ diagVisible: false, diagRunning: false }); },

  async runDiag() {
    if (this.data.diagRunning) return;
    this.setData({ diagRunning: true, diagRows: [], diagSummary: '' });

    const rows = [];
    const push = (name, status, detail) => {
      rows.push({ name, status, detail });
      this.setData({ diagRows: rows.slice() });
    };

    // 用成都天府广场附近一个坐标试探（逆地理任一点都能回，不依赖用户位置权限）
    const LAT = 30.6570, LNG = 104.0657;

    // ① 腾讯位置服务
    if (!qqmap.hasKey()) {
      push('腾讯位置服务 Key', 'bad', '没有可用 Key，去「我的 → 地图 Key 设置」填一个');
    } else if (qqmap.quotaOut()) {
      push('腾讯位置服务', 'warn', '今日额度已用完（次日 0 点重置）。已缓存 '
        + qqmap.cacheStats().located + ' 个地名可直接命中；换成自己的 Key 立即恢复');
    } else {
      const r = await qqmap.regeo(LAT, LNG).catch(() => ({ code: -3, message: '网络不可用' }));
      if (r && r.code === 0) {
        const kind = qqmap.usingOwnKey() ? '你的 Key' : '内置共享 Key';
        const cache = qqmap.cacheStats();
        push('腾讯位置服务', 'ok', kind + ' 可用 · 已缓存 ' + cache.located + ' 个地名');
      } else if (r && r.code === 121) {
        push('腾讯位置服务', 'warn', 'Key 有效，但当日配额已用尽（次日 0 点自动重置，可在设置里换成自己的 Key）');
      } else if (r && (r.code === 199 || r.code === 111)) {
        push('腾讯位置服务', 'bad', r.code === 199 ? 'Key 未开启 WebServiceAPI（去 lbs.qq.com 勾选）' : 'Key 签名校验失败，检查 Key 是否填错');
      } else {
        push('腾讯位置服务', 'bad', '请求失败（' + ((r && (r.message || r.code)) || '未知') + '），检查网络或 Key 域名配置');
      }
    }

    // ② 高德位置服务（双通道互补）
    const ak = geosearch.getAmapKey();
    if (!ak) {
      push('高德位置服务', 'warn', '未填高德 Key。解析坐标时只走腾讯通道，建议也填一个高德 Key 做双通道备份（见「我的 → 地图 Key 设置」）');
    } else if (geosearch.usingAmapBuiltin()) {
      push('高德位置服务', 'ok', '内置共享 Key 可用 · 解析坐标时与腾讯互补，想更稳可再填自己的 Key');
    } else {
      push('高德位置服务', 'ok', '已填你自己的 Key · 解析坐标会同时尝试腾讯 + 高德');
    }

    // ③ 本机存储用量（localStorage + IndexedDB 图片）
    let size = 0;
    const keys = ['my_favorites', 'my_guides', 'follow_store', 'geo_cache', 'geosearch_cache', 'custom_categories'];
    try {
      for (const k of keys) {
        const v = store.get(k);
        size += v ? (JSON.stringify(v).length / 1024 / 1024) : 0;
      }
    } catch (e) { size = -1; }
    if (size < 0) push('本机存储', 'ok', '无法读取');
    else if (size > 8) push('本机存储', 'warn', '已用 ' + size.toFixed(1) + ' MB，建议先导出备份再清理');
    else push('本机存储', 'ok', '已用 ' + size.toFixed(1) + ' MB');

    let summary = '';
    const bad = rows.filter(x => x.status === 'bad');
    const warn = rows.filter(x => x.status === 'warn');
    if (bad.length) summary = '有 ' + bad.length + ' 项异常需要处理，按提示处理后再试。';
    else if (warn.length) summary = '有 ' + warn.length + ' 项提示，不影响使用，可按建议优化。';
    else summary = '全部正常。本地数据都在本机，无需云端。';

    this.setData({ diagRunning: false, diagSummary: summary });
  },

  contactUs() {
    const done = () => ui.toast('邮箱已复制：' + CONTACT_MAIL, 'none');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CONTACT_MAIL).then(done).catch(() => {
        window.location.href = 'mailto:' + CONTACT_MAIL;
      });
    } else {
      window.location.href = 'mailto:' + CONTACT_MAIL;
    }
  },

  /* ============ 地图 Key 设置 ============ */
  openMapKeyForm() {
    this.setData({
      mapFormVisible: true,
      kQqmap: store.get('qqmap_key') || '',
      kAmap: store.get('amap_key') || ''
    });
  },
  closeMapKeyForm() { this.setData({ mapFormVisible: false }); },
  onMapKeyInput(e) {
    const k = (e && e.getAttribute) ? (e.getAttribute('data-arg') || '') : '';
    const v = (e && e.target && e.target.value) || '';
    const patch = {};
    patch[k] = v;
    this.setData(patch);
  },
  saveMapKey() {
    const q = (this.data.kQqmap || '').trim();
    const a = (this.data.kAmap || '').trim();
    if (q) store.set('qqmap_key', q); else store.remove('qqmap_key');
    if (a) store.set('amap_key', a); else store.remove('amap_key');
    qqmap.resetQuota();
    geosearch.resetQuota();
    this.setData({ mapFormVisible: false, mapKeyOn: !!(q || a) });
    ui.toast('地图 Key 已保存', 'success');
  },
  clearMapKey() {
    store.remove('qqmap_key');
    store.remove('amap_key');
    qqmap.resetQuota();
    geosearch.resetQuota();
    this.setData({ kQqmap: '', kAmap: '', mapKeyOn: false });
    ui.toast('已用回内置', 'none');
  },

  /* ============ 渲染 ============ */
  render() {
    const d = this.data;
    const initial = d.nickName ? d.nickName.slice(0, 1) : '我';
    const statCell = (act, num, label) =>
      '<button class="stat-cell" data-act="' + act + '">' +
      '<span class="stat-num">' + esc(num) + '</span>' +
      '<span class="stat-label">' + esc(label) + '</span>' +
      '</button>';

    return (
      '<div class="page mine-page">' +

      /* 用户卡 */
      '<div class="profile-card">' +
      '  <div class="pc-deco"></div>' +
      '  <button class="avatar-wrap" data-act="pick-avatar">' +
      (d.avatarUrl
        ? '<img class="avatar" src="' + esc(d.avatarUrl) + '" alt="">'
        : '<span class="avatar avatar-text">' + esc(initial) + '</span>') +
      '    <span class="avatar-ring"></span>' +
      '  </button>' +
      '  <div class="p-main">' +
      (d.logged ?
        '<div class="p-nick">' + esc(d.nickName || '未设置昵称') + '</div>' +
        '<div class="p-state"><span>' + esc(d.bio || (d.profileReady ? '开始记录你的地点' : '点昵称改名字')) + '</span></div>' +
        '<button class="p-edit" data-act="open-profile">' +
        '  <img src="images/ui/edit-dark.png" alt=""><span>资料修改</span>' +
        '</button>'
        :
        '<div class="p-nick static">欢迎使用</div>' +
        '<div class="p-state"><span>数据全部保存在本机，点头像和昵称即可设置资料</span></div>') +
      '  </div>' +
      '  <div class="p-badge"><span class="p-dot"></span><span>本地存储</span></div>' +
      '</div>' +

      /* 数据统计 */
      '<div class="stat-card">' +
      statCell('stat-guides', d.statGuides, '解析攻略') +
      '<span class="stat-divider"></span>' +
      statCell('stat-favGuide', d.statFollow, '收藏攻略') +
      '<span class="stat-divider"></span>' +
      statCell('stat-favPoint', d.statPoints, '收藏点位') +
      '</div>' +

      /* 数据管理 */
      '<div class="sec-title">数据管理</div>' +
      '<div class="menu-card">' +
      '  <button class="menu-row" data-act="export-data">' +
      '    <span class="m-ic up"><img src="images/ui/export-dark.png" alt=""></span>' +
      '    <span class="m-name">导出地点数据</span>' +
      '    <span class="m-sub">备份可带图片 · KML / CSV</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '  <button class="menu-row" data-act="open-import">' +
      '    <span class="m-ic down"><img src="images/ui/import-dark.png" alt=""></span>' +
      '    <span class="m-name">导入数据 / 分享码</span>' +
      '    <span class="m-sub">备份、KML、CSV 或好友的分享码</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '  <button class="menu-row" data-act="clear-local">' +
      '    <span class="m-ic clean"><img src="images/ui/tool-clear.png" alt=""></span>' +
      '    <span class="m-name">清除本地数据</span>' +
      '    <span class="m-sub">收藏 / 攻略 / 浏览记录</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '</div>' +

      /* 其他 */
      '<div class="sec-title">其他</div>' +
      '<div class="menu-card">' +
      '  <button class="menu-row" data-act="open-mapkey">' +
      '    <span class="m-ic"><img src="images/ui/tool-copy-dark.png" alt=""></span>' +
      '    <span class="m-name">地图 Key 设置</span>' +
      '    <span class="m-sub">腾讯 / 高德 · 留空用内置共享 Key</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '  <button class="menu-row" data-act="open-diag">' +
      '    <span class="m-ic"><img src="images/ui/tool-copy-dark.png" alt=""></span>' +
      '    <span class="m-name">服务状态自检</span>' +
      '    <span class="m-sub">地图 Key / 本机存储</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '  <button class="menu-row" data-act="contact-us">' +
      '    <span class="m-ic"><img src="images/ui/mail.png" alt=""></span>' +
      '    <span class="m-name">联系我们</span>' +
      '    <span class="m-sub">' + esc(CONTACT_MAIL) + '</span>' +
      '    <img class="m-arrow" src="images/ui/chevron-right.png" alt="">' +
      '  </button>' +
      '</div>' +

      '<div class="version">觅点寻迹（攻略点位地图）' + esc(d.version) + '</div>' +
      '<div class="local-tip">数据保存在本机' + (d.storeSize ? ' · 已用 ' + esc(d.storeSize) : '') + ' · 无云端、无账号</div>' +
      '<div class="bottom-space"></div>' +

      /* ===== 导出格式选择弹层 ===== */
      (d.exVisible ?
        '<div class="ui-mask in" data-act="close-export"></div>' +
        '<div class="ui-sheet in ex-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="im-head">' +
        '    <span class="im-title">导出地点数据</span>' +
        '    <button class="sheet-close" data-act="close-export">✕</button>' +
        '  </div>' +
        '  <div class="im-sub">选一种格式。想换手机 / 留底选第一种（图片一起带走）；只想发坐标给别人选后三种。</div>' +
        '  <div class="sheet-body">' +
        '    <button class="ex-card ex-card-best" data-act="pick-export" data-arg="mgbak">' +
        '      <span class="ex-card-top"><span class="ex-card-name">完整备份 · 含图片</span>' +
        '      <span class="ex-badge ex-badge-img">带图片</span><span class="ex-badge ex-badge-best">推荐</span></span>' +
        '      <span class="ex-card-sub">收藏夹 / 攻略 / 收纳夹 / 自定义分类，连图片一起打包。相册里的图片会转成文本一起带走，导入后图片直接能看。</span>' +
        '      <span class="ex-card-meta">.mgbak 文件 · 下载后可用于备份或导入</span>' +
        '    </button>' +
        '    <button class="ex-card" data-act="pick-export" data-arg="json">' +
        '      <span class="ex-card-top"><span class="ex-card-name">完整备份 · 纯数据</span>' +
        '      <span class="ex-badge ex-badge-no">不带图片</span></span>' +
        '      <span class="ex-card-sub">同样完整的收藏夹 / 攻略 / 收纳夹 / 分类，但只带图片引用、不带图片本身。体积小，适合快速传输。</span>' +
        '      <span class="ex-card-meta">.json 文件 · 导入可完整还原数据（图片引用可能失效）</span>' +
        '    </button>' +
        '    <button class="ex-card" data-act="pick-export" data-arg="kml">' +
        '      <span class="ex-card-top"><span class="ex-card-name">KML 地图标记</span>' +
        '      <span class="ex-badge ex-badge-half">仅网络图片</span></span>' +
        '      <span class="ex-card-sub">给 Google Earth / 奥维地图 / 两步路 用的通用格式，点位按收藏夹、攻略分组。收藏和攻略一次全导。</span>' +
        '      <span class="ex-card-meta">.kml 文件 · 导入只带回点位和备注</span>' +
        '    </button>' +
        '    <button class="ex-card" data-act="pick-export" data-arg="csv">' +
        '      <span class="ex-card-top"><span class="ex-card-name">CSV 表格</span>' +
        '      <span class="ex-badge ex-badge-no">不带图片</span></span>' +
        '      <span class="ex-card-sub">给 Excel / WPS 看的纯表格：名称、分类、经纬度、备注、所属收藏夹、所属攻略。收藏和攻略一次全导。</span>' +
        '      <span class="ex-card-meta">.csv 文件 · 导入按「所属收藏夹」列自动归夹</span>' +
        '    </button>' +
        '  </div>' +
        '  <div class="ex-note">图片打包上限：最多 80 张、累计约 18MB 原图，超出的会保留原引用并在结果里说明。</div>' +
        '</div>'
        : '') +

      /* ===== 导入数据弹层 ===== */
      (d.importVisible ?
        '<div class="ui-mask in" data-act="close-import"></div>' +
        '<div class="ui-sheet in im-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="im-head">' +
        '    <span class="im-title">导入数据 / 分享码</span>' +
        '    <button class="sheet-close" data-act="close-import">✕</button>' +
        '  </div>' +
        '  <div class="im-sub">粘贴内容或选本机文件，会自动识别格式并导入（分享码、备份、KML、CSV 都支持）：</div>' +
        '  <div class="sheet-body">' +
        '    <div class="im-fmt">' +
        '      <div class="im-fmt-row"><span class="im-fmt-tag">①</span>' +
        '      <span class="im-fmt-text">分享码（MIDX1.…）—— 好友在地图/攻略页点「分享」复制的文本，粘贴即还原成一篇攻略</span></div>' +
        '      <div class="im-fmt-row im-fmt-row-hl"><span class="im-fmt-tag">②</span>' +
        '      <span class="im-fmt-text">带图分享文件（.txt）—— 好友在分享页勾「带图」发来的文件，导入后图片直接能看。<span class="im-fmt-badge">唯一能带图的分享方式</span></span></div>' +
        '      <div class="im-fmt-row"><span class="im-fmt-tag">③</span>' +
        '      <span class="im-fmt-text">含图片（.mgbak）—— 收藏夹 / 攻略 / 收纳夹 / 分类 + 图片一起还原，换设备也不怕</span></div>' +
        '      <div class="im-fmt-row"><span class="im-fmt-tag">④</span>' +
        '      <span class="im-fmt-text">纯数据（.json）/ KML（.kml）/ CSV（.csv）—— 不含图片本体；本地图片换设备会失效</span></div>' +
        '    </div>' +
        '    <textarea class="im-input" data-act="import-input" placeholder="粘贴分享码、备份文本、KML 或 CSV 内容…"></textarea>' +
        '    <div class="im-actions">' +
        '      <button class="im-cancel" data-act="close-import">取消</button>' +
        '      <button class="im-confirm' + (d.importText ? ' on' : '') + '" data-act="confirm-import">导入</button>' +
        '    </div>' +
        '    <div class="im-tip">「导入」会自动判断：粘了内容就导入内容；没粘内容就选本机文件。</div>' +
        '    <div class="im-actions">' +
        '      <button class="im-confirm im-confirm-ghost" data-act="pick-file">从本机文件导入</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 服务状态自检弹层 ===== */
      (d.diagVisible ?
        '<div class="ui-mask in" data-act="close-diag"></div>' +
        '<div class="ui-sheet in dg-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="dg-head">' +
        '    <span class="dg-title">服务状态自检</span>' +
        '    <button class="sheet-close" data-act="close-diag">✕</button>' +
        '  </div>' +
        '  <div class="dg-sub">依次检查：腾讯位置服务（地名转坐标）、高德位置服务、本机存储用量。黄色提示不影响使用。</div>' +
        '  <div class="sheet-body">' +
        '    <div class="dg-list">' +
        (d.diagRows || []).map(r =>
          '<div class="dg-row">' +
          '<span class="dg-dot ' + r.status + '"></span>' +
          '<span class="dg-body"><span class="dg-name">' + esc(r.name) + '</span>' +
          '<span class="dg-detail">' + esc(r.detail) + '</span></span>' +
          '</div>').join('') +
        (d.diagRunning ? '<div class="dg-wait"><span class="dg-dot run"></span><span>正在检测…</span></div>' : '') +
        '    </div>' +
        (d.diagSummary ? '<div class="dg-summary">' + esc(d.diagSummary) + '</div>' : '') +
        '    <div class="dg-actions">' +
        '      <button class="dg-btn" data-act="close-diag">关闭</button>' +
        '      <button class="dg-btn primary' + (d.diagRunning ? ' off' : '') + '" data-act="run-diag">重新检测</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 地图 Key 设置弹层 ===== */
      (d.mapFormVisible ?
        '<div class="ui-mask in" data-act="close-mapkey"></div>' +
        '<div class="ui-sheet in im-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="im-head">' +
        '    <span class="im-title">地图 Key（可选）</span>' +
        '    <button class="sheet-close" data-act="close-mapkey">✕</button>' +
        '  </div>' +
        '  <div class="im-sub">地名转坐标会同时尝试腾讯 + 高德，双通道互补。留空就用内置共享 Key。</div>' +
        '  <div class="sheet-body">' +
        '    <div class="ks-st-steps">' +
        '      <div class="ks-st-step">① 腾讯：打开 lbs.qq.com → 控制台 → 创建应用 → 勾选 WebServiceAPI</div>' +
        '      <div class="ks-st-step">② 高德：打开 console.amap.com → 应用管理 → 添加 Key（服务平台选「Web服务」）</div>' +
        '      <div class="ks-st-step">③ 把两个 Key 分别粘进下面输入框，点保存</div>' +
        '    </div>' +
        '    <div class="pf-field">' +
        '      <span class="pf-label">腾讯地图 Key</span>' +
        '      <input class="pf-input" data-act="mapkey-input" data-arg="kQqmap" value="' + esc(d.kQqmap) + '" placeholder="留空用内置共享 Key" maxlength="64">' +
        '    </div>' +
        '    <div class="pf-field">' +
        '      <span class="pf-label">高德地图 Key</span>' +
        '      <input class="pf-input" data-act="mapkey-input" data-arg="kAmap" value="' + esc(d.kAmap) + '" placeholder="留空用内置共享 Key" maxlength="64">' +
        '    </div>' +
        '    <div class="ks-tip">腾讯 / 高德现在都内置了共享 Key，填自己的只是多一层保险。两个通道都免费，当日配额用完也只是「当天查不到坐标」，不扣费，次日 0 点恢复。</div>' +
        '    <div class="im-actions">' +
        '      <button class="im-cancel" data-act="clear-mapkey">用回内置</button>' +
        '      <button class="im-confirm on" data-act="save-mapkey">保存</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      /* ===== 资料修改弹层 ===== */
      (d.peVisible ?
        '<div class="ui-mask in" data-act="close-profile"></div>' +
        '<div class="ui-sheet in pf-sheet">' +
        '  <div class="sheet-grabber"></div>' +
        '  <div class="pf-head">' +
        '    <span class="pf-title">资料修改</span>' +
        '    <button class="sheet-close" data-act="close-profile">✕</button>' +
        '  </div>' +
        '  <div class="sheet-body">' +
        '    <button class="pf-avatar-btn" data-act="pick-pe-avatar">' +
        (d.peAvatar
          ? '<img class="pf-avatar" src="' + esc(d.peAvatar) + '" alt="">'
          : '<span class="pf-avatar pf-avatar-ph">' + esc(d.peNick || '我') + '</span>') +
        '      <span class="pf-avatar-tip">点击更换头像</span>' +
        '    </button>' +
        '    <div class="pf-field">' +
        '      <span class="pf-label">昵称</span>' +
        '      <input class="pf-input" data-act="profile-input" data-arg="peNick" value="' + esc(d.peNick) + '" placeholder="填写昵称" maxlength="16">' +
        '    </div>' +
        '    <div class="pf-field">' +
        '      <span class="pf-label">备注</span>' +
        '      <input class="pf-input" data-act="profile-input" data-arg="peBio" value="' + esc(d.peBio) + '" placeholder="一句话介绍自己（可选）" maxlength="30">' +
        '    </div>' +
        '    <div class="pf-actions">' +
        '      <button class="im-cancel" data-act="close-profile">取消</button>' +
        '      <button class="im-confirm on" data-act="save-profile">保存</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
        : '') +

      '</div>'
    );
  },

  bind(root) {
    this.on(root, 'pick-avatar', () => this.pickAvatar());
    this.on(root, 'open-profile', () => this.openProfileEditor());
    this.on(root, 'close-profile', () => this.closeProfileEditor());
    this.on(root, 'pick-pe-avatar', () => this.pickPeAvatar());
    this.on(root, 'save-profile', () => this.saveProfileEditor());
    this.on(root, 'stat-guides', () => this.goStat({ getAttribute: () => 'guides' }));
    this.on(root, 'stat-favGuide', () => this.goStat({ getAttribute: () => 'favGuide' }));
    this.on(root, 'stat-favPoint', () => this.goStat({ getAttribute: () => 'favPoint' }));

    this.on(root, 'export-data', () => this.exportData());
    this.on(root, 'close-export', () => this.closeExport());
    this.on(root, 'pick-export', (e) => this.pickExport(e));
    this.on(root, 'open-import', () => this.openImport());
    this.on(root, 'close-import', () => this.closeImport());
    this.on(root, 'confirm-import', () => this.confirmImport());
    this.on(root, 'pick-file', () => this.pickImportFile());
    this.on(root, 'clear-local', () => this.clearLocal());

    this.on(root, 'open-mapkey', () => this.openMapKeyForm());
    this.on(root, 'close-mapkey', () => this.closeMapKeyForm());
    this.on(root, 'save-mapkey', () => this.saveMapKey());
    this.on(root, 'clear-mapkey', () => this.clearMapKey());
    this.on(root, 'open-diag', () => this.openDiag());
    this.on(root, 'close-diag', () => this.closeDiag());
    this.on(root, 'run-diag', () => this.runDiag());
    this.on(root, 'contact-us', () => this.contactUs());

    // 输入类控件：input 用委托，textarea 需要保住光标（受控，不整页重渲染）
    root.querySelectorAll('[data-act="mapkey-input"]').forEach((n) => {
      n.addEventListener('input', (e) => this.onMapKeyInput(e));
    });
    root.querySelectorAll('[data-act="profile-input"]').forEach((n) => {
      n.addEventListener('input', (e) => {
        const k = e.target.getAttribute('data-arg');
        const patch = {};
        patch[k] = e.target.value;
        this.setData(patch, true);
      });
    });
    const ta = root.querySelector('[data-act="import-input"]');
    if (ta) {
      ta.value = this.data.importText || '';
      ta.addEventListener('input', (e) => {
        this.data.importText = e.target.value;
        // 只切换「导入」按钮的可用样式，不整页重渲染（避免打断输入）
        const btn = document.querySelector('[data-act="confirm-import"]');
        if (btn) btn.classList.toggle('on', !!this.data.importText);
      });
    }
  }
};

export default mixin(page);
