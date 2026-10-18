/**
 * qqmap.js —— 腾讯位置服务（map.qq.com）全量地图能力（第十五 / 十八 / 十九轮）
 *
 * ★ 第五十三轮：本地版的**唯一联网能力**（增强服务是可选的）。
 *   小程序 <map> 组件底层就是腾讯地图，所以「搜地点 / 坐标转地名 / 地名转坐标」
 *   都走腾讯位置服务 WebService，一套坐标系（GCJ-02），不会出现偏移。
 *
 * 用到接口：地点搜索 place/v1/search、逆地理 & 地理编码 geocoder/v1。
 *
 * ── Key 取值顺序（第五十三轮改为「用户优先」）──────────
 *   ① 用户自己在「我的 → 服务与 Key 设置」填的 Key（storage: qqmap_key）
 *   ② 内置共享 Key 兜底（日配额大家共用，容易撞上限 → 提示用户换成自己的）
 * 小程序端还要在微信公众平台 → 开发管理 → 服务器域名 → request 合法域名里加
 *   https://apis.map.qq.com
 * 常见状态码：0 成功 / 121 当日配额用尽（次日 0 点重置，非配置错误）/
 *             199 未开启 WebServiceAPI / 111 签名校验失败。
 */
import config from './config.js';
import store from '../store.js';
import http from '../http.js';
const BASE_SEARCH = 'https://apis.map.qq.com/ws/place/v1/search';
const BASE_GEOCODER = 'https://apis.map.qq.com/ws/geocoder/v1/';

// 内置 Key 池（对应小程序 AppID wx26bc95f14b667072），作为没填用户 Key 时的兜底。
// ★ 第六十轮：腾讯位置服务**个人主体可以免费申请多个 Key**，每个约 5000 次/日。
//   撞到 121 就自动换下一个，额度直接翻倍 —— 往数组里加 Key 即可，别的都不用改。
const BUILTIN_KEYS = [
  'FRKBZ-6WL6T-M7HXS-L3DWN-W42T7-WFF3I'
];
let _keyIdx = 0;                                  // 当前用池里第几个
const KEY = BUILTIN_KEYS[0];                      // 兼容旧引用
function builtinKey() { return BUILTIN_KEYS[_keyIdx] || BUILTIN_KEYS[0]; }
/** 换池里的下一个内置 Key（还有就 true，全用尽才 false） */
function switchBuiltinKey() {
  if (_keyIdx + 1 < BUILTIN_KEYS.length) { _keyIdx += 1; return true; }
  return false;
}

function getKey() {
  let mine = '';
  try { mine = store.get('qqmap_key') || ''; } catch (e) { mine = ''; }
  if (mine && String(mine).trim()) return String(mine).trim();      // ① 用户自己的 Key 优先
  if (builtinKey()) return builtinKey();                            // ② 内置池兜底
  return (config && config.qqmapKey) || '';                          // ③ 配置文件
}

/** 当前用的是用户自己的 Key 还是内置共享 Key（自检页要区分提示） */
function usingOwnKey() {
  let mine = '';
  try { mine = store.get('qqmap_key') || ''; } catch (e) { mine = ''; }
  return !!(mine && String(mine).trim());
}

function hasKey() { return !!getKey(); }

/* ================= 坐标缓存（第六十轮） =================
 *
 * 起因：内置共享 Key 日配额约 5000 次，一个攻略 20 个点位就吃掉 20 次，
 *       多人同时用很快就撞上限 → 全部点位 located=false → 地图上一个标点都没有
 *       （用户看到的现象：解析成功但地图空白、分享提示「没有可分享的点位」）。
 *
 * 对策：查过的地名**永久缓存在本机**（地名坐标不会变），再遇到同名就直接命中，
 *       一次请求都不发。连「查不到」也缓存，避免同一个错名反复重试烧配额。
 */
const CACHE_KEY = 'geo_cache';
const CACHE_MAX = 800;        // 最多缓存 800 条，约几十 KB，不会撑爆 storage
const CACHE_TTL = 90 * 24 * 3600 * 1000;   // 90 天

function _cacheRead() {
  try { return store.get(CACHE_KEY) || {}; } catch (e) { return {}; }
}
function _cacheWrite(c) {
  try { store.set(CACHE_KEY, c); } catch (e) { /* 满了就算了，不影响主流程 */ }
}
function cacheGet(kw) {
  const k = String(kw || '').trim().toLowerCase();
  if (!k) return null;
  const c = _cacheRead();
  const hit = c[k];
  if (!hit) return null;
  if (hit.t && Date.now() - hit.t > CACHE_TTL) return null;   // 过期当没命中
  return hit;
}
function cacheSet(kw, hit) {
  const k = String(kw || '').trim().toLowerCase();
  if (!k) return;
  const c = _cacheRead();
  c[k] = hit
    ? { t: Date.now(), name: hit.name, latitude: hit.latitude, longitude: hit.longitude }
    : { t: Date.now(), none: true };          // none=true：查过了，确实没有
  const keys = Object.keys(c);
  if (keys.length > CACHE_MAX) {              // 超上限丢掉最旧的一半
    keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
    keys.slice(0, Math.floor(CACHE_MAX / 2)).forEach(k2 => { delete c[k2]; });
  }
  _cacheWrite(c);
}
/** 缓存命中数（自检页展示，顺便让用户看到省了多少配额） */
function cacheStats() {
  const c = _cacheRead();
  const ks = Object.keys(c);
  let real = 0;
  ks.forEach(k => { if (!c[k].none) real++; });
  return { total: ks.length, located: real };
}

/* ================= 配额熔断（第六十轮） =================
 * 121 = 当日配额用尽。撞到一次之后，本次会话里后续请求一律直接短路，
 * 不再把剩下十几个点位挨个打一遍（既慢又全是失败）。
 * 日期写进 storage，跨冷启动也记得住 —— 腾讯是次日 0 点重置，所以按天判断。
 */
const QUOTA_KEY = 'geo_quota_date';
let _quotaOut = false;
function _today() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function quotaOut() {
  if (_quotaOut) return true;
  // 按「日期」判断：腾讯是次日 0 点重置，所以跨天自动失效，不用额外清理。
  // 换了 Key（saveKeySettings）会调 resetQuota() 主动清掉。
  try {
    if (store.get(QUOTA_KEY) === _today()) { _quotaOut = true; return true; }
  } catch (e) { /* ignore */ }
  return false;
}
function markQuotaOut() {
  _quotaOut = true;
  try { store.set(QUOTA_KEY, _today()); } catch (e) { /* ignore */ }
}
/** 用户换成自己的 Key 之后，把熔断状态清掉（否则换了也还是短路） */
function resetQuota() {
  _quotaOut = false;
  try { store.remove(QUOTA_KEY); } catch (e) { /* ignore */ }
}

/** 统一的 GET 请求封装 */
function get(url) {
  return http.get(url);
}

/**
 * 关键词搜地点
 * @returns Promise<{ code, data:[{name,address,latitude,longitude,province,city,district}], message }>
 */
function search(keywords, opts, retried) {
  const o = opts || {};
  const key = getKey();
  if (!key) return Promise.resolve({ code: -1, data: [], message: 'NO_KEY' });

  // ⑥ 第六十轮：配额熔断中 → 直接短路，一次请求都不发（返回空结果，调用方回落规则/提示）
  if (quotaOut()) {
    return Promise.resolve({ code: 121, data: [], message: '今日定位额度已用完' });
  }

  const city = (o.city || '').trim();
  const nearby = (o.latitude != null && o.longitude != null && !city);
  // 只有「全国范围按名字搜」才缓存 —— 带城市/带视野的结果不具通用性，缓存会串味
  const canCache = !city && !nearby && o.noCache !== true;
  const kw = String(keywords || '');

  // ⑦ 先查本机缓存，命中就零请求返回
  if (canCache) {
    const hit = cacheGet(kw);
    if (hit) {
      if (hit.none) return Promise.resolve({ code: 0, data: [], message: '' });
      return Promise.resolve({
        code: 0,
        data: [{ name: hit.name || kw, address: '', latitude: hit.latitude, longitude: hit.longitude, province: '', city: '', district: '' }],
        message: '', cached: true
      });
    }
  }

  let boundary;
  if (o.latitude != null && o.longitude != null && !city) {
    // 以地图中心为圆心搜附近，更贴近用户当前视野
    boundary = 'nearby(' + o.latitude + ',' + o.longitude + ',10000,1)';
  } else if (city) {
    boundary = 'region(' + city + ',0)';
  } else {
    boundary = 'region(全国,0)';
  }
  const qs = [
    'keyword=' + encodeURIComponent(keywords),
    'boundary=' + encodeURIComponent(boundary),
    'page_size=10',
    'page_index=1',
    'orderby=_distance',
    'key=' + key
  ].join('&');
  return get(BASE_SEARCH + '?' + qs).then((d) => {
    if (d.status === 0 && Array.isArray(d.data)) {
      const arr = d.data.map(p => ({
        name: p.title || '',
        address: p.address || '',
        latitude: p.location && p.location.lat,
        longitude: p.location && p.location.lng,
        province: p.province || '',
        city: p.city || '',
        district: p.district || ''
      }));
      // 查到了写缓存；一条都没有也写（记 none），下次不再为这个地名白花一次配额
      if (canCache) cacheSet(kw, arr[0] || null);
      return { code: 0, data: arr, message: '' };
    }
    // 121 = 当日配额用尽：先试试池里下一个内置 Key，全用尽了才熔断
    if (d.status === 121) {
      if (!usingOwnKey() && switchBuiltinKey() && !retried) {
        return search(keywords, opts, true);      // 换 Key 重试一次
      }
      markQuotaOut();
    }
    return { code: d.status || -2, data: [], message: d.message || '搜索失败' };
  });
}

/**
 * 逆地理：坐标 → 地名（第十九轮新增，替代原来的高德通道）
 *
 * 名称优先级（与腾讯 get_poi 返回结构对应）：
 *   最近 POI 名 > 行政区划（省市区）> 街道名
 * 注意 get_poi=1 且 poigap 默认 200m 内没有 POI 时，pois 会是空数组，
 * 这时退回「省市区 + 街道」，不会像高德 base 模式那样只能拿到行政区名。
 *
 * @returns Promise<{code, data:{name,address,region}, message}>
 */
function regeo(latitude, longitude) {
  const key = getKey();
  if (!key) return Promise.resolve({ code: -1, message: 'NO_KEY' });
  const lat = Number(latitude), lng = Number(longitude);
  if (!isFinite(lat) || !isFinite(lng)) return Promise.resolve({ code: 400, message: '坐标无效' });
  const qs = 'location=' + lat + ',' + lng + '&get_poi=1&poi_options=page_size=1;radius=300&key=' + key;
  return get(BASE_GEOCODER + '?' + qs).then((d) => {
    if (d.status !== 0 || !d.result) {
      return { code: d.status || 500, message: d.message || '逆地理失败' };
    }
    const r = d.result;
    const ac = r.address_component || {};
    const ad = r.ad_info || {};
    // ★ 第四十八轮：过滤掉「纯数字」行政区成分。
    //   腾讯对个别行政区（尤其直辖市/新区）会在 city/district 里回 adcode
    //   （如 "000000" / "110000"），直接拼进来会得到「北京110000朝阳区」这种，
    //   甚至整串都是数字 → 地图标签上显示成「000」。这里把纯数字成分剔除。
    const clean = (v) => {
      if (!v || typeof v !== 'string') return '';
      const t = v.trim();
      if (!t) return '';
      if (/^[\d.\-,\s]+$/.test(t)) return '';   // 纯 adcode / 数字
      if (t.length < 2) return '';              // 单个字符不足以成地名
      return t;
    };
    const region = [clean(ac.province || ad.province), clean(ac.city || ad.city), clean(ac.district || ad.district)]
      .filter(Boolean)
      .join('');
    // r.pois 是数组（get_poi=1 时才有）；取第 1 个作为最贴近的名称
    let name = '';
    if (Array.isArray(r.pois) && r.pois.length && r.pois[0] && r.pois[0].title) {
      name = r.pois[0].title;
    } else if (r.formatted_addresses && r.formatted_addresses.recommend) {
      name = r.formatted_addresses.recommend;
    }
    // ★ 第四十八轮：POI 名也可能是纯数字（个别脏数据）→ 交给调用方时一并过滤
    if (name && /^[\d.\-,\s]+$/.test(String(name).trim())) name = '';
    const address = r.address || (r.formatted_addresses && r.formatted_addresses.rough) || region;
    return { code: 0, data: { name: name || region || '', address, region } };
  });
}

/**
 * 地理编码：地址 → 坐标（第十九轮新增，云函数里批量编码用同一套 Key）
 * @returns Promise<{code, data:{latitude,longitude,region}, message}>
 */
function geocode(address, city) {
  const key = getKey();
  if (!key) return Promise.resolve({ code: -1, message: 'NO_KEY' });
  const qs = 'address=' + encodeURIComponent(address)
    + (city ? '&region=' + encodeURIComponent(city) : '')
    + '&key=' + key;
  return get(BASE_GEOCODER + '?' + qs).then((d) => {
    if (d.status !== 0 || !d.result || !d.result.location) {
      return { code: d.status || 500, message: d.message || '地理编码失败' };
    }
    const loc = d.result.location;
    const ad = d.result.ad_info || {};
    return {
      code: 0,
      data: {
        latitude: loc.lat,
        longitude: loc.lng,
        region: [ad.province, ad.city, ad.district].filter(Boolean).join('')
      }
    };
  });
}

export default {
  search, regeo, geocode, hasKey, getKey, usingOwnKey, KEY,
  // 第六十轮新增
  quotaOut, resetQuota, cacheStats, cacheSet, cacheGet,
  builtinKey, switchBuiltinKey, BUILTIN_KEYS,
  QUOTA_HINT: '今日定位额度已用完，次日 0 点自动恢复。可在「我的 → 服务与 Key 设置」填自己的地图 Key，立即恢复且额度独立。'
};
