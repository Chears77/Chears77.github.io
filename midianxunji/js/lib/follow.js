import store from '../store.js';
import guidesLib from './guides.js';
/**
 * follow.js —— 「关注」收纳夹（第十二轮新增）
 *
 * 设计原则（用户明确要求）：**关注页不复制攻略**。
 *   收纳夹里存的是攻略 id（引用），底层数据始终是 utils/guides.js 里那一份，
 *   所以在关注页改名称、改点位，最近列表同步生效；删攻略两边一起消失。
 *
 * 存储：follow_store = { version: 1, folders: [ { id, name, guideIds: [] } ] }
 *   · 只有一层文件夹；文件夹本身可拖拽排序；
 *   · 热门攻略「关注」时先落库成自己的攻略（fromHot 标记），再进收纳夹——
 *     热网上的原文不可改，落库后的这份才是自己的数据，与最近列表共用。
 */

const KEY = 'follow_store';

function read() {
  let s = null;
  try { s = store.get(KEY); } catch (e) { /* ignore */ }
  if (!s || !Array.isArray(s.folders)) s = { version: 1, folders: [] };
  return s;
}

function write(s) {
  try { store.set(KEY, s); } catch (e) { /* ignore */ }
}

function fid() {
  return 'ff_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** 全部收纳夹（原序） */
function getFolders() {
  return read().folders;
}

/** 某篇攻略在哪些收纳夹里（返回收纳夹对象数组） */
function folderObjsOfGuide(guideId) {
  const out = [];
  for (const f of read().folders) {
    if ((f.guideIds || []).indexOf(guideId) >= 0) out.push(f);
  }
  return out;
}

/** 某篇攻略在哪些收纳夹里（返回收纳夹 id 数组，兼容旧调用） */
function foldersOfGuide(guideId) {
  return folderObjsOfGuide(guideId).map(f => f.id);
}

function isFollowed(guideId) {
  return foldersOfGuide(guideId).length > 0;
}

/** 新建收纳夹 */
function createFolder(name) {
  const s = read();
  const f = { id: fid(), name: String(name || '').trim().slice(0, 12) || '新收纳夹', guideIds: [] };
  s.folders.push(f);
  write(s);
  return f;
}

function renameFolder(id, name) {
  const s = read();
  const f = s.folders.find(x => x.id === id);
  if (f) f.name = String(name || '').trim().slice(0, 12) || f.name;
  write(s);
  return !!f;
}

function deleteFolder(id) {
  const s = read();
  s.folders = s.folders.filter(x => x.id !== id);
  write(s);
}

/** 把攻略放进收纳夹（幂等） */
function addGuide(folderId, guideId) {
  const s = read();
  const f = s.folders.find(x => x.id === folderId);
  if (!f) return false;
  f.guideIds = f.guideIds || [];
  if (f.guideIds.indexOf(guideId) < 0) f.guideIds.push(guideId);
  write(s);
  return true;
}

/** 从收纳夹移出（不动攻略本身） */
function removeGuide(folderId, guideId) {
  const s = read();
  const f = s.folders.find(x => x.id === folderId);
  if (!f) return false;
  f.guideIds = (f.guideIds || []).filter(g => g !== guideId);
  write(s);
  return true;
}

/** 取消关注：从所有收纳夹移出 */
function unfollow(guideId) {
  const s = read();
  for (const f of s.folders) {
    f.guideIds = (f.guideIds || []).filter(g => g !== guideId);
  }
  write(s);
}

/** 收纳夹排序（拖拽提交） */
function reorderFolders(ids) {
  const s = read();
  const map = {};
  for (const f of s.folders) map[f.id] = f;
  const next = ids.filter(id => map[id]).map(id => map[id]);
  for (const f of s.folders) if (ids.indexOf(f.id) < 0) next.push(f);
  s.folders = next;
  write(s);
}

/** 收纳夹内攻略排序 */
function reorderGuides(folderId, guideIds) {
  const s = read();
  const f = s.folders.find(x => x.id === folderId);
  if (!f) return;
  const cur = f.guideIds || [];
  const next = guideIds.filter(g => cur.indexOf(g) >= 0);
  for (const g of cur) if (next.indexOf(g) < 0) next.push(g);
  f.guideIds = next;
  write(s);
}

/**
 * 攻略跨收纳夹搬家（第二十八轮新增，与点位收藏的 favorites.transferPoint 同语义）。
 *   mode = 'move'：从源夹移除，再加进目标夹（原夹不留）
 *   mode = 'copy'：两个夹各留一份（源夹不动）
 * 目标夹已有该攻略时**不重复添加**（guideIds 天然去重）。
 * 返回 true / false 供调用方提示。
 */
function transferGuide(guideId, fromFolderId, toFolderId, mode) {
  if (!guideId || !toFolderId || fromFolderId === toFolderId) return false;
  const s = read();
  const to = s.folders.find(x => x.id === toFolderId);
  if (!to) return false;
  to.guideIds = to.guideIds || [];
  if (to.guideIds.indexOf(guideId) < 0) to.guideIds.push(guideId);
  if (mode === 'move') {
    const from = s.folders.find(x => x.id === fromFolderId);
    if (from) from.guideIds = (from.guideIds || []).filter(g => g !== guideId);
  }
  write(s);
  return true;
}

/** 收纳夹列表（带上攻略摘要；已删除的攻略自动剔除，不产生孤儿） */
function getView() {
  const all = guidesLib.getList();
  const byId = {};
  for (const g of all) byId[g.id] = g;
  return read().folders.map(f => ({
    id: f.id,
    name: f.name,
    guides: (f.guideIds || [])
      .filter(id => byId[id])
      .map(id => {
        const g = byId[id];
        return {
          id: g.id,
          name: g.name || '未命名攻略',
          count: (g.points || []).length,
          located: (g.points || []).filter(p => p.latitude && p.longitude).length,
          timeText: '',
          fromHot: !!g.fromHot
        };
      })
  }));
}

/** 收藏攻略总数（去重；已删除的攻略不计入） */
function countGuides() {
  const alive = {};
  for (const g of guidesLib.getList()) alive[g.id] = 1;
  const seen = {};
  let n = 0;
  for (const f of read().folders) {
    for (const id of (f.guideIds || [])) {
      if (alive[id] && !seen[id]) { seen[id] = 1; n += 1; }
    }
  }
  return n;
}

function clearAll() {
  try { store.remove(KEY); } catch (e) { /* ignore */ }
}

export default {
  getFolders, foldersOfGuide, folderObjsOfGuide, isFollowed, countGuides,
  createFolder, renameFolder, deleteFolder,
  addGuide, removeGuide, unfollow,
  reorderFolders, reorderGuides, transferGuide, getView, clearAll
};
