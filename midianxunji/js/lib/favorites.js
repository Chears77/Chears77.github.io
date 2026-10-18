import store from '../store.js';
/**
 * favorites.js —— 「我的收藏夹」统一数据层（一级文件夹 + 点位）
 *
 * 2026-09-26 第十一轮重构：
 *  ① 层级从最多 3 层简化为 **1 层**：收藏夹（文件夹） → 点位，不再有子文件夹；
 *  ② 文件夹与点位都带 **showOnMap 可见性**（地图「收藏层」的眼睛开关）；
 *  ③ 收藏点位是攻略点位「标星」时复制出来的副本，独立可编辑，不随攻略自动变。
 *
 * 产权边界（务必牢记）：
 *   · 攻略点位活在 utils/guides.js，改它只影响那篇攻略；
 *   · 收藏点位活在这里，改它只影响收藏夹；
 *   · 两者靠 fromGuideId / fromPointId 溯源，需要时可手动「同步最新」。
 *
 * 树形结构（v3，只有一级）：
 *   storage: my_favorites = { version: 3, tree: [ Node ] }
 *   Node = {
 *     id, name, level:1, parentId:null, isDefault, showOnMap,
 *     points: [ Item ],        // 点位副本
 *     children: [],            // 恒为空，保留字段只为兼容旧读写
 *     guide: { status:'none'|'done', text, updateTime }   // 本夹生成的攻略
 *   }
 *
 * 旧数据会自动迁移：v1 扁平 folders -> v2 树 -> v3 一级（子孙文件夹提升为顶层，点位不丢）。
 */

const STORAGE_FAV = 'my_favorites';
const MAX_LEVEL = 1;   // 第十一轮：收藏夹只保留一级

/* 第二十七轮（用户明确）：默认收藏夹叫「我的点位」；老名字自动迁移 */
const DEFAULT_FOLDER_NAME = '我的点位';
const LEGACY_FOLDER_NAMES = ['默认收藏夹', '默认夹'];

/* ================= 基础存取 ================= */

function genId() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** 点位稳定 id：改名/改坐标都不会变，是点位的真正身份证 */
function genPointId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* 旧数据补 id 只在本次会话做一次，避免每次 getFav() 都全树遍历 */
let _idMigrated = false;
/* 第二十七轮：默认夹改名迁移也只在本次会话做一次 */
let _nameMigrated = false;

/** 读取（自动迁移旧结构 + 旧点位补 id + 默认夹改名） */
function getFav() {
  let fav = null;
  try { fav = store.get(STORAGE_FAV); } catch (e) { /* ignore */ }
  if (!fav) fav = { version: 3, tree: [] };
  if (fav.version === 3 && Array.isArray(fav.tree)) {
    ensureItemIds(fav);
    migrateDefaultName(fav);
    return fav;
  }
  // v2 树 → v3 一级：子孙文件夹提升为顶层，点位原样带上
  const migrated = fav.version === 2 && Array.isArray(fav.tree)
    ? flatten(fav)
    : migrate(fav);
  setFav(migrated);
  return migrated;
}

/**
 * 第二十七轮（用户明确）：默认收藏夹的名字统一为「我的点位」。
 * 老数据里叫「默认收藏夹」的那个夹子自动改名（只改 isDefault 的那个，
 * 用户自己建的、恰巧同名的夹子不动），迁移一次即可。
 */
function migrateDefaultName(fav) {
  if (_nameMigrated) return;
  _nameMigrated = true;
  const tree = (fav && fav.tree) || [];
  const def = tree.find(n => n && n.isDefault);
  if (def && LEGACY_FOLDER_NAMES.indexOf(def.name) >= 0) {
    def.name = DEFAULT_FOLDER_NAME;
    setFav(fav);
  }
}

/**
 * v2 多层树 → v3 一级
 * 规则：每个节点（含子孙）都提升为顶层文件夹，点位跟着走，一个不丢；
 *      重名的文件夹自动加序号后缀，避免合并时互相覆盖。
 */
function flatten(fav) {
  const out = [];
  const used = {};
  const uniq = (name) => {
    const base = String(name || '收藏夹').trim().slice(0, 12) || '收藏夹';
    if (!used[base]) { used[base] = 1; return base; }
    used[base] += 1;
    return base.slice(0, 10) + ' ' + used[base];
  };
  const walk = (list) => {
    for (const n of list || []) {
      out.push({
        id: n.id || genId(),
        name: uniq(n.name),
        level: 1,
        parentId: null,
        isDefault: !!n.isDefault,
        showOnMap: n.showOnMap !== false,
        points: (n.points || []).map(normalizeItem),
        children: [],
        guide: n.guide || { status: 'none', text: '', updateTime: 0 }
      });
      walk(n.children || []);
    }
  };
  walk(fav.tree || []);
  return { version: 3, tree: out };
}

/** 给还没有 id 的旧点位补一个，保证「改名不失联」 */
function ensureItemIds(fav) {
  if (_idMigrated) return;
  let dirty = false;
  walkAll(fav.tree || [], (n) => {
    n.points = (n.points || []).map((pt) => {
      if (pt && !pt.id) { dirty = true; return Object.assign({}, pt, { id: genPointId() }); }
      return pt;
    });
  });
  if (dirty) setFav(fav);
  _idMigrated = true;
}

function setFav(fav) {
  try {
    store.set(STORAGE_FAV, fav);
    // 通知地图页「收藏层」重建 marker（眼睛开关、新增、删除都走这里）
    store.set('fav_refresh_token', { token: Date.now() });
  } catch (e) { /* ignore */ }
  return fav;
}

/** v1 扁平 folders -> v3 一级（每个旧收藏夹变成一个顶层文件夹，点位原样带上） */
function migrate(old) {
  const folders = (old && Array.isArray(old.folders)) ? old.folders : [];
  const tree = folders.map(f => ({
    id: f.id || genId(),
    name: f.name || '收藏夹',
    level: 1,
    parentId: null,
    isDefault: !!f.isDefault,
    showOnMap: f.showOnMap !== false,
    points: (f.points || []).map(normalizeItem),
    children: [],
    guide: { status: 'none', text: '', updateTime: 0 }
  }));
  return { version: 3, tree };
}

/** 根节点数组（顶层文件夹） */
function getTree() {
  return getFav().tree || [];
}

/**
 * 确保存在一个 1 级默认收藏夹（收藏动作需要默认夹时调用）
 *
 * 第二十七轮（用户明确）：「默认改为我的点位」。
 * 第六十二轮（用户明确）：**默认夹被改名后就不再默认是**。
 *   老逻辑：认 isDefault 标记 → 用户把「我的点位」改叫「钓鱼」后，
 *   之后所有新收藏仍然落进「钓鱼」，用户想不通「我明明改了名，怎么还往里塞」。
 *   新逻辑：改名即卸任（见 syncDefaultFlag），ensureDefault 找不到默认夹时
 *   ① 先认领一个**正好叫「我的点位」**的夹（用户自己建的同名夹也算），
 *   ② 都没有就新建一个 —— 于是新收藏自动进新的「我的点位」。
 */
function ensureDefault() {
  const fav = getFav();
  let def = fav.tree.find(n => n.isDefault);
  if (!def) {
    const same = fav.tree.find(n => n && n.name === DEFAULT_FOLDER_NAME);
    if (same) {
      same.isDefault = true;
      setFav(fav);
      return same;
    }
    const node = newNode(DEFAULT_FOLDER_NAME, null);
    node.isDefault = true;
    fav.tree.unshift(node);
    setFav(fav);
    return node;
  }
  // 老数据迁移：默认夹还是旧名字就改成新名字
  if (LEGACY_FOLDER_NAMES.indexOf(def.name) >= 0) {
    def.name = DEFAULT_FOLDER_NAME;
    setFav(fav);
  }
  return def;
}

/**
 * ★ 第六十二轮：改名与「默认夹」身份的同步规则（用户明确）。
 *
 * 一句话：**名字叫「我的点位」的才是默认夹**，改名 = 卸任。
 *   · 把「我的点位」改成「钓鱼」 → 卸任 isDefault（钓鱼此后就是个普通夹，
 *     里面原有的点位一个不动），下次收藏时 ensureDefault 会新建一个「我的点位」；
 *   · 把「钓鱼」改回「我的点位」 → 在没有其它默认夹的前提下重新认领它。
 */
function syncDefaultFlag(fav, node) {
  const tree = (fav && fav.tree) || [];
  if (node.name === DEFAULT_FOLDER_NAME) {
    if (!node.isDefault) {
      const other = tree.filter(n => n !== node && n.isDefault)[0];
      if (!other) node.isDefault = true;
    }
    return;
  }
  if (node.isDefault) node.isDefault = false;
}

function newNode(name, parentId) {
  return {
    id: genId(),
    name: String(name || '').trim().slice(0, 12) || '新文件夹',
    level: 1,
    parentId: null,
    isDefault: false,
    showOnMap: true,
    points: [],
    children: [],
    guide: { status: 'none', text: '', updateTime: 0 }
  };
}

/* ================= 点位 Item ================= */

/** 点位唯一 key：名称 + 坐标（无坐标时退化为纯名称），跨页面稳定 */
function pKey(p) {
  if (!p) return '';
  const lat = typeof p.latitude === 'number' ? Math.round(p.latitude * 10000) : '';
  const lng = typeof p.longitude === 'number' ? Math.round(p.longitude * 10000) : '';
  return String(p.name || '').trim() + '|' + lat + '|' + lng;
}

/** 补全 item 的必备字段（旧数据/新数据统一） */
function normalizeItem(it) {
  const o = Object.assign({}, it || {});
  if (!o.id) o.id = genPointId();
  if (!o.key) o.key = pKey(o);
  if (!o.name) o.name = '';
  if (!o.createTime) o.createTime = Date.now();
  if (o.showOnMap === undefined) o.showOnMap = true;
  if (!o.guide) o.guide = { status: 'none', text: '', updateTime: 0 };
  return o;
}

/**
 * 点位身份：优先用稳定 id，旧数据回落为「名称+坐标」
 * 注意：名称只是展示字段，绝不能再当身份用——改名会失联（P0-5）
 */
function keyOf(p) {
  if (!p) return '';
  // 只认自己发的 uuid（p_ 前缀）。复核页的 point.id 是数组下标，绝不能当身份用
  if (typeof p.id === 'string' && p.id.indexOf('p_') === 0) return p.id;
  return pKey(p);
}

/** 点位是否命中某个 key（id 或旧 pKey 都认，兼容迁移期） */
function matchKey(pt, key) {
  if (!pt || !key) return false;
  return pt.id === key || pt.key === key;
}

/**
 * 把解析点 / 地图点转成库内条目（副本）
 * @param {object} p 源点位
 * @param {object} extra 附加字段（如 fromMapId：来自哪份解析，便于溯源）
 */
function pointItem(p, extra) {
  const item = {
    // 只沿用本库签发的 uuid；外部传来的 id（如复核页的数组下标）一律重新签发
    id: (typeof p.id === 'string' && p.id.indexOf('p_') === 0) ? p.id : genPointId(),
    key: pKey(p),
    name: p.name || '',
    category: p.category || 'jingdian',
    group: p.group || '',
    section: p.section || '',
    primary: p.primary !== false,
    reason: p.reason || '',
    quote: p.quote || '',
    imageUrls: (p.imageUrls || []).slice(0, 6),
    colorOverride: p.colorOverride || '',
    latitude: p.latitude,
    longitude: p.longitude,
    poiName: p.poiName || p.name || '',
    note: p.note || '',
    showOnMap: p.showOnMap !== false,
    createTime: p.createTime || Date.now(),
    // 溯源：这个收藏点是从哪篇攻略的哪个点位复制来的（副本独立，不随攻略自动变）
    fromMapId: (extra && extra.fromMapId) || p.fromMapId || '',
    fromName: (extra && extra.fromName) || p.fromName || '',
    fromGuideId: (extra && extra.fromGuideId) || p.fromGuideId || '',
    fromGuideName: (extra && extra.fromGuideName) || p.fromGuideName || '',
    fromPointId: (extra && extra.fromPointId) || p.fromPointId || '',
    // 标星时把攻略点位的信息整份带过来（名称/图片/备注默认一致，之后各自独立）
    snapshot: (extra && extra.snapshot) || p.snapshot || null,
    // 收藏标记图标（第十三轮）：形状 + 颜色索引，缺省时由 favicon.js 兜底
    favShape: p.favShape || ''
  };
  if (typeof p.favColorIdx === 'number') item.favColorIdx = p.favColorIdx;
  if (p.symbol) item.symbol = p.symbol;
  if (typeof p.colorIdx === 'number') item.colorIdx = p.colorIdx;
  return item;
}

/* ================= 树遍历 ================= */

/**
 * 递归查找节点
 * @returns {{node:object, parent:object|null, siblings:array}|null}
 */
function findNode(id, tree, parent) {
  const list = tree || getTree();
  for (const n of list) {
    if (n.id === id) return { node: n, parent: parent || null, siblings: list };
    const hit = findNode(id, n.children || [], n);
    if (hit) return hit;
  }
  return null;
}

/** 在指定 tree 中查找（避免 getFav() 反复反序列化） */
function findNodeIn(id, tree) {
  return findNode(id, tree || getTree());
}

/** 取节点（不存在返回 null） */
function getNode(id) {
  const hit = findNode(id);
  return hit ? hit.node : null;
}

/** 简写：拿节点 */
function nodeById(id) {
  return getNode(id);
}

/** 从根到该节点的名称路径，如 ['川西','稻城亚丁'] */
function pathOf(id) {
  const walk = (list, stack) => {
    for (const n of list) {
      const next = stack.concat([n.name]);
      if (n.id === id) return next;
      const hit = walk(n.children || [], next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(getTree(), []) || [];
}

/** 扁平化整棵树（带 level 与路径），供树形选择器 / 下拉使用 */
function flatNodes() {
  const out = [];
  const walk = (list, level, stack) => {
    for (const n of list) {
      const path = stack.concat([n.name]);
      out.push({
        id: n.id, name: n.name, level,
        parentId: n.parentId || null,
        path,
        hasChildren: (n.children || []).length > 0,
        pointCount: (n.points || []).length
      });
      walk(n.children || [], level + 1, path);
    }
  };
  walk(getTree(), 1, []);
  return out;
}

/** 子树最大深度（自身算 1） */
function depthOf(node) {
  if (!node) return 0;
  const kids = node.children || [];
  if (!kids.length) return 1;
  let max = 0;
  for (const c of kids) max = Math.max(max, depthOf(c));
  return 1 + max;
}

/** 该节点（含所有子孙）的点位总数 */
function countPointsDeep(id) {
  const node = getNode(id);
  if (!node) return 0;
  let n = (node.points || []).length;
  for (const c of (node.children || [])) n += countPointsDeep(c.id);
  return n;
}

/** 收集点位：includeChildren=true 时带上所有子孙层的点位 */
function collectPoints(id, includeChildren) {
  const node = getNode(id);
  if (!node) return [];
  let list = (node.points || []).slice();
  if (includeChildren !== false) {
    for (const c of (node.children || [])) {
      list = list.concat(collectPoints(c.id, true));
    }
  }
  return list;
}

/* ================= 原子：先取 fav，再 mut，再写回 ================= */

function mutate(fn) {
  const fav = getFav();
  const r = fn(fav);
  setFav(fav);
  return r;
}

/* ================= 文件夹管理 ================= */

/**
 * 新建文件夹（第十一轮：只建顶层，parentId 一律忽略，保证收藏夹永远一级）
 * @param {string} name
 * @returns {object} 新节点
 */
function createFolder(name) {
  const fav = getFav();
  const node = newNode(name, null);
  fav.tree.push(node);
  setFav(fav);
  return node;
}

/** 该节点还能不能建子文件夹（一级结构恒为 false） */
function canAddChild() {
  return false;
}

function renameFolder(id, name) {
  return mutate((fav) => {
    const hit = findNodeIn(id, fav.tree);
    if (!hit) return false;
    const node = hit.node;
    node.name = String(name || '').trim().slice(0, 12) || node.name;
    // 第六十二轮：改名顺带重算「谁才是默认夹」（改掉默认名即卸任）
    syncDefaultFlag(fav, node);
    return true;
  });
}

/** 删除文件夹（连同子孙与点位）
 *  注意：必须在 getFav() 拿到的同一棵树上操作。用 findNode(id) 会再从 storage
 *  反序列化出一棵新树，splice 改的是临时对象，写回时原封不动（P0-3）。 */
function deleteFolder(id) {
  return mutate((fav) => {
    const hit = findNodeIn(id, fav.tree);
    if (!hit) return false;
    const list = hit.parent ? (hit.parent.children || []) : fav.tree;
    const idx = list.findIndex(n => n.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    return true;
  });
}

/**
 * 移动文件夹到另一个父节点下
 * @returns {boolean} 层级超限 / 移到自己子孙下 会失败
 */
function moveFolder(id, newParentId) {
  if (id === newParentId) return false;
  return mutate((fav) => {
    const hit = findNodeIn(id, fav.tree);
    if (!hit) return false;
    const node = hit.node;
    if (newParentId) {
      const p = findNodeIn(newParentId, fav.tree);
      if (!p) return false;
      // 不能移到自己的子孙下面（否则树会断）
      if (isDescendant(node, newParentId)) return false;
      if (p.node.level + depthOf(node) > MAX_LEVEL) return false;
    } else {
      if (depthOf(node) > MAX_LEVEL) return false;
    }
    // 先从原位置摘除（同一棵树上），再挂到新位置 —— 顺序反了会变成「复制」
    const list = hit.parent ? (hit.parent.children || []) : fav.tree;
    const idx = list.findIndex(n => n.id === id);
    if (idx >= 0) list.splice(idx, 1);
    if (newParentId) {
      const p = findNodeIn(newParentId, fav.tree);
      if (!p) return false;
      p.node.children = p.node.children || [];
      node.parentId = newParentId;
      setLevel(node, p.node.level + 1);
      p.node.children.push(node);
    } else {
      node.parentId = null;
      setLevel(node, 1);
      fav.tree.push(node);
    }
    return true;
  });
}

function isDescendant(node, ancestorId) {
  if (!node) return false;
  if (node.id === ancestorId) return true;
  for (const c of (node.children || [])) {
    if (isDescendant(c, ancestorId)) return true;
  }
  return false;
}

function setLevel(node, level) {
  node.level = level;
  for (const c of (node.children || [])) setLevel(c, level + 1);
}

/** 同级排序（parentId 为空则排顶层） */
function reorderFolders(parentId, ids) {
  mutate((fav) => {
    const list = parentId
      ? (((findNodeIn(parentId, fav.tree) || {}).node || {}).children || [])
      : fav.tree;
    if (!list.length) return;
    const map = {};
    for (const n of list) map[n.id] = n;
    const next = ids.filter(id => map[id]).map(id => map[id]);
    for (const n of list) if (ids.indexOf(n.id) < 0) next.push(n);
    if (parentId) {
      const p = findNodeIn(parentId, fav.tree);
      if (p) p.node.children = next;
    } else {
      fav.tree = next;
    }
  });
}

/* ================= 点位管理 ================= */

/** 加入某个文件夹（副本，幂等） */
function addPoint(nodeId, point, extra) {
  return mutate((fav) => {
    const hit = findNodeIn(nodeId, fav.tree);
    if (!hit) return false;
    const node = hit.node;
    const item = pointItem(point, extra);
    node.points = node.points || [];
    // 同点位判断：新数据比 id，旧数据比 name+坐标，两者都算命中
    if (node.points.some(pt => (item.id && pt.id === item.id) || pt.key === item.key)) return false;
    node.points.push(item);
    return true;
  });
}

/** 批量加入多个文件夹 */
function addItem(point, nodeIds) {
  if (!point || !Array.isArray(nodeIds) || !nodeIds.length) return [];
  const added = [];
  for (const id of nodeIds) {
    if (addPoint(id, point)) added.push(id);
  }
  return added;
}

/** 从某个文件夹移除（不动其他文件夹） */
function removePoint(nodeId, key) {
  return mutate((fav) => {
    const hit = findNodeIn(nodeId, fav.tree);
    if (!hit) return false;
    const node = hit.node;
    node.points = (node.points || []).filter(pt => !matchKey(pt, key));
    return true;
  });
}

/** 取消收藏：从整棵树移除 */
function removeItem(key) {
  mutate((fav) => {
    walkAll(fav.tree, (n) => {
      n.points = (n.points || []).filter(pt => !matchKey(pt, key));
    });
  });
}

function walkAll(list, fn) {
  for (const n of (list || [])) {
    fn(n);
    walkAll(n.children || [], fn);
  }
}

/** 是否已在我的点位库里（任意层） */
function isFav(key) {
  if (!key) return false;
  return nodeIdsOf(key).length > 0;
}

/** 该点位在哪些文件夹里 */
function nodeIdsOf(key) {
  const out = [];
  walkAll(getTree(), (n) => {
    if ((n.points || []).some(pt => matchKey(pt, key))) out.push(n.id);
  });
  return out;
}

/** 兼容旧命名：foldersOf */
function foldersOf(key) {
  return nodeIdsOf(key);
}

/**
 * 覆盖该点位所属文件夹（勾选哪些就在哪些，不在的移除）
 * 一个都不勾时保留原归属，防止点位变孤儿
 */
function setNodesOf(key, ids) {
  const want = ids || [];
  if (!want.length) return false;
  return mutate((fav) => {
    let src = null;
    walkAll(fav.tree, (n) => {
      const hit = (n.points || []).find(pt => matchKey(pt, key));
      if (hit && !src) src = hit;
    });
    walkAll(fav.tree, (n) => {
      const hit = (n.points || []).find(pt => matchKey(pt, key));
      const need = want.indexOf(n.id) >= 0;
      if (need && !hit && src) {
        n.points = n.points || [];
        n.points.push(Object.assign({}, src));
      } else if (!need && hit) {
        n.points = n.points.filter(pt => !matchKey(pt, key));
      }
    });
  });
}

/** 全局更新点位字段（所有含该点的文件夹同步） */
function updateItem(key, patch) {
  if (!key || !patch) return 0;
  return mutate((fav) => {
    let n = 0;
    walkAll(fav.tree, (node) => {
      node.points = (node.points || []).map(pt => {
        if (!matchKey(pt, key)) return pt;
        n++;
        return Object.assign({}, pt, patch);
      });
    });
    return n;
  });
}

/** 移动/复制点位到另一个文件夹 */
function transferPoint(key, fromNodeId, toNodeId, mode) {
  if (fromNodeId === toNodeId) return false;
  return mutate((fav) => {
    const from = findNodeIn(fromNodeId, fav.tree);
    const to = findNodeIn(toNodeId, fav.tree);
    if (!from || !to) return false;
    const idx = (from.node.points || []).findIndex(pt => matchKey(pt, key));
    if (idx < 0) return false;
    const item = from.node.points[idx];
    to.node.points = to.node.points || [];
    if (!to.node.points.some(pt => matchKey(pt, key))) to.node.points.push(Object.assign({}, item));
    if (mode === 'move') from.node.points.splice(idx, 1);
    return true;
  });
}

/** 同层内点位排序 */
function reorderPoints(nodeId, keys) {
  mutate((fav) => {
    const node = findNodeIn(nodeId, fav.tree);
    if (!node) return;
    const map = {};
    const pts = (node.node.points || []);
    for (const pt of pts) { if (pt.id) map[pt.id] = pt; if (pt.key) map[pt.key] = pt; }
    const next = [];
    for (const k of keys) { const pt = map[k]; if (pt && next.indexOf(pt) < 0) next.push(pt); }
    // 兜底：keys 里漏掉的点位补在末尾，绝不静默丢弃
    for (const pt of pts) if (next.indexOf(pt) < 0) next.push(pt);
    node.node.points = next;
  });
}

/** 全库点位（去重，按 id 优先），供地图叠加显示 */
function allPoints() {
  const map = {};
  const out = [];
  walkAll(getTree(), (n) => {
    for (const pt of (n.points || [])) {
      const k = pt.id || pt.key || pKey(pt);
      if (!map[k]) { map[k] = 1; out.push(pt); }
    }
  });
  return out;
}

/* ================= 图层可见性（眼睛开关） ================= */

/** 收藏层的显示规则：文件夹可见 && 点位自身可见，两条都满足才上图 */
function isPointVisible(node, pt) {
  return node.showOnMap !== false && pt.showOnMap !== false;
}

/** 单个文件夹的眼睛（联动：点位跟着文件夹一起显隐，第十二轮） */
function setFolderVisible(id, show) {
  return mutate((fav) => {
    const hit = findNodeIn(id, fav.tree);
    if (!hit) return false;
    hit.node.showOnMap = !!show;
    // 点位眼睛同步跟随文件夹，UI 与地图表现一致
    hit.node.points = (hit.node.points || []).map(pt => (
      Object.assign({}, pt, { showOnMap: !!show })
    ));
    return true;
  });
}

/** 单个点位的眼睛（★ 第六十四轮：改完同步推导父夹眼睛，做到“点开一个点夹开，全关则夹关”） */
function setPointVisible(nodeId, key, show) {
  return mutate((fav) => {
    const hit = findNodeIn(nodeId, fav.tree);
    if (!hit) return false;
    hit.node.points = (hit.node.points || []).map(pt => (
      matchKey(pt, key) ? Object.assign({}, pt, { showOnMap: !!show }) : pt
    ));
    // 点位眼睛变化后，父夹的眼睛要跟随多数状态：
    // 任一睁开 → 夹睁开；全部闭眼 → 夹闭眼。
    const pts = hit.node.points || [];
    const anyOn = pts.some(p => p.showOnMap !== false);
    if (anyOn !== (hit.node.showOnMap !== false)) {
      hit.node.showOnMap = anyOn;
    }
    return true;
  });
}

/** 文件夹里「开着眼睛」的点位数（用于三态展示：全开 / 部分 / 全关） */
function visibleCountOf(nodeId) {
  const node = getNode(nodeId);
  if (!node) return 0;
  return (node.points || []).filter(pt => pt.showOnMap !== false).length;
}

/**
 * 「我的收藏夹」总眼睛：一键全开 / 全关（第十三轮修复）
 *
 * 旧实现只改文件夹的 showOnMap，点位自己的眼睛原样保留 —— 于是出现
 * 「点了全显示，但先前被单独关掉的点仍然不显示」的怪现象。
 * 正确语义（用户明确要求）：
 *   总开 → 所有文件夹可见 + 所有点位可见（连之前单独隐藏的点也一起亮）；
 *   总关 → 所有文件夹 + 所有点位一起隐藏。
 */
function setAllVisible(show) {
  const on = !!show;
  return mutate((fav) => {
    walkAll(fav.tree, (n) => {
      n.showOnMap = on;
      n.points = (n.points || []).map(pt => Object.assign({}, pt, { showOnMap: on }));
    });
    return true;
  });
}

/** 总眼睛当前状态：文件夹与点位全部可见才算「全显示」 */
function allVisible() {
  const tree = getTree();
  if (!tree.length) return false;
  return tree.every(n => n.showOnMap !== false
    && (n.points || []).every(pt => pt.showOnMap !== false));
}

/** 是否「部分可见」——文件夹或点位存在混显，用于眼睛的三态图标 */
function partialVisible() {
  const tree = getTree();
  if (!tree.length) return false;
  if (allVisible()) return false;
  return tree.some(n => n.showOnMap !== false
    || (n.points || []).some(pt => pt.showOnMap !== false));
}

/** 收藏层当前实际会画出的点位数（与地图 rebuild 完全同源，避免两处口径不一致） */
function onMapCount() {
  return visiblePoints().length;
}

/** 地图「收藏层」要画的点位（带所属文件夹信息） */
function visiblePoints() {
  const out = [];
  walkAll(getTree(), (n) => {
    if (n.showOnMap === false) return;
    for (const pt of (n.points || [])) {
      if (pt.showOnMap === false) continue;
      if (!(pt.latitude && pt.longitude)) continue;
      out.push(Object.assign({}, pt, { _nodeId: n.id, _nodeName: n.name }));
    }
  });
  return out;
}

/* ================= 按攻略来源查找/移除（第十二轮） ================= */

/** 该攻略点位（fromPointId）的副本目前在哪些文件夹里 */
function nodeIdsOfSource(fromPointId) {
  if (!fromPointId) return [];
  const out = [];
  walkAll(getTree(), (n) => {
    if ((n.points || []).some(pt => pt.fromPointId === fromPointId)) out.push(n.id);
  });
  return out;
}

/** 从某个文件夹里移除某攻略点位的全部副本（按 fromPointId） */
function removeBySource(nodeId, fromPointId) {
  if (!fromPointId) return false;
  return mutate((fav) => {
    const hit = findNodeIn(nodeId, fav.tree);
    if (!hit) return false;
    const before = (hit.node.points || []).length;
    hit.node.points = (hit.node.points || []).filter(pt => pt.fromPointId !== fromPointId);
    return hit.node.points.length < before;
  });
}

/** 取消收藏某攻略点位：把它在所有文件夹里的副本一次性摘掉（复核页星标点第二下用） */
function removeBySourceAll(fromPointId) {
  if (!fromPointId) return 0;
  return mutate((fav) => {
    let n = 0;
    walkAll(fav.tree, (node) => {
      const before = (node.points || []).length;
      node.points = (node.points || []).filter(pt => pt.fromPointId !== fromPointId);
      n += before - node.points.length;
    });
    return n;
  });
}

/** 该攻略点位当前是否已被收藏（按 fromPointId 溯源，跨夹判断） */
function isStarred(fromPointId) {
  if (!fromPointId) return false;
  let hit = false;
  walkAll(getTree(), (n) => {
    if (!hit && (n.points || []).some(pt => pt.fromPointId === fromPointId)) hit = true;
  });
  return hit;
}

/**
 * 按来源攻略点位 id 取**第一条**收藏副本（第三十九轮新增）。
 * 用途：地图弹框的星按钮要显示「该点位真实的收藏形状/颜色」，
 * 需要拿到副本的 favShape/favColorIdx（同一个点被收进多个夹时形状一致，
 * 取第一条即可；真有多份不同形状也以第一份为准）。
 */
function getBySource(fromPointId) {
  if (!fromPointId) return null;
  let found = null;
  walkAll(getTree(), (n) => {
    if (found) return;
    const pt = (n.points || []).find(x => x.fromPointId === fromPointId);
    if (pt) found = Object.assign({ _nodeId: n.id }, pt);
  });
  return found;
}

/** 标星收藏：把攻略点位复制一份进指定文件夹 */
function starFromGuide(nodeId, guidePoint, guide) {  return addPoint(nodeId, guidePoint, {
    fromGuideId: (guide && guide.id) || '',
    fromGuideName: (guide && guide.name) || '',
    fromPointId: (guidePoint && guidePoint.id) || '',
    fromMapId: (guide && guide._id) || '',
    fromName: (guidePoint && guidePoint.name) || '',
    snapshot: {
      name: (guidePoint && guidePoint.name) || '',
      latitude: guidePoint && guidePoint.latitude,
      longitude: guidePoint && guidePoint.longitude,
      at: Date.now()
    }
  });
}

/* ================= 文件夹攻略 ================= */

/** 写入某文件夹的整理攻略 */
function setGuide(nodeId, text) {
  return mutate((fav) => {
    const hit = findNodeIn(nodeId, fav.tree);
    if (!hit) return false;
    hit.node.guide = {
      status: text ? 'done' : 'none',
      text: text || '',
      updateTime: Date.now()
    };
    return true;
  });
}

function getGuide(nodeId) {
  const node = getNode(nodeId);
  return (node && node.guide) || { status: 'none', text: '', updateTime: 0 };
}

/** 清空（供清除本地数据用） */
function clearAll() {
  try { store.remove(STORAGE_FAV); } catch (e) { /* ignore */ }
}

export default {
  STORAGE_FAV, MAX_LEVEL,
  getFav, setFav, getTree, ensureDefault, clearAll,
  pKey, keyOf, matchKey, pointItem, normalizeItem, genPointId,
  findNode, getNode, nodeById, pathOf, flatNodes, depthOf, countPointsDeep, collectPoints,
  createFolder, canAddChild, renameFolder, syncDefaultFlag, deleteFolder, moveFolder, reorderFolders,
  addPoint, addItem, removePoint, removeItem, transferPoint, updateItem, setNodesOf,
  isFav, foldersOf, nodeIdsOf, reorderPoints, allPoints,
  setGuide, getGuide,
  isPointVisible, setFolderVisible, setPointVisible, visibleCountOf,
  setAllVisible, allVisible, partialVisible, onMapCount, visiblePoints, starFromGuide,
  nodeIdsOfSource, removeBySource, removeBySourceAll, isStarred, getBySource
};
