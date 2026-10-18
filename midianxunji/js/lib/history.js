import store from '../store.js';
/**
 * history.js —— 本机「最近浏览」存档
 *
 * 为什么需要它：
 *  云端列表依赖云函数 mapStore + 云数据库，但
 *   ① 用户还没上传云函数；② 云端保存失败时攻略退化成本地地图（_id 为空）
 *  这两种情况下云端列表都查不到，最近页就会空白。
 *  所以最近页改为「本机存档优先渲染 + 云端列表补充合并」。
 *
 * storage key：local_maps（数组，最新在前）
 */
const KEY = 'local_maps';
const MAX = 30; // 最多保留 30 份，避免超出小程序 storage 容量

function getList() {
  try {
    const l = store.get(KEY);
    return Array.isArray(l) ? l : [];
  } catch (e) {
    return [];
  }
}

function saveList(list) {
  try {
    store.set(KEY, list.slice(0, MAX));
  } catch (e) {
    // 容量溢出时裁掉一半再存一次
    try {
      store.set(KEY, list.slice(0, Math.floor(MAX / 2)));
    } catch (e2) { /* ignore */ }
  }
}

/** 本机记录唯一 id（云端 _id 可能为空） */
function localId() {
  return 'loc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 新增或更新一份攻略
 * @param {object} map 含 name/points/createTime 等；有 _id 则按 _id 去重
 */
function upsert(map) {
  if (!map) return getList();
  const list = getList();
  const rec = Object.assign({}, map);
  if (!rec._localId) rec._localId = localId();
  if (!rec.createTime) rec.createTime = Date.now();

  let idx = -1;
  if (rec._id) {
    idx = list.findIndex(m => m._id && m._id === rec._id);
  } else {
    idx = list.findIndex(m => m._localId && m._localId === rec._localId);
  }

  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], rec);
  } else {
    list.unshift(rec);
  }
  saveList(list);
  return list;
}

/** 删除（_id 或 _localId 命中即可） */
function remove(id) {
  if (!id) return getList();
  const list = getList().filter(m => m._id !== id && m._localId !== id);
  saveList(list);
  return list;
}

/** 清空 */
function clear() {
  try { store.remove(KEY); } catch (e) { /* ignore */ }
}

export default { getList, upsert, remove, clear, localId };
