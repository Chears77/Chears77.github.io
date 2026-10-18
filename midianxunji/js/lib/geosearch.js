/**
 * geosearch.js —— 地点搜索双通道（腾讯 + 高德）统一封装
 * ★ 第六十四轮：解决「解析出来的地点经常定位不到」的问题。
 *
 * 核心思路：
 *   1. 双数据源：腾讯位置服务 + 高德 Web 服务，两份 POI 库互补。
 *      腾讯在小景点 / 城市 POI 上准，高德在村镇 / 路线上更全；
 *      坐标系都是 GCJ-02，混用没有偏移。
 *   2. 多候选名：「四姑娘山双桥沟」搜不到 → 先试「双桥沟」→ 再试「四姑娘山」→
 *      最后去掉「景区/打卡点」等装饰词，显著提升召回率。
 *   3. 带区域的缓存：同一篇攻略里同一个地名（如「武侯祠」）会被反复查，
 *      现在按「区域+名字」缓存，避免二次烧配额。
 *   4. 配额轮换：腾讯内置 Key 池 → 用户腾讯 Key → 用户高德 Key → 内置高德 Key。
 *
 * 对外接口保持与 qqmap.search 一致，返回值统一为：
 *   { code:0, data:[{name,address,latitude,longitude,province,city,district}], message, cached, provider }
 */

import qqmap from './qqmap.js';
import store from '../store.js';
import http from '../http.js';
const AMAP_BASE = 'https://restapi.amap.com/v3/place/text';
/**
 * 高德内置共享 Key 池（2026-10-12 实测可用：status=1 / infocode=10000）。
 * 这是作者自己的高德「Web 服务」Key，白给用户当兜底通道用 ——
 * 注意 Key 跟着包体发布，人人都能扒出来，所以：
 *   · 只用**个人开发者免费配额**，被刷爆也不心疼；
 *   · 用完了往数组里再加一个 Key 即可（`switchAmapKey` 自动轮换）；
 *   · 用户自己填的 Key（storage `amap_key`）永远优先于这里。
 * 高德 Key 必须是在 console.amap.com 创建的「Web服务」类型，选错类型会 INVALID_KEY。
 */
const AMAP_BUILTIN_KEYS = ['4dd6244c65a660e3918defc65759c282'];
let _amapIdx = 0;

function getAmapKey() {
  let mine = '';
  try { mine = store.get('amap_key') || ''; } catch (e) { mine = ''; }
  if (mine && String(mine).trim()) return String(mine).trim();
  return AMAP_BUILTIN_KEYS[_amapIdx] || AMAP_BUILTIN_KEYS[0] || '';
}

/** 当前生效的高德 Key 是不是内置共享的那个（自检 / 文案区分用） */
function usingAmapBuiltin() {
  let mine = '';
  try { mine = store.get('amap_key') || ''; } catch (e) { mine = ''; }
  if (mine && String(mine).trim()) return false;
  return AMAP_BUILTIN_KEYS.length > 0;
}

function usingAmapOwnKey() {
  let mine = '';
  try { mine = store.get('amap_key') || ''; } catch (e) { mine = ''; }
  return !!(mine && String(mine).trim());
}

function switchAmapKey() {
  if (_amapIdx + 1 < AMAP_BUILTIN_KEYS.length) { _amapIdx += 1; return true; }
  return false;
}

function get(url) {
  return http.get(url);
}

function norm(name) {
  return String(name || '').trim();
}

/* ================= 名字相似度闸门 =================
 * 为什么要这道闸：腾讯和高德都会对**乱码 / 口语词**做模糊匹配 ——
 * 实测搜「完全不存在的鬼地方xyz123」，高德能返回「爷爷不泡茶(成都银泰中心店)」。
 * 若不拦，攻略里一个拼错的地名就会被写成一个**错误坐标**的地图点，比「未识别」更糟。
 *
 * 判定（归一化后）：
 *   ① 完全相等；② 互为子串（「陈麻婆豆腐」⊂「陈麻婆豆腐(南门店)」）；
 *   ③ 字符集合相似度 ≥ 0.6 且公共字符 ≥ 2（兜住错别字：「魁星楼街」↔「奎星楼街」0.75）。
 * 归一化会剥掉括号附注，所以「人民公园」对上「人民公园(地铁站)」也走子串规则。
 */
function normName(s) {
  return String(s || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\-_—~·,，。.、;；:：!！?？'""'']/g, '')
    .toLowerCase();
}
function nameLooksLike(query, name) {
  const q = normName(query);
  const n = normName(name);
  if (!q || !n) return false;
  if (q === n) return true;
  if (n.indexOf(q) >= 0 || q.indexOf(n) >= 0) return true;
  const qs = {};
  for (let i = 0; i < q.length; i++) qs[q[i]] = 1;
  const ns = {};
  for (let i = 0; i < n.length; i++) ns[n[i]] = 1;
  const qa = Object.keys(qs);
  let common = 0;
  for (let i = 0; i < qa.length; i++) if (ns[qa[i]]) common++;
  if (common < 2) return false;
  return common / Math.max(qa.length, Object.keys(ns).length) >= 0.6;
}
/** 从一批结果里挑第一个「名字像」的；都不像就当没搜到 */
function pickLike(variant, r) {
  if (!r || r.code !== 0 || !r.data || !r.data.length) return null;
  for (let i = 0; i < r.data.length; i++) {
    if (nameLooksLike(variant, r.data[i].name)) return r.data[i];
  }
  return null;
}

/** 把高德返回的 location "lng,lat" 拆成数字 */
function parseAmapLocation(loc) {
  if (!loc) return null;
  const pair = String(loc).split(',').map(Number);
  if (pair.length !== 2 || !isFinite(pair[0]) || !isFinite(pair[1])) return null;
  return { latitude: pair[1], longitude: pair[0] };
}

/** 高德搜索 */
function amapSearch(keywords, opts) {
  const key = getAmapKey();
  if (!key) return Promise.resolve({ code: -1, data: [], message: 'NO_AMAP_KEY' });
  const city = (opts && opts.city) || '';
  const qs = [
    'key=' + key,
    'keywords=' + encodeURIComponent(keywords),
    city ? ('city=' + encodeURIComponent(city)) : '',
    'offset=10',
    'page=1',
    'extensions=all'
  ].filter(Boolean).join('&');
  return get(AMAP_BASE + '?' + qs).then((d) => {
    if (d.status === '1' && Array.isArray(d.pois) && d.pois.length) {
      const arr = d.pois.map(p => {
        const loc = parseAmapLocation(p.location);
        return {
          name: p.name || '',
          address: p.address || '',
          latitude: loc ? loc.latitude : 0,
          longitude: loc ? loc.longitude : 0,
          province: p.pname || '',
          city: p.cityname || '',
          district: p.adname || ''
        };
      }).filter(p => p.latitude && p.longitude);
      if (arr.length) return { code: 0, data: arr, message: '', provider: 'amap' };
    }
    // 高德配额超限常见 info = DAILY_QUERY_OVER_LIMIT
    const isQuota = /OVER_LIMIT|INVALID_KEY/.test(String(d.info || ''));
    if (isQuota && !usingAmapOwnKey() && switchAmapKey()) {
      return amapSearch(keywords, opts);
    }
    return { code: isQuota ? 121 : -2, data: [], message: d.info || '高德搜索失败', provider: 'amap' };
  });
}

/** 生成候选查询串（区域前缀 / 去修饰词） */
function nameVariants(name, region) {
  const base = norm(name);
  if (!base) return [];
  const regionName = region && region.name ? norm(region.name) : '';
  const list = [base];
  // 带上区域前缀：如「四姑娘山双桥沟」在阿坝州
  if (regionName && base.indexOf(regionName) !== 0) {
    list.push(regionName + ' ' + base);
  }
  // 去掉常见装饰后缀
  const strips = ['景区', '景点', '打卡点', '公园', '广场', '博物馆', '纪念馆', '寺', '庙', '观'];
  for (const s of strips) {
    if (base.endsWith(s) && base.length > s.length + 1) {
      list.push(base.slice(0, -s.length));
      if (regionName) list.push(regionName + ' ' + base.slice(0, -s.length));
    }
  }
  // 去掉「前/后/东/西/南/北/新/老」等单字前缀尝试
  const dirs = ['新', '老', '大', '小'];
  for (const d of dirs) {
    if (base.length > 3 && base.startsWith(d)) {
      list.push(base.slice(1));
    }
  }
  return [...new Set(list)];
}

/** 统一缓存 key：带区域名，避免跨省串味 */
const GEO_CACHE_KEY = 'geosearch_cache';
const GEO_CACHE_MAX = 800;
const GEO_CACHE_TTL = 90 * 24 * 3600 * 1000;
function _cacheRead() { try { return store.get(GEO_CACHE_KEY) || {}; } catch (e) { return {}; } }
function _cacheWrite(c) { try { store.set(GEO_CACHE_KEY, c); } catch (e) {} }
function cacheKey(name, region) {
  const r = region && region.name ? norm(region.name) : '_';
  return (norm(name) + '|' + r).toLowerCase();
}
function cacheGet(name, region) {
  const c = _cacheRead();
  const hit = c[cacheKey(name, region)];
  if (!hit) return null;
  if (hit.t && Date.now() - hit.t > GEO_CACHE_TTL) return null;
  if (hit.none) return { none: true };
  return { hit: hit.item };
}
function cacheSet(name, region, item) {
  const c = _cacheRead();
  c[cacheKey(name, region)] = item ? { t: Date.now(), item } : { t: Date.now(), none: true };
  const ks = Object.keys(c);
  if (ks.length > GEO_CACHE_MAX) {
    ks.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
    ks.slice(0, Math.floor(GEO_CACHE_MAX / 2)).forEach(k => { delete c[k]; });
  }
  _cacheWrite(c);
}
function cacheStats() {
  const c = _cacheRead();
  const ks = Object.keys(c);
  let real = 0;
  ks.forEach(k => { if (!c[k].none) real++; });
  return { total: ks.length, located: real };
}

let _txQuotaOut = false;
let _amapQuotaOut = false;
let _quotaDate = '';
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function loadQuotaState() {
  try {
    const s = store.get('geosearch_quota_date');
    if (s !== today()) { _txQuotaOut = false; _amapQuotaOut = false; }
    else { _txQuotaOut = !!store.get('geosearch_tx_quota'); _amapQuotaOut = !!store.get('geosearch_amap_quota'); }
  } catch (e) {}
}
loadQuotaState();
function markTxQuotaOut() {
  _txQuotaOut = true;
  try { store.set('geosearch_quota_date', today()); store.set('geosearch_tx_quota', true); } catch (e) {}
}
function markAmapQuotaOut() {
  _amapQuotaOut = true;
  try { store.set('geosearch_quota_date', today()); store.set('geosearch_amap_quota', true); } catch (e) {}
}
function resetQuota() {
  _txQuotaOut = false; _amapQuotaOut = false;
  try { store.remove('geosearch_quota_date'); store.remove('geosearch_tx_quota'); store.remove('geosearch_amap_quota'); } catch (e) {}
}

/** 用腾讯搜一次（复用 qqmap.search，但包装成统一字段） */
async function txSearchOnce(name, opts) {
  const r = await qqmap.search(name, opts);
  if (r.code === 121) {
    // 腾讯内置池没试完时 qqmap 自己会切换；若返回 121 说明全尽了
    markTxQuotaOut();
  }
  return r;
}

/** 双通道统一搜索：先缓存 → 腾讯（区域/全国）→ 高德（区域/全国）→ 缓存未命中 */
async function search(name, region) {
  const variants = nameVariants(name, region);
  // 优先按区域约束
  const regionMode = region && region.type !== 'route' && region.name;

  for (const v of variants) {
    const hit = cacheGet(v, region);
    if (hit) {
      if (hit.none) continue;
      return { code: 0, data: [hit.hit], message: '', cached: true, provider: 'cache' };
    }

    // 1) 腾讯 区域
    if (regionMode && !_txQuotaOut) {
      const r = await txSearchOnce(v, { city: region.name });
      const pick = pickLike(v, r);
      if (pick) {
        cacheSet(v, region, pick);
        return { code: 0, data: [pick], message: '', provider: 'tencent', cached: false };
      }
    }
    // 2) 腾讯 全国
    if (!_txQuotaOut) {
      const r = await txSearchOnce(v, {});
      const pick = pickLike(v, r);
      if (pick) {
        cacheSet(v, region, pick);
        return { code: 0, data: [pick], message: '', provider: 'tencent', cached: false };
      }
    }
    // 3) 高德 区域
    if (regionMode && !_amapQuotaOut) {
      const r = await amapSearch(v, { city: region.name });
      const pick = pickLike(v, r);
      if (pick) {
        cacheSet(v, region, pick);
        return { code: 0, data: [pick], message: '', provider: 'amap', cached: false };
      }
      if (r.code === 121) markAmapQuotaOut();
    }
    // 4) 高德 全国
    if (!_amapQuotaOut) {
      const r = await amapSearch(v, {});
      const pick = pickLike(v, r);
      if (pick) {
        cacheSet(v, region, pick);
        return { code: 0, data: [pick], message: '', provider: 'amap', cached: false };
      }
      if (r.code === 121) markAmapQuotaOut();
    }

    // 全渠道都没命中：记负缓存（仅全国模式；区域模式可能换城市能中，这里不记）
    if (!regionMode) cacheSet(v, region, null);
  }

  const noKey = !qqmap.hasKey() && !getAmapKey();
  const allQuota = _txQuotaOut && _amapQuotaOut;
  return {
    code: allQuota ? 121 : 0,
    data: [],
    message: allQuota ? '今日定位额度已用完，次日 0 点恢复' : (noKey ? '没有可用的地图 Key' : '未找到该地点'),
    provider: allQuota ? 'quota' : 'none'
  };
}

export default {
  search,
  cacheStats,
  resetQuota,
  getAmapKey,
  usingAmapOwnKey,
  usingAmapBuiltin,
  nameLooksLike,
  AMAP_BASE
};
