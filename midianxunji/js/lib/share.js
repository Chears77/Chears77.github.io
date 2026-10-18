/**
 * share.js —— 分享封装（★ 第五十三轮：本地版改「分享码」）
 *
 * 为什么改：旧版分享靠云端 `_id`（先存成一条云端记录，好友点开时凭 id 取回），
 * 本地版没有云端了，数据传不出去。改成本地**分享码**：
 *
 *   打包 → 分享码文本（MIDX1.xxxx） → 复制/发文件给好友 → 好友在「我的 → 导入」粘贴 → 还原
 *
 * 微信没有「用代码弹出转发面板」的 API，且 onShareAppMessage 必须同步返回 path，
 * 拿不到异步结果 —— 所以分享码走「先复制、再转发」两步，不再依赖任何服务端。
 * 转发小程序本身照常可用（右上角「···」），只是卡片里不带点位数据。
 *
 * 编码：JSON → UTF-8 → Base64，前缀 MIDX1. 便于识别与校验。
 * 用纯 JS 实现（不依赖 wx API），方便回归测试直接跑。
 */
import guides from './guides.js';
import favorites from './favorites.js';
import follow from './follow.js';
// ★ 带图文件分享：复用图片打包引擎（网页版底层是 IndexedDB）
import imgpack from './imgpack.js';
import store from '../store.js';
import ui from '../ui.js';
import dl from '../dl.js';
import router from '../router.js';

const PREFIX = 'MIDX1.';
const PREFIX2 = 'MIDX2.';
const MAX_PTS = 100;

/**
 * 分享链接（path）能塞多少字符：微信官方没公布 onShareAppMessage 的 path 长度上限，
 * 社区实测说法从 128 字节到 1024 字节都有。这里取一个**偏保守**的值，
 * 并且每份数据自带校验位 —— 真被截断了接收端能立刻发现并提示，不会静默给出半份攻略。
 * 装不下就自动降级成「二维码海报 / 复制分享码」，两条路都零后端。
 *
 * ★ 第八十轮：480 → 900。480 是第五十六轮定的保守值（当时社区流传「上限 128 字节」），
 *   后来大量开发者在正式版实测分享 path 实际能到 ~1024 字节才被截断；
 *   同时点位名上限从 40 压到 24（见 packCompact），单点位从 ~44 字符降到 ~28 ——
 *   同样的限额，直传容量从 ~10 个点位提升到 ~30 个。
 *   截断风险仍在（微信从未公布官方数字），但接收端有校验位兜底：真被截断时
 *   unpackCompact 返回 truncated，界面会引导走二维码 / 分享码，不会静默给半份数据。
 */
const PATH_LIMIT = 900;

/* 紧凑编码用的分隔符（都是控制字符，正常地名里不可能出现） */
const FS = '\x1f';   // 字段分隔
const RS = '\x1e';   // 点位分隔
const GS = '\x1d';   // 组名分隔
const CATS = ['jingdian', 'meishi', 'zhusu', 'qita'];

/* ================= Base64 / UTF-8（纯 JS） ================= */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Bytes(str) {
  const s = String(str || '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      const cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
      out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      i++;
    } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
  }
  return out;
}

function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += (b1 === undefined) ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += (b2 === undefined) ? '=' : B64[b2 & 63];
  }
  return out;
}

function b64Index(ch) {
  const i = B64.indexOf(ch);
  return i < 0 ? -1 : i;
}

function b64ToBytes(b64) {
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = b64Index(s[i]), c1 = b64Index(s[i + 1]);
    const c2 = b64Index(s[i + 2]), c3 = b64Index(s[i + 3]);
    if (c0 < 0 || c1 < 0) break;
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) out.push(((c2 & 3) << 6) | c3);
  }
  return out;
}

function bytesToUtf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    if (b >= 0xC0 && b < 0xE0) { out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F)); continue; }
    if (b >= 0xE0 && b < 0xF0) {
      out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
      continue;
    }
    const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
    const v = cp - 0x10000;
    out += String.fromCharCode(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF));
  }
  return out;
}

/* ================= Base64URL / 紧凑编码（第五十六轮） ================= */

/** Base64 → URL 安全版（path 里 + / = 都要转义，- _ 不用） */
function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return b64ToBytes(t);
}

function b36(n) { return Math.round(n).toString(36); }
function unb36(s) { return parseInt(s, 36) / 1e5; }
function encCoord(v) { return b36(Math.round(Number(v) * 1e5)); }

/** 校验位：内容被截断/篡改时接收端能立刻发现（2 个 base36 字符） */
function checksum(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1296;
  return ('00' + h.toString(36)).slice(-2);
}

/* 点位字段兼容读：既吃内部 toPoint 的 {n,c,g,lt,lg}，也吃攻略里的原始字段 */
function ptName(p) { return String(p.n || p.name || ''); }
function ptLat(p) { return Number(p.lt !== undefined ? p.lt : p.latitude) || 0; }
function ptLng(p) { return Number(p.lg !== undefined ? p.lg : p.longitude) || 0; }
function ptCat(p) { return String(p.c || p.category || 'qita'); }
function ptGrp(p) { return String(p.g || p.group || ''); }

/**
 * 紧凑编码（MIDX2.）
 *
 * 为什么还要一套：MIDX1 是 JSON→Base64，光是键名（"latitude" 之类）就吃掉一半长度，
 * 塞不进分享链接。紧凑版去掉键名、坐标转 base36 整数、分组做成索引表，
 * 同一份数据能短掉 40%~60%，十几二十个点位就有机会直接跟着分享卡片走。
 *
 * 取舍：为了短，**不携带 reason（推荐理由）** —— 导入后仍可编辑，
 * 但不会把长段文字塞进二维码里。二维码/链接场景优先保证扫得出来。
 */
function packCompact(name, points) {
  const src = (points || []).slice(0, MAX_PTS);
  const groups = [];
  const gidx = {};
  const pts = [];
  for (const p of src) {
    if (!p) continue;
    const lt = ptLat(p), lg = ptLng(p);
    // ★ 第八十轮：点位名截到 24 字符（中文在紧凑码里 4 base64 字符/字，是大头）。
    //   「成都大熊猫繁育研究基地」12 字这种长名也放得下；超出截断不影响导入后编辑。
    const nm = ptName(p).slice(0, 24);
    if (!lt || !lg || !nm) continue;
    const g = ptGrp(p);
    if (g && gidx[g] === undefined) { gidx[g] = groups.length; groups.push(g); }
    const c = ptCat(p);
    const ci = CATS.indexOf(c);
    pts.push([nm, encCoord(lt), encCoord(lg), ci >= 0 ? String(ci) : ('#' + c), g ? b36(gidx[g]) : ''].join(FS));
  }
  if (!pts.length) return { ok: false, reason: 'empty' };
  const sig = [String(name || '我的点位').slice(0, 30), groups.join(GS)].join(FS) + RS + pts.join(RS);
  const plain = [String(name || '我的点位').slice(0, 30), groups.join(GS), checksum(sig)].join(FS) + RS + pts.join(RS);
  const code = PREFIX2 + bytesToB64Url(utf8Bytes(plain));
  return { ok: true, code: code, chars: code.length, count: pts.length, fitsPath: code.length <= PATH_LIMIT };
}

/** 解紧凑码；被截断会返回 reason:'truncated'（而不是给出半份攻略） */
function unpackCompact(code) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (raw.slice(0, PREFIX2.length) !== PREFIX2) return { ok: false, reason: 'prefix' };
  try {
    const plain = bytesToUtf8(b64UrlToBytes(raw.slice(PREFIX2.length)));
    const parts = plain.split(RS);
    if (parts.length < 2) return { ok: false, reason: 'bad' };
    const head = parts[0].split(FS);
    const groups = head[1] ? head[1].split(GS) : [];
    const ptsStr = parts.slice(1);
    if (checksum(head.slice(0, 2).join(FS) + RS + ptsStr.join(RS)) !== (head[2] || '')) {
      return { ok: false, reason: 'truncated' };
    }
    const points = [];
    for (const s of ptsStr) {
      const f = s.split(FS);
      if (f.length < 4) continue;
      const cat = f[3].charAt(0) === '#' ? f[3].slice(1) : (CATS[parseInt(f[3], 10)] || 'qita');
      const gi = parseInt(f[4], 36);
      const grp = isNaN(gi) ? '' : (groups[gi] || '');
      points.push({
        name: f[0],
        category: cat,
        group: grp,
        section: grp,
        reason: '',
        quote: '',
        latitude: unb36(f[1]),
        longitude: unb36(f[2]),
        located: true
      });
    }
    if (!points.length) return { ok: false, reason: 'empty' };
    // sourceTitle 留空：导入时由 importPack 统一写成「好友分享」
    return { ok: true, data: { name: head[0] || '分享的点位', sourceTitle: '', points: points } };
  } catch (e) {
    return { ok: false, reason: 'bad' };
  }
}

/**
 * 分享链接：能直传就带上数据，装不下就给一张「说明卡」。
 *
 * ⚠ 为什么指向 sharepanel 而不是 map：微信点开分享卡片时，如果 path 指向
 *   **tabBar 页面**，内部走的是 switchTab 语义，**query 参数会被丢掉**。
 *   地图页在 tabBar 里，所以必须让一个「不在 tabBar 里的页面」当代收点，
 *   解析完再 switchTab 去地图。sharepanel 正好身兼「发送 / 接收」两职。
 *
 * ★ 第八十轮：装不下时不再甩一个空地图页（tabBar 页 query 必丢，好友点开
 *   看到一张没有点位的空地图，还以为分享坏了）——改成 big 说明卡，
 *   告诉他这份点位较多、该走二维码海报 / 复制分享码 / 发文件。
 */
function pathOf(code, count) {
  if (!code || code.length > PATH_LIMIT) {
    return '/pages/sharepanel/sharepanel?big=1' + (count ? '&n=' + encodeURIComponent(count) : '');
  }
  return '/pages/sharepanel/sharepanel?c=' + code;
}

/** 收到过的分享码做个指纹，避免同一条链接反复导入出多篇一样的攻略 */
function hashOf(code) {
  const s = String(code || '');
  return s.length + '.' + checksum(s.slice(0, 200)) + '.' + checksum(s.slice(-200));
}

/** 打开分享面板（各页分享按钮统一走这里，参数靠 storage 传，不受 URL 长度限制） */
function openPanel(opt) {
  try { store.set('share_panel_ctx', opt || {}); } catch (e) { /* ignore */ }
  router.navigate('/sharepanel');
}

/* ================= 打包 / 解包 ================= */

/** 压成分享包里的点位（只留能画到地图上的字段）
 * @param {boolean} [withImage] 为 true 时额外带上 imageUrls（仅作「哪张图属于哪个点」的映射，
 *        图片二进制走文件信封的 imgs 字段，复制码 / 二维码本身不携带字节）。
 */
function toPoint(p, group, withImage) {
  const tp = {
    n: String(p.name || '未命名点位').slice(0, 40),
    c: p.category || 'qita',
    g: String(group || p.group || '').slice(0, 20),
    rz: String(p.reason || p.note || '').slice(0, 120),
    lt: Number(p.latitude) || 0,
    lg: Number(p.longitude) || 0
  };
  if (withImage) {
    const iu = (p.imageUrls || []).filter(u => String(u || '').trim()).slice(0, 6);
    if (iu.length) tp.iu = iu;
  }
  return tp;
}

function locatedOnly(list) {
  return (list || []).filter(p => p && p.latitude && p.longitude);
}

/**
 * 打包成分享码
 * @param {{withImage?:boolean}} [opts] withImage=true 时让点位带上 imageUrls（仅映射，字节另走信封）
 * @returns {{ok:boolean, code:string, count:number, title:string, reason?:string, hasImage?:boolean, _points?:Array}}
 */
function packCode(name, points, meta, opts) {
  const wi = !!(opts && opts.withImage);
  const pts = (points || []).map(p => toPoint(p, meta && meta.group, wi)).filter(p => p.lt && p.lg).slice(0, MAX_PTS);
  if (!pts.length) return { ok: false, reason: 'empty' };
  const payload = {
    app: 'midian',
    v: 1,
    n: String(name || '我的点位').slice(0, 30),
    s: String((meta && meta.sourceTitle) || '觅点寻迹').slice(0, 20),
    p: pts
  };
  // 同时给出 MIDX1（完整，用于复制/文件）与 MIDX2（紧凑，用于链接/二维码）
  const c = packCompact(payload.n, pts);
  return {
    ok: true,
    code: PREFIX + bytesToB64(utf8Bytes(JSON.stringify(payload))),
    compact: c.ok ? c.code : '',
    chars: c.ok ? c.chars : 0,
    fitsPath: !!(c.ok && c.fitsPath),
    count: pts.length,
    title: payload.n + ' · ' + pts.length + ' 个点位',
    name: payload.n,
    desc: pts.length + ' 个点位 · 来自觅点寻迹',
    // 供带图文件分享复用：原始点位（含 imageUrls）与「是否含图」标记
    hasImage: (points || []).some(p => (p.imageUrls || []).filter(u => String(u || '').trim()).length > 0),
    _points: points
  };
}

/** 解分享码（MIDX1 / MIDX2 都能吃），失败返回 {ok:false, reason} */
function unpackCode(code) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (raw.slice(0, PREFIX2.length) === PREFIX2) return unpackCompact(raw);
  if (raw.slice(0, PREFIX.length) !== PREFIX) return { ok: false, reason: 'prefix' };
  try {
    const data = JSON.parse(bytesToUtf8(b64ToBytes(raw.slice(PREFIX.length))));
    if (!data || !Array.isArray(data.p) || !data.p.length) return { ok: false, reason: 'empty' };
    return {
      ok: true,
      data: {
        name: String(data.n || '分享的点位'),
        sourceTitle: String(data.s || ''),
        points: data.p.map(x => ({
          name: String(x.n || ''),
          category: x.c || 'qita',
          group: String(x.g || ''),
          section: String(x.g || ''),
          reason: String(x.rz || ''),
          quote: '',
          latitude: Number(x.lt) || 0,
          longitude: Number(x.lg) || 0,
          located: !!(x.lt && x.lg),
          // ★ 第八十三轮：带图分享时 toPoint 把图片映射塞进 iu，这里原样带回，
          //   导入侧再交给 imgpack.unpack 还原成新的本地路径
          imageUrls: Array.isArray(x.iu) ? x.iu.slice(0, 6).map(String) : []
        })).filter(p => p.name)
      }
    };
  } catch (e) {
    return { ok: false, reason: 'bad' };
  }
}

/** 判断一段文本是不是本小程序的分享码（两种编码都算） */
function isShareCode(text) {
  const t = String(text || '').trim();
  return t.slice(0, PREFIX.length) === PREFIX || t.slice(0, PREFIX2.length) === PREFIX2;
}

/* ================= 同步打包入口（第五十六轮） =================
 *
 * 为什么要有同步版：onShareAppMessage 必须**同步**返回 path，
 * 而现有 guide()/favFolder() 这些历史函数都返回 Promise（当年为云端同步留的）。
 * 现在打包纯本地计算、几毫秒就完事，完全可以同步算完再返回，
 * 这样分享卡片就能直接带上点位数据 —— 好友点开就是一张现成的地图。
 */

function packOf(kind, opt) {
  const o = opt || {};
  switch (kind) {
    case 'guide':
    case 'guidePoint': {
      const g = guides.getById(o.id);
      if (!g) return { ok: false, reason: 'gone' };
      if (kind === 'guidePoint') {
        const p = (g.points || []).find(x => x.id === o.pid);
        if (!p) return { ok: false, reason: 'gone' };
        return packCode(p.name || '我的点位', [p], { sourceTitle: '觅点寻迹' });
      }
      return packCode(g.name || '我的攻略', g.points || [], { sourceTitle: '觅点寻迹' });
    }
    case 'favFolder': {
      const node = favorites.nodeById ? favorites.nodeById(o.id) : null;
      if (!node) return { ok: false, reason: 'gone' };
      const pts = favorites.collectPoints ? favorites.collectPoints(node.id) : (node.points || []);
      return packCode(node.name + ' · 我的点位收藏', pts, { sourceTitle: '觅点寻迹' });
    }
    case 'fvFolder': {
      const f = follow.getView().find(x => x.id === o.id);
      if (!f) return { ok: false, reason: 'gone' };
      const pts = [];
      for (const g of (f.guides || [])) {
        const full = guides.getById(g.id);
        for (const p of ((full && full.points) || [])) pts.push(toPoint(p, (full && full.name) || g.name));
      }
      return packCode(f.name + ' · 攻略合集', pts, { sourceTitle: '觅点寻迹' });
    }
    /**
     * ★ 第六十二轮：'point' 是收藏页点位行历史上写的 kind，而打包一直只认
     *   'favPoint' —— 于是「收藏页点分享」走到 default 分支返回 reason:'kind'，
     *   界面上就成了一句莫名其妙的「没有可分享的点位」（第六十二轮用户报的 bug）。
     *   这里把两者都接到同一条实现上，wxml 那边也已统一改成 favPoint。
     */
    case 'point':
    case 'favPoint': {
      const node = favorites.nodeById ? favorites.nodeById(o.fid) : null;
      const list = node ? (node.points || []) : [];
      const p = list.find(x => (x.id || x.key) === o.key);
      if (!p) return { ok: false, reason: 'gone' };
      return packCode(p.name || '我的收藏点位', [p], { sourceTitle: '觅点寻迹' });
    }
    case 'allFav': {
      const pts = favorites.allPoints ? favorites.allPoints() : [];
      return packCode('我的点位收藏', pts, { sourceTitle: '觅点寻迹' });
    }
    case 'allFollow': {
      const seen = {};
      const pts = [];
      for (const f of follow.getView()) {
        for (const g of (f.guides || [])) {
          if (seen[g.id]) continue;
          seen[g.id] = true;
          const full = guides.getById(g.id);
          for (const p of ((full && full.points) || [])) pts.push(toPoint(p, (full && full.name) || g.name));
        }
      }
      return packCode('我的攻略收藏', pts, { sourceTitle: '觅点寻迹' });
    }
    case 'loc': {
      // 地图弹窗里的「分享这个位置」：只有一个点位
      if (!o.lat || !o.lng) return { ok: false, reason: 'empty' };
      return packCode(o.name || '地图位置', [{
        name: o.name || '地图位置',
        latitude: o.lat,
        longitude: o.lng,
        category: o.category || 'qita'
      }], { sourceTitle: '来自觅点寻迹' });
    }
    default:
      return { ok: false, reason: 'kind' };
  }
}

/* ================= 导出动作 ================= */

/** 复制到剪贴板并给出下一步提示（网页版用 Clipboard API） */
function copyPack(pack) {
  if (!pack || !pack.ok) {
    ui.toast(pack && pack.reason === 'empty' ? '这个内容里没有可分享的点位' : '分享内容整理失败', 'none');
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(pack.code).then(() => {
    return ui.modal({
      title: '分享码已复制',
      content: '共 ' + pack.count + ' 个点位。把它粘贴发给好友，好友在「我的 → 导入分享码」里粘贴即可看到同样的点位。',
      showCancel: false,
      confirmText: '知道了'
    }).then(() => true);
  }).catch(() => {
    // 剪贴板不可用（非 HTTPS / 旧浏览器 / 权限被拒）→ 退回下载文件
    ui.toast('剪贴板不可用，已改为下载文件', 'none');
    return filePack(pack);
  });
}

/** 下载成 .txt 文件（网页版替代微信的「转发文件」渠道；安卓壳走原生桥） */
function filePack(pack) {
  if (!pack || !pack.ok) return Promise.resolve(false);
  return dl.saveText((pack.title || '觅点寻迹分享') + '.txt', pack.code).then(() => true);
}

/** 打包 + 复制，一步到位（页面分享按钮直接调它） */
function shareOut(name, points, meta) {
  const pack = packCode(name, points, meta);
  return copyPack(pack).then(() => pack);
}

/* ================= 各入口（保持旧函数名，页面改动最小） ================= */

function savePack(name, points, meta) {
  return Promise.resolve(packCode(name, points, meta));
}

function guide(gid) {
  const g = guides.getById(gid);
  if (!g) return Promise.resolve({ ok: false, reason: 'gone' });
  return Promise.resolve(packCode(g.name || '我的攻略', g.points || [], { sourceTitle: '觅点寻迹' }));
}

function favFolder(fid) {
  const tree = favorites.getTree();
  const node = (function find(nodes) {
    for (const n of nodes || []) {
      if (n.id === fid) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  })(tree);
  if (!node) return Promise.resolve({ ok: false, reason: 'gone' });
  const pts = favorites.collectPoints ? favorites.collectPoints(node.id) : (node.points || []);
  return Promise.resolve(packCode(node.name + ' · 我的点位收藏', pts, { sourceTitle: '觅点寻迹' }));
}

function allFav() {
  const pts = favorites.allPoints ? favorites.allPoints() : [];
  return Promise.resolve(packCode('我的点位收藏', pts, { sourceTitle: '觅点寻迹' }));
}

function fvFolder(fid) {
  const f = follow.getView().find(x => x.id === fid);
  if (!f) return Promise.resolve({ ok: false, reason: 'gone' });
  const pts = [];
  for (const g of (f.guides || [])) {
    const full = guides.getById(g.id);
    for (const p of ((full && full.points) || [])) pts.push(toPoint(p, (full && full.name) || g.name));
  }
  return Promise.resolve(packCode(f.name + ' · 攻略合集', pts, { sourceTitle: '觅点寻迹' }));
}

function allFollow() {
  const seen = {};
  const pts = [];
  for (const f of follow.getView()) {
    for (const g of (f.guides || [])) {
      if (seen[g.id]) continue;
      seen[g.id] = true;
      const full = guides.getById(g.id);
      for (const p of ((full && full.points) || [])) pts.push(toPoint(p, (full && full.name) || g.name));
    }
  }
  return Promise.resolve(packCode('我的攻略收藏', pts, { sourceTitle: '觅点寻迹' }));
}

function favPoint(fid, key) {
  const node = favorites.nodeById ? favorites.nodeById(fid) : null;
  const list = node ? (node.points || []) : [];
  const p = list.find(x => (x.id || x.key) === key);
  if (!p) return Promise.resolve({ ok: false, reason: 'gone' });
  return Promise.resolve(packCode(p.name || '我的收藏点位', [p], { sourceTitle: '觅点寻迹' }));
}

function guidePoint(gid, pid) {
  const g = guides.getById(gid);
  const p = g && (g.points || []).find(x => x.id === pid);
  if (!p) return Promise.resolve({ ok: false, reason: 'gone' });
  return Promise.resolve(packCode(p.name || '我的点位', [p], { sourceTitle: '觅点寻迹' }));
}

/**
 * 导入分享码 → 落成一篇本机攻略
 * @returns {{ok:boolean, guide?:object, count?:number, reason?:string}}
 */
function importPack(code) {
  const r = unpackCode(code);
  if (!r.ok) return { ok: false, reason: r.reason };
  const g = guides.create({
    name: r.data.name,
    sourceTitle: r.data.sourceTitle || '好友分享',
    rawText: '',
    points: r.data.points
  });
  return { ok: true, guide: g, count: r.data.points.length };
}

export default {
  PREFIX, PREFIX2, PATH_LIMIT, MAX_PTS,
  packCode, unpackCode, isShareCode, toPoint, locatedOnly,
  packCompact, unpackCompact, pathOf, packOf, hashOf, openPanel,
  copyPack, filePack, shareOut,
  savePack, guide, favFolder, allFav, fvFolder, allFollow, favPoint, guidePoint,
  importPack,
  // ★ 第八十三轮：带图文件分享
  buildImgEnvelope, parseImgEnvelope, isImgEnvelope, importEnvelope, filePackEnvelope,
  // 便于单测
  _b64: { utf8Bytes, bytesToB64, b64ToBytes, bytesToUtf8, bytesToB64Url, b64UrlToBytes, checksum }
};

/* ================= 带图文件分享（第八十三轮） =================
 *
 * 为什么需要它：本地图存在手机里是临时文件路径（wxfile://tmp_xxx），复制码 / 二维码 /
 * 转发卡片三种渠道要么容量受限、要么无法携带二进制，永远带不了图。唯一零后端能把图
 * 带给好友的方式，是把图片读成 base64 一起塞进「发文件」的分享文件里 —— 复用 R65
 * 的 imgpack 引擎（本地图读 base64、网络图先下载），导入侧再还原成新路径。
 *
 * 文件长这样（JSON 文本，扩展名 .txt 方便聊天里选）：
 *   { "app":"midian", "v":2, "kind":"imgpack", "code":"MIDX1.xxx", "imgs":{ "<原路径>":"<base64>", ... } }
 * 其中 code 是普通分享码（toPoint 已带 iu 图片映射），imgs 是图片二进制池。
 */

/**
 * 打包成「带图分享信封」
 * @returns {Promise<{ok:boolean, fileData?:string, title?:string, name?:string, count?:number, hasImage?:boolean, packed?:number, skipped?:number, bytes?:number, reason?:string}>}
 */
async function buildImgEnvelope(name, points, meta) {
  const pack = packCode(name, points, meta, { withImage: true });
  if (!pack.ok) return { ok: false, reason: pack.reason };
  // 从原始点位（pack._points 含 imageUrls）收集图片地址，去重保序
  const urls = [];
  const seen = {};
  for (const p of (pack._points || [])) {
    for (const u of ((p && p.imageUrls) || [])) {
      const s = String(u || '').trim();
      if (s && !seen[s]) { seen[s] = 1; urls.push(s); }
    }
  }
  let imgs = {};
  let packed = 0, skipped = 0, bytes = 0;
  if (urls.length) {
    const r = await imgpack.pack(urls);
    imgs = r.imgs || {};
    packed = r.packed;
    skipped = r.skipped;
    bytes = r.bytes;
  }
  const envelope = { app: 'midian', v: 2, kind: 'imgpack', code: pack.code, imgs: imgs };
  return {
    ok: true,
    fileData: JSON.stringify(envelope),
    title: pack.title,
    name: pack.name,
    count: pack.count,
    hasImage: urls.length > 0,
    packed: packed,
    skipped: skipped,
    bytes: bytes
  };
}

/** 解析带图信封文本；不是信封返回 {ok:false} */
function parseImgEnvelope(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{') return { ok: false, reason: 'prefix' };
  try {
    const d = JSON.parse(t);
    if (!d || d.app !== 'midian' || d.kind !== 'imgpack' || !d.code) return { ok: false, reason: 'bad' };
    return { ok: true, code: String(d.code), imgs: d.imgs || {} };
  } catch (e) {
    return { ok: false, reason: 'bad' };
  }
}

/** 判断一段文本是不是带图分享信封 */
function isImgEnvelope(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{') return false;
  try {
    const d = JSON.parse(t);
    return !!(d && d.app === 'midian' && d.kind === 'imgpack' && d.code);
  } catch (e) { return false; }
}

/**
 * 导入带图信封：解分享码 → 落成攻略 → 还原图片到新本地路径
 * @returns {Promise<{ok:boolean, guide?:object, count?:number, restored?:number, failed?:number, hasImage?:boolean, reason?:string}>}
 */
async function importEnvelope(raw) {
  const d = parseImgEnvelope(raw);
  if (!d.ok) return { ok: false, reason: d.reason };
  const r = unpackCode(d.code);
  if (!r.ok) return { ok: false, reason: r.reason };
  let points = r.data.points;
  let restored = 0, failed = 0;
  if (d.imgs && Object.keys(d.imgs).length) {
    const u = await imgpack.unpack(d.imgs);
    const map = u.pathMap || {};
    restored = u.restored;
    failed = u.failed;
    // 在落成攻略之前就把 imageUrls 换成新路径，一次写盘即生效
    points = points.map(p => {
      if (!p.imageUrls || !p.imageUrls.length) return p;
      const nu = p.imageUrls.map(old => map[old] || old);
      return Object.assign({}, p, { imageUrls: nu });
    });
  }
  const g = guides.create({
    name: r.data.name,
    sourceTitle: r.data.sourceTitle || '好友分享',
    rawText: '',
    points: points
  });
  return { ok: true, guide: g, count: points.length, restored, failed, hasImage: !!d.imgs && Object.keys(d.imgs).length > 0 };
}

/** 把带图信封下载成 .txt 文件（网页版替代微信的「转发文件」；安卓壳走原生桥） */
function filePackEnvelope(env) {
  if (!env || !env.ok) return Promise.resolve(false);
  return dl.saveText((env.title || '觅点寻迹分享') + '（带图）.txt', env.fileData).then(() => true);
}
