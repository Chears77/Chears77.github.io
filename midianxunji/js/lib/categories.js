import store from '../store.js';
/**
 * categories.js —— 点位分类体系（支持「我的」页自定义）
 *
 * 分类配置：{ key, name, symbol, colorIdx }
 *  - symbol：marker 符号（10 种预设，对应 images/marker 矩阵）
 *  - colorIdx：颜色序号（12 色预设板）
 * 自定义配置存本机 storage「custom_categories」，未配置时用默认 4 分类。
 */
const STORAGE_CATS = 'custom_categories';

/* 12 色预设板（与 marker 图标生成脚本一致） */
const PALETTE = [
  '#12B76A', '#F59E0B', '#3B82F6', '#8B5CF6', '#EF4444',
  '#06B6D4', '#F97316', '#10B981', '#64748B', '#EC4899',
  '#14B8A6', '#84CC16'
];

/* 8 种预设符号（V2 极简几何，对应 images/marker 矩阵） */
const SYMBOLS = [
  { key: 'mountain', name: '山岳' },
  { key: 'bowl', name: '美食' },
  { key: 'house', name: '住宿' },
  { key: 'bag', name: '购物' },
  { key: 'tree', name: '自然' },
  { key: 'cup', name: '咖啡' },
  { key: 'camera', name: '打卡' },
  { key: 'dot', name: '其他' }
];

/* 默认分类 */
const DEFAULT_CATEGORIES = [
  { key: 'jingdian', name: '景点', symbol: 'mountain', colorIdx: 0 },
  { key: 'meishi', name: '美食', symbol: 'bowl', colorIdx: 1 },
  { key: 'zhusu', name: '住宿', symbol: 'house', colorIdx: 2 },
  { key: 'qita', name: '其他', symbol: 'dot', colorIdx: 8 }
];

const DEFAULT_CATEGORY = 'qita';

/* ===== 存取 ===== */
function getCategories() {
  const saved = store.get(STORAGE_CATS);
  if (Array.isArray(saved) && saved.length) return saved;
  return DEFAULT_CATEGORIES.slice();
}

function saveCategories(list) {
  store.set(STORAGE_CATS, list);
}

function resetCategories() {
  store.remove(STORAGE_CATS);
}

function getCategory(key) {
  const cats = getCategories();
  return cats.find(c => c.key === key) || cats.find(c => c.key === DEFAULT_CATEGORY) || cats[cats.length - 1];
}

function colorOf(categoryKey) {
  const c = getCategory(categoryKey);
  return PALETTE[c.colorIdx] || PALETTE[8];
}

/**
 * marker 图标路径（旧数据引用已废弃符号时自动降级为 dot，避免裂图）
 * 第十八轮：marker 统一为「纯圆形 + 白色类别符号」，只保留 big（102px）；
 *          small / grey 变体从未被调用，已随图标一起清理。
 *
 * 第十九轮语义确认（用户明确）：**圆形 = 攻略点位**。这个图标同时承担两种角色——
 *   ① 攻略里存在、但还没被我收藏的点位；
 *   ② 被我「攻略收藏」（攻略页那颗星）的点位 —— 它仍然属于攻略，所以照样是圆。
 * 我自己的「点位收藏」不带圆（见 favicon.mapPinPath），两者一眼可分。
 * @param {string} categoryKey 分类 key
 */
function markerIcon(categoryKey) {
  const c = getCategory(categoryKey);
  const known = SYMBOLS.some(s => s.key === c.symbol);
  const sym = known ? c.symbol : 'dot';
  return 'images/marker/marker-' + sym + '-' + c.colorIdx + '-big.png';
}

/** 把模型可能返回的中文分类名归一化为 key（兼容模型输出） */
function normalizeCategory(raw) {
  if (!raw) return DEFAULT_CATEGORY;
  const s = String(raw).trim();
  const map = {
    '景点': 'jingdian', '景区': 'jingdian', '打卡': 'jingdian', '风景': 'jingdian',
    '公园': 'jingdian', '博物馆': 'jingdian', '地标': 'jingdian', '古镇': 'jingdian',
    '老街': 'jingdian', '历史': 'jingdian', '寺庙': 'jingdian', '山水': 'jingdian',
    '遛娃': 'jingdian', '亲子': 'jingdian', 'jingdian': 'jingdian',
    '美食': 'meishi', '餐厅': 'meishi', '小吃': 'meishi', '饭': 'meishi', '美食街': 'meishi',
    '火锅': 'meishi', 'meishi': 'meishi',
    '住宿': 'zhusu', '民宿': 'zhusu', '酒店': 'zhusu', '客栈': 'zhusu', 'zhusu': 'zhusu'
  };
  // 自定义分类名也可能被模型直接返回
  const cats = getCategories();
  const hit = cats.find(c => c.name === s);
  if (hit) return hit.key;
  return map[s] || DEFAULT_CATEGORY;
}

export default {
  PALETTE, SYMBOLS, STORAGE_CATS,
  getCategories, saveCategories, resetCategories,
  getCategory, colorOf, markerIcon,
  normalizeCategory, DEFAULT_CATEGORY
};
