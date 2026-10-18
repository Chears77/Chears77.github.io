/**
 * places.js —— 「同一位置」关联层（第六十三轮新增）
 *
 * 背景（用户原话）：
 *   「同一个点位（经纬度都相同），在不同攻略中都有这个点位，如果都点击收藏点位，
 *     那他们各自攻略里边的详情和收藏里边的详情是否一致？如何处理？
 *     我的想法是，让这些同一个点位只有一个底层的详情……
 *     删除攻略里边的点位时，会自动提示，收藏的点位中没有删除；
 *     同样的，如果点位收藏里边很多文件夹都有该点位，删除的时候也会提示，
 *     是删除这个文件夹里面的，还是全部删除。
 *     我倾向于使用同一个详情界面，只是在删除和新增的时候进行相应的提示即可，
 *     他们共用同一个备注模块。」
 *
 * ★★ 本轮定下的口径（写死在这里，别再各页面自己发挥）★★
 *
 * 一、身份怎么定：
 *   同一个位置 = **经纬度四舍五入到 4 位小数**（≈ 11 米）完全一致。
 *   没有坐标的点位不参与关联（它连"在哪"都还没定，谈不上一处）。
 *   → placeKey = 'pl_<lat4>_<lng4>'
 *
 * 二、底层是不是同一个详情：
 *   是。数据上仍然是「攻略点位 / 收藏副本」两份存储（保持各自归属与可见性），
 *   但**详情内容共用一份**：在任一处改名称 / 分类 / 备注 / 图片 / 坐标，
 *   保存时会广播到所有同位置的记录 —— 用户感知就是「一个点位、一个详情」。
 *   不广播的字段（各归属自己的事）：分组 group/section、是否上图 showOnMap、
 *   排序、来源溯源 fromGuideId 等。
 *
 * 三、图标怎么广播：两套体系严格分开（历史红线，不能混）
 *   · 点位收藏图标（星/书签/爱心…）→ 只广播给**收藏副本**
 *   · 攻略图标（山岳/美食/住宿…符号）→ 只广播给**攻略点位**（点位级）
 *
 * 四、删除要先问范围：
 *   同位置还有其它记录时，弹操作表让用户选「只删除这一处 / 全部删除」，
 *   并把"还有几处"写清楚，绝不替用户做决定。
 */

import guides from './guides.js';
import favorites from './favorites.js';
/** 坐标精度：4 位小数 ≈ 11 米 */
const PREC = 10000;

/**
 * 位置身份。没有坐标 → ''（不参与关联）
 * @param {object} p 任何带 latitude / longitude 的点位
 */
function keyOf(p) {
  if (!p) return '';
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return '';
  if (!lat && !lng) return '';
  return 'pl_' + Math.round(lat * PREC) + '_' + Math.round(lng * PREC);
}

/**
 * 扫描某个位置上的所有记录
 * @param {string} k placeKey
 * @param {object} [except] 排除自身：{ gid, pid } 或 { nodeId, key }
 * @returns {{key:string, guides:Array, favs:Array, total:number}}
 *          guides: [{ guideId, guideName, pointId, point }]
 *          favs:   [{ nodeId, nodeName, key, point }]
 */
function scan(k, except) {
  const out = { key: k || '', guides: [], favs: [], total: 0 };
  if (!out.key) return out;
  const ex = except || {};

  for (const g of guides.getList()) {
    for (const p of (g.points || [])) {
      if (!p || keyOf(p) !== out.key) continue;
      if (ex.gid && ex.gid === g.id && ex.pid && ex.pid === p.id) continue;
      out.guides.push({
        guideId: g.id,
        guideName: g.name || '',
        pointId: p.id,
        point: p
      });
    }
  }

  for (const n of favorites.getTree()) {
    for (const pt of (n.points || [])) {
      if (!pt || keyOf(pt) !== out.key) continue;
      const pk = favorites.keyOf(pt);
      if (ex.nodeId && ex.nodeId === n.id && ex.key && ex.key === pk) continue;
      out.favs.push({ nodeId: n.id, nodeName: n.name || '', key: pk, point: pt });
    }
  }

  out.total = out.guides.length + out.favs.length;
  return out;
}

/**
 * 把一份"详情补丁"广播到这个位置上的所有记录
 *
 * @param {string} k      placeKey
 * @param {object} patch  共享字段（name / category / note / reason / imageUrls /
 *                        latitude / longitude / poiName / key …）
 * @param {'all'|'guide'|'fav'} [scope] 作用范围，默认 all
 * @returns {{guides:number, favs:number}} 实际改了几条
 */
function patchAll(k, patch, scope) {
  const r = { guides: 0, favs: 0 };
  if (!k || !patch || !Object.keys(patch).length) return r;
  const sc = scope || 'all';
  const s = scan(k);
  if (sc !== 'fav') {
    for (const it of s.guides) {
      guides.updatePoint(it.guideId, it.pointId, patch);
      r.guides += 1;
    }
  }
  if (sc !== 'guide') {
    for (const it of s.favs) {
      favorites.updateItem(it.key, patch);
      r.favs += 1;
    }
  }
  return r;
}

/**
 * 只改这个位置上「收藏副本」的图标（收藏形状体系）
 * @returns {number} 改了几条
 */
function patchFavIcon(k, shape, colorIdx) {
  if (!k) return 0;
  return patchAll(k, { favShape: shape, favColorIdx: colorIdx }, 'fav').favs;
}

/**
 * 只改这个位置上「攻略点位」的图标（攻略符号体系，点位级）
 * @returns {number} 改了几条
 */
function patchGuideIcon(k, sym, colorIdx) {
  if (!k) return 0;
  return patchAll(k, { favShape: sym, favColorIdx: colorIdx }, 'guide').guides;
}

/** 把这个位置上的记录全部删除（攻略点位 + 收藏副本） */
function removeAll(k) {
  const r = { guides: 0, favs: 0 };
  if (!k) return r;
  const s = scan(k);
  for (const it of s.guides) {
    guides.removePoint(it.guideId, it.pointId);
    r.guides += 1;
  }
  for (const it of s.favs) {
    favorites.removePoint(it.nodeId, it.key);
    r.favs += 1;
  }
  return r;
}

/**
 * 「还有几处」的自然语言片段，供弹窗文案用
 * @param {{guides:Array, favs:Array}} s scan 结果
 * @returns {string} 如「2 篇攻略 / 3 个收藏夹」；没有则 ''
 */
function describe(s) {
  if (!s) return '';
  const parts = [];
  if (s.guides && s.guides.length) parts.push(s.guides.length + ' 篇攻略');
  if (s.favs && s.favs.length) parts.push(s.favs.length + ' 个收藏夹');
  return parts.join(' / ');
}

export default {
  PREC,
  keyOf, scan, patchAll, patchFavIcon, patchGuideIcon, removeAll, describe
};
