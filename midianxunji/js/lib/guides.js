/**
 * guides.js —— 「攻略库」统一数据层（2026-09-26 第十一轮重构）
 *
 * ★ 第五十三轮：全部数据只存本机 storage「my_guides」，不再有云端同步。
 *   （原 saveNew / syncCloud / api.mapDelete 已整体删除，调用点同步清理。）
 *
 * 为什么要这一层：
 *  之前一份解析结果同时活在 current_map（当前这份）、local_maps（最近浏览）、
 *  云端 mapStore 三处，用户在地图上改点位时根本不知道改的是哪一份，
 *  也做不到「改完存回这篇攻略」。本次把攻略提升为**可编辑的独立实体**：
 *
 *   guide = {
 *     id,            // 本机 id（唯一）
 *     _id,           // 【已废弃】老版本同步云端时留下的云端 id，只做兼容读取，不再写入
 *     name,          // 攻略标题
 *     sourceUrl, sourceTitle, rawText, city,
 *     points: [ guidePoint ],   // 点位数组，可增删改，改动只落在这篇攻略里
 *     createTime, updateTime,
 *     showOnMap,     // 图层可见性：地图「攻略层」是否显示它
 *     deviceId
 *   }
 *   guidePoint = { id('gp_...'), name, category, latitude, longitude, reason, quote, ... }
 *
 * 产权边界（务必牢记）：
 *   · 攻略点位属于攻略，编辑 = 改这篇攻略，不影响任何收藏夹；
 *   · 收藏点位是「标星」时从攻略点位**复制**出去的副本，独立存在；
 *   · 副本不跟随攻略自动更新，需要时在收藏详情页点「同步最新」手动拉平。
 *
 * 存储：只存本机 storage「my_guides」（第五十三轮起不再上云）。
 */

import device from './device.js';
import store from '../store.js';
const KEY = 'my_guides';
const KEY_CURRENT = 'current_guide_id';
const MAX = 50; // 最多保留 50 篇，避免撑爆 storage

/* ================= 基础工具 ================= */

function gid() {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pid() {
  return 'gp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function read() {
  let list = [];
  try { list = store.get(KEY); } catch (e) { /* ignore */ }
  return Array.isArray(list) ? list : [];
}

function nextUpdateTime(list) {
  let newest = 0;
  for (const g of (list || [])) newest = Math.max(newest, Number(g && g.updateTime) || 0);
  // 「最近」列表要求每次打开都严格置顶；同一毫秒内连续操作也不能并列，
  // 否则稳定排序会退回 storage 原顺序，刚点开的攻略就可能落到第二名。
  return Math.max(Date.now(), newest + 1);
}

function write(list) {
  const next = (list || []).slice(0, MAX);
  try { store.set(KEY, next); } catch (e) {
    // 容量溢出：丢掉最旧的一半再存一次
    try { store.set(KEY, next.slice(0, Math.floor(MAX / 2))); } catch (e2) { /* ignore */ }
  }
  touchToken();
  return next;
}

/** 攻略数据变了：通知地图页刷新（地图页按 token 变化重建 marker） */
function touchToken() {
  try { store.set('guide_refresh_token', { token: Date.now() }); } catch (e) { /* ignore */ }
}

/* ================= 点位归一化 ================= */

function normalizePoint(p) {
  const o = Object.assign({}, p || {});
  if (!o.id) o.id = pid();
  if (!o.name) o.name = '';
  if (!o.category) o.category = 'qita';
  if (!o.group) o.group = '';
  if (o.primary === undefined) o.primary = true;
  if (o.showOnMap === undefined) o.showOnMap = true;
  if (!o.createTime) o.createTime = Date.now();
  return o;
}

/* ================= 攻略读写 ================= */

/** 全部攻略（置顶在前，其余按更新时间倒序） */
function getList() {
  return read().slice().sort((a, b) => {
    const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0);
  });
}

/** 第七十四轮：把这篇攻略「置顶」——只刷新 updateTime（列表按它倒序），不动 pinned 字段 */
function touch(id) {
  return update(id, {});
}

/** 置顶 / 取消置顶 */
function setPinned(id, on) {
  return update(id, { pinned: !!on });
}

function getById(id) {
  if (!id) return null;
  return read().find(g => g.id === id || (g._id && g._id === id)) || null;
}

/** 当前正在看的那篇（没有则返回最新一篇） */
function current() {
  let id = '';
  try { id = store.get(KEY_CURRENT) || ''; } catch (e) { /* ignore */ }
  const hit = id ? getById(id) : null;
  if (hit) return hit;
  const list = getList();
  return list.length ? list[0] : null;
}

function setCurrent(id, refreshRecent) {
  try { store.set(KEY_CURRENT, id || ''); } catch (e) { /* ignore */ }
  // 第七十八轮：「设为当前」就是用户刚打开这篇，必须同步刷新「最近」顺序。
  // create/remove 已经自己维护好顺序，传 false 可避免无意义的二次读写。
  if (id && refreshRecent !== false) return touch(id);
  return id ? getById(id) : null;
}

/** 新增攻略（解析完成后调用）；返回新建的 guide */
function create(raw) {
  const list = read();
  const now = Date.now();
  const guide = {
    id: gid(),
    _id: (raw && raw._id) || '',
    name: (raw && raw.name) || '未命名攻略',
    sourceUrl: (raw && raw.sourceUrl) || '',
    sourceTitle: (raw && raw.sourceTitle) || '',
    rawText: (raw && raw.rawText) || '',
    city: (raw && raw.city) || '',
    routeCenter: (raw && raw.routeCenter) || null,
    points: ((raw && raw.points) || []).map(normalizePoint),
    folders: [],            // 第六十六轮：攻略内分组（与收藏夹一级模型一致）
    createTime: (raw && raw.createTime) || now,
    updateTime: nextUpdateTime(list),
    showOnMap: true,
    deviceId: (raw && raw.deviceId) || device.getDeviceId()
  };
  list.unshift(guide);
  write(list);
  setCurrent(guide.id, false);
  return guide;
}

/**
 * 更新攻略字段（标题 / 原文 / 可见性等）
 * @returns {object|null} 更新后的 guide
 */
function update(id, patch) {
  const list = read();
  const i = list.findIndex(g => g.id === id || (g._id && g._id === id));
  if (i < 0) return null;
  const g = list[i];
  list[i] = Object.assign({}, g, patch || {}, { id: g.id, updateTime: nextUpdateTime(list) });
  write(list);
  return list[i];
}

/** 图层可见性：眼睛只是显示状态，不得污染「最近打开」顺序。 */
function setVisible(id, show) {
  const list = read();
  const i = list.findIndex(g => g.id === id || (g._id && g._id === id));
  if (i < 0) return null;
  const on = !!show;
  if ((list[i].showOnMap !== false) === on) return list[i];
  list[i] = Object.assign({}, list[i], { showOnMap: on });
  write(list);
  return list[i];
}

/**
 * 第三十轮：「只显示这一篇」——把 id 这篇开眼，其余全部闭眼。
 *
 * 用户明确要求：「单独点某个攻略的时候，只会显示是这个攻略的点位。隐藏所有其他攻略，
 * 其他所有的攻略眼睛都闭上…… 只有当手动点其他攻略的小眼睛的时候，才会显示其他的攻略点位。」
 *
 * 批量一次性写入，避免 N 次 read/write。
 */
function setSoloVisible(id) {
  const list = read();
  const changed = [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const on = (g.id === id);
    if ((g.showOnMap !== false) !== on) {
      // 眼睛开关只改图层显示，不改 updateTime；否则被动闭眼的攻略会反超刚打开的攻略。
      list[i] = Object.assign({}, g, { showOnMap: on });
      changed.push(list[i]);
    }
  }
  if (changed.length) write(list);
  return list;
}

/** 全部恢复可见（退出「只看这篇」时对称还原，把被批量闭眼的攻略都开回来） */
function setAllVisible() {
  const list = read();
  const changed = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].showOnMap === false) {
      list[i] = Object.assign({}, list[i], { showOnMap: true });
      changed.push(list[i]);
    }
  }
  if (changed.length) {
    write(list);
  }
  return list;
}

function remove(id) {
  const list = read().filter(g => g.id !== id && g._id !== id);
  write(list);
  const cur = (() => { try { return store.get(KEY_CURRENT) || ''; } catch (e) { return ''; } })();
  if (cur === id) setCurrent(list.length ? list[0].id : '', false);
  const g = getById(id);
  return list;
}

function clearAll() {
  const list = read();
  try { store.remove(KEY); } catch (e) { /* ignore */ }
  try { store.remove(KEY_CURRENT); } catch (e) { /* ignore */ }
  touchToken();
}

/** 参与地图「攻略层」显示的攻略 */
function visibleList() {
  return getList().filter(g => g.showOnMap !== false);
}

/* ================= 点位操作（只改这篇攻略，不动收藏） ================= */

function _indexOf(list, id) {
  return list.findIndex(g => g.id === id || (g._id && g._id === id));
}

function getPoints(id) {
  const g = getById(id);
  return g ? (g.points || []).slice() : [];
}

/** 整体覆盖点位（复核页批量纠偏用） */
function setPoints(id, points) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  list[i] = Object.assign({}, list[i], {
    points: (points || []).map(normalizePoint),
    updateTime: Date.now()
  });
  write(list);
  return true;
}

/** 改单个点位字段 */
function updatePoint(guideId, pointId, patch) {
  const list = read();
  const i = _indexOf(list, guideId);
  if (i < 0) return false;
  const pts = (list[i].points || []).map(p => (
    p.id === pointId ? Object.assign({}, p, patch || {}) : p
  ));
  list[i] = Object.assign({}, list[i], { points: pts, updateTime: Date.now() });
  write(list);
  return true;
}

/** 往攻略里补一个点位（位置没识别到时手工补） */
function addPoint(guideId, point) {
  const list = read();
  const i = _indexOf(list, guideId);
  if (i < 0) return null;
  const p = normalizePoint(point);
  list[i] = Object.assign({}, list[i], {
    points: (list[i].points || []).concat([p]),
    updateTime: Date.now()
  });
  write(list);
  return p;
}

function removePoint(guideId, pointId) {
  const list = read();
  const i = _indexOf(list, guideId);
  if (i < 0) return false;
  const pts = (list[i].points || []).filter(p => p.id !== pointId);
  list[i] = Object.assign({}, list[i], { points: pts, updateTime: Date.now() });
  write(list);
  return true;
}

/* ================= 文件夹（攻略内的分组，与收藏夹一级模型一致） =================
 * 第六十六轮：地图编辑页（复核页）改造为「点位收藏」同款文件夹模型。
 *   guide.folders = [{ id, name, order, showOnMap }]（一级，不嵌套）
 *   guidePoint 新增 folderId；group 始终同步等于所属文件夹名（下游地图/分享/导出只认 group）。
 *   section 字段下游不读，编辑页不再管理，保留存储无害。
 */

function genFolderId() {
  return 'gf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function getFolders(id) {
  const g = getById(id);
  return g && Array.isArray(g.folders) ? g.folders.slice() : [];
}

/** 把整篇攻略的「文件夹表 + 点位数组」一起落盘（folderId/group/showOnMap 同步） */
function saveLayout(id, folders, points) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  list[i] = Object.assign({}, list[i], {
    folders: (folders || []).map(f => Object.assign({}, f)),
    points: (points || []).map(normalizePoint),
    updateTime: Date.now()
  });
  write(list);
  return true;
}

function createFolder(id, name) {
  const g = getById(id);
  if (!g) return null;
  const folders = g.folders || [];
  const node = { id: genFolderId(), name: String(name || '').trim().slice(0, 12) || '新文件夹', order: folders.length, showOnMap: true };
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return null;
  list[i] = Object.assign({}, list[i], { folders: folders.concat([node]), updateTime: Date.now() });
  write(list);
  return node;
}

function renameFolder(id, folderId, name) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const folders = (g.folders || []).map(f => {
    if (f.id !== folderId) return f;
    return Object.assign({}, f, { name: String(name || '').trim().slice(0, 12) || f.name });
  });
  const newName = (folders.find(f => f.id === folderId) || {}).name || '';
  const points = (g.points || []).map(p => (p.folderId === folderId) ? Object.assign({}, p, { group: newName }) : p);
  list[i] = Object.assign({}, g, { folders, points, updateTime: Date.now() });
  write(list);
  return true;
}

/** 删除文件夹：里面点位回到「未分组」（folderId 清空），不丢点位 */
function deleteFolder(id, folderId) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const folders = (g.folders || []).filter(f => f.id !== folderId);
  const points = (g.points || []).map(p => (p.folderId === folderId) ? Object.assign({}, p, { folderId: '', group: '' }) : p);
  list[i] = Object.assign({}, g, { folders, points, updateTime: Date.now() });
  write(list);
  return true;
}

/** 文件夹眼睛：联动夹内所有点位（与收藏夹 setFolderVisible 同语义） */
function setFolderVisible(id, folderId, show) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const folders = (g.folders || []).map(f => (f.id === folderId) ? Object.assign({}, f, { showOnMap: !!show }) : f);
  const points = (g.points || []).map(p => (p.folderId === folderId) ? Object.assign({}, p, { showOnMap: !!show }) : p);
  list[i] = Object.assign({}, g, { folders, points, updateTime: Date.now() });
  write(list);
  return true;
}

function reorderFolders(id, ids) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  // ★ 第六十八轮：ids 允许带上视图层的「未分组」('__ungrouped__') ——
  // 真实文件夹的 order 直接取它在整条视图序列里的下标（唯一，不再连续编号），
  // 未分组的下标落进 g.ungroupedOrder。这样「未分组」才能真正插到任意两个文件夹之间，
  // 以前 order 连续编号 + 未分组单独存 999，落点夹在中间时会被稳定排序顶回去。
  const UN = '__ungrouped__';
  const full = Array.isArray(ids) ? ids.filter(x => x) : [];
  const real = full.filter(x => x !== UN);
  const map = {}; (g.folders || []).forEach(f => { map[f.id] = f; });
  const next = real.filter(fid => map[fid]).map(fid => map[fid]);
  (g.folders || []).forEach(f => { if (real.indexOf(f.id) < 0) next.push(f); });
  next.forEach((f) => {
    const at = full.indexOf(f.id);
    f.order = (at >= 0) ? at : (f.order || 0);
  });
  const patch = { folders: next, updateTime: Date.now() };
  const uAt = full.indexOf(UN);
  if (uAt >= 0) patch.ungroupedOrder = uAt;
  list[i] = Object.assign({}, g, patch);
  write(list);
  return true;
}

/** 第六十七轮：未分组是视图层合成文件夹，不在 folderMeta 里，单独存它的排序位置 */
function setUngroupedOrder(id, order) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  list[i] = Object.assign({}, g, { ungroupedOrder: order, updateTime: Date.now() });
  write(list);
  return true;
}

/** folder 内点位排序：pointIds = 该 folder 内的点位 id 数组（期望顺序） */
function reorderPoints(id, folderId, pointIds) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const pts = g.points || [];
  const inFolder = pts.filter(p => (p.folderId || '') === folderId);
  const others = pts.filter(p => (p.folderId || '') !== folderId);
  const map = {}; inFolder.forEach(p => { map[p.id] = p; });
  const ordered = pointIds.filter(pid => map[pid]).map(pid => map[pid]);
  inFolder.forEach(p => { if (pointIds.indexOf(p.id) < 0) ordered.push(p); });
  list[i] = Object.assign({}, g, { points: others.concat(ordered), updateTime: Date.now() });
  write(list);
  return true;
}

/** 把某点位移动到另一文件夹（toIndex = 落在目标 folder 内的第几位） */
function movePointToFolder(id, pointId, toFolderId, toIndex) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const folderName = ((g.folders || []).find(f => f.id === toFolderId) || {}).name || '';
  const pts = g.points || [];
  const idx = pts.findIndex(p => p.id === pointId);
  if (idx < 0) return false;
  const moved = Object.assign({}, pts[idx], { folderId: toFolderId, group: folderName });
  const rest = pts.filter(p => p.id !== pointId);
  const tgtPts = rest.filter(p => (p.folderId || '') === toFolderId);
  const restOthers = rest.filter(p => (p.folderId || '') !== toFolderId);
  let ins = (typeof toIndex === 'number') ? toIndex : tgtPts.length;
  if (ins < 0 || ins > tgtPts.length) ins = tgtPts.length;
  tgtPts.splice(ins, 0, moved);
  list[i] = Object.assign({}, g, { points: restOthers.concat(tgtPts), updateTime: Date.now() });
  write(list);
  return true;
}

/** 单点眼睛（在攻略 folder 内切换是否在图上显示），并推导父夹眼睛（任一睁则夹睁） */
function setPointVisibleInFolder(id, pointId, show) {
  const list = read();
  const i = _indexOf(list, id);
  if (i < 0) return false;
  const g = list[i];
  const points = (g.points || []).map(p => (p.id === pointId) ? Object.assign({}, p, { showOnMap: !!show }) : p);
  const folderId = ((g.points || []).find(p => p.id === pointId) || {}).folderId || '';
  let folders = g.folders || [];
  if (folderId) {
    const fpts = points.filter(p => (p.folderId || '') === folderId);
    const anyOn = fpts.some(p => p.showOnMap !== false);
    folders = folders.map(f => (f.id === folderId && (f.showOnMap !== false) !== anyOn) ? Object.assign({}, f, { showOnMap: anyOn }) : f);
  }
  list[i] = Object.assign({}, g, { folders, points, updateTime: Date.now() });
  write(list);
  return true;
}

/**
 * 把点位的 group 归并成文件夹并补齐 folderId（★ 第六十八轮：改为**自愈式对账**）。
 *
 * 老版只在「folders 为空」时跑一次；一旦 folders 已存在（比如历史 bug 写进了
 * 几个空的「第一天/第二天」夹）就直接返回，点位永远躺在未分组里 —— 这就是
 * 用户看到的「三个空文件夹 + 点位全在未分组」。
 *
 * 现在每次都做一次对账（幂等）：
 *   · 点位有 group → 找同名文件夹，没有就按 group 首次出现顺序补建（标记 auto）；
 *   · 点位无 group → folderId 清空（落进视图层的「未分组」，不再落库成真夹）；
 *   · group 与所属夹名对不上的（历史残留）→ 重新按 group 归位。
 * 不变量：group 恒等于所属文件夹名（renameFolder / movePointToFolder 都在维护它），
 * 所以按 group 对账不会破坏用户手动整理过的结构。
 */
function ensureFolders(id) {
  const g = getById(id);
  if (!g) return;
  const pts = (g.points || []).slice();
  let folders = (g.folders || []).slice();
  const byName = {};
  folders.forEach(f => { if (!byName[f.name]) byName[f.name] = f; });
  let changed = false;

  const nextPts = pts.map((p) => {
    const nm = String(p.group || '').trim();
    if (!nm) {
      // 无分组 → 未分组（合成夹），folderId 必须为空
      if (p.folderId) { changed = true; return Object.assign({}, p, { folderId: '' }); }
      return p;
    }
    const cur = folders.find(f => f.id === p.folderId);
    if (cur && cur.name === nm) return p;          // 已对上，不动
    let f = byName[nm];
    if (!f) {
      f = { id: genFolderId(), name: nm.slice(0, 12), order: folders.length, showOnMap: true, auto: true };
      folders = folders.concat([f]);
      byName[nm] = f;
    }
    changed = true;
    return Object.assign({}, p, { folderId: f.id });
  });

  // 有变化才落盘（这个函数在每次进编辑页时都会被调用）
  if (!changed) return;
  const list = read();
  const i = _indexOf(list, id);
  if (i >= 0) {
    list[i] = Object.assign({}, list[i], { folders, points: nextPts, updateTime: Date.now() });
    write(list);
  }
}

/* ================= 旧数据迁移 ================= */

/**
 * 把老版本的 current_map / local_maps 迁进攻略库，只跑一次。
 * 迁移后这两份旧数据保留（不删），避免用户回退版本时数据丢失。
 */
function migrateLegacy() {
  let done = false;
  try { done = !!store.get('guides_migrated'); } catch (e) { /* ignore */ }
  if (done) return 0;

  const list = read();
  let added = 0;

  const push = (m, fromCurrent) => {
    if (!m || !m.points || !m.points.length) return;
    const name = m.name || '未命名攻略';
    const dup = list.find(g => g.name === name && (g.points || []).length === m.points.length);
    if (dup) return;
    list.push({
      id: gid(),
      _id: m._id || '',
      name,
      sourceUrl: m.sourceUrl || '',
      sourceTitle: m.sourceTitle || '',
      rawText: m.rawText || '',
      city: m.city || '',
      points: (m.points || []).map(normalizePoint),
      createTime: m.createTime || Date.now(),
      updateTime: m.updateTime || m.createTime || Date.now(),
      showOnMap: fromCurrent ? true : false, // 只把「当前这份」默认显示在图层上，历史攻略不刷屏
      deviceId: m.deviceId || device.getDeviceId()
    });
    added += 1;
  };

  try {
    const cur = store.get('current_map');
    push(cur, true);
    const maps = store.get('local_maps');
    if (Array.isArray(maps)) for (const m of maps) push(m, false);
  } catch (e) { /* ignore */ }

  if (added) write(list);
  try { store.set('guides_migrated', 1); } catch (e) { /* ignore */ }
  return added;
}

export default {
  KEY, KEY_CURRENT,
  getList, getById, current, setCurrent,
  create, update, remove, clearAll,
  setVisible, setSoloVisible, setAllVisible, visibleList, setPinned, touch,
  getPoints, setPoints, updatePoint, addPoint, removePoint,
  normalizePoint, migrateLegacy,
  getFolders, saveLayout, createFolder, renameFolder, deleteFolder,
  setFolderVisible, reorderFolders, reorderPoints, movePointToFolder,
  setPointVisibleInFolder, ensureFolders, setUngroupedOrder
};
