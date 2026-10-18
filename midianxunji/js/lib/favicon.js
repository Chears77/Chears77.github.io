/**
 * favicon.js —— 「收藏图标」体系（第十三轮新增）
 *
 * 为什么要独立于 categories.js：
 *   categories 的 marker 是「圆 + 类别符号」，颜色 12 色、符号 8 种，
 *   那是给**地图上的攻略点位**用的；而收藏页要的是「星形/书签」这类**收藏语义**的形状，
 *   两套语义混在一起会让用户困惑。所以单独开一套：
 *     · 形状 6 种：五角星 / 书签 / 爱心 / 小旗 / 圆点 / 菱形
 *     · 颜色 8 种：黄、红、绿、蓝、紫、橙、青、粉
 *     · 图片：images/fav/fav-{shape}-{colorIdx}.png
 *
 * 默认值（用户明确）：
 *   · 点位收藏 → 黄色五角星（star / 0）
 *   · 攻略收藏 → 红色五角星（star / 1）
 * 两者只差颜色，形状一致 —— 一眼能分清「这是我收藏的点」还是「收藏的攻略」。
 *
 * ★ 地图 marker 三态（第十九轮重定，务必按这个理解）：
 *   · 纯形状（无圆）  = 点位收藏（我自己收的点）
 *   · 纯圆 + 类别符号 = 攻略收藏（来自某篇攻略的点位）
 *   · 圆环 + 形状     = 两者都有
 *   圆的「有无」就是「是不是攻略来的」这个语义，别再加错。
 */

const SHAPES = [
  { key: 'star', name: '星' },
  { key: 'bookmark', name: '书签' },
  { key: 'heart', name: '爱心' },
  { key: 'flag', name: '小旗' },
  { key: 'dot', name: '圆点' },
  { key: 'diamond', name: '菱形' }
];

/**
 * 第二十二轮（用户明确）：**两套形状严格分离，绝不交叉跨用**。
 *   · 点位收藏 → SHAPES（上面的 6 个「收藏语义」形状）
 *   · 攻略收藏 → GUIDE_SHAPES（下面 8 个「地点语义」符号，与分类体系一致）
 * 之前攻略收藏直接复用 SHAPES，导致两个选择器长得一模一样、语义糊成一片。
 * 现在攻略符号单独一套：images/fav/sym-{sym}-{i}.png（纯符号、透明底、单色）。
 * 地图上的攻略 marker 仍是「圆包符号」marker-{sym}-{i}-big.png，两者配套。
 */
const GUIDE_SHAPES = [
  { key: 'mountain', name: '山岳' },
  { key: 'bowl', name: '美食' },
  { key: 'house', name: '住宿' },
  { key: 'bag', name: '购物' },
  { key: 'tree', name: '自然' },
  { key: 'cup', name: '咖啡' },
  { key: 'camera', name: '打卡' },
  { key: 'dot', name: '其他' }
];

const COLORS = [
  '#F5B301', // 0 黄 —— 点位收藏默认
  '#EF4444', // 1 红 —— 攻略收藏默认
  '#12B76A', // 2 绿
  '#3B82F6', // 3 蓝
  '#8B5CF6', // 4 紫
  '#F97316', // 5 橙
  '#06B6D4', // 6 青
  '#EC4899'  // 7 粉
];

const DEFAULT_POINT = { shape: 'star', colorIdx: 0 };  // 点位收藏：黄星
const DEFAULT_GUIDE = { shape: 0, colorIdx: 1 };       // 攻略收藏：红色（颜色索引即形状索引的占位，见 guideIcon）

/**
 * 攻略符号默认（红色，符号取「山岳」= 与景点分类一致） */
const DEFAULT_GUIDE_SYM = { sym: 'mountain', colorIdx: 1 };

/**
 * ★★ 第二十八轮关键修正：marker 图标库的色号 ≠ COLORS 下标！
 *
 * 历史遗留：`marker-{sym}-{i}-big.png` 是早期用 `tools/gen_markers.py` 的
 *   PALETTE（绿/橙/蓝/紫/红/青/橙/翠绿/灰/粉/青绿/黄绿，12 色）生成的，
 *   而 `fav/fav-*.png` / `favpin-*` / `star-*` 用的是 `FAV_COLORS`
 *   （黄/红/绿/蓝/紫/橙/青/粉，8 色）。
 *
 * 结果：用户在颜色选择器里点「黄色」（COLORS[0]），拼出 `marker-xxx-0-big.png`
 *   实际拿到的是**绿色**圆 —— 这就是「点击颜色和生成颜色对应不上」的根因。
 *
 * 修法：保留 COLORS 作为**统一的语义色板**（UI 色点、fav 系列图标都用它），
 *   只对 marker 系列做一次「语义色号 → marker 色号」的映射。
 *   下面是实测 12 张 marker 文件的主色反查出来的对应关系，不要凭感觉改。
 */
const MARKER_CI_BY_COLOR = [1, 4, 0, 2, 3, 6, 5, 9];   // COLORS 索引 → marker 色号（黄红绿蓝紫橙青粉）
const MARKER_CI_EXTRA = [7, 8, 10, 11];                 // 分类图标可用的额外色（翠绿/灰/青绿/黄绿）

/** 灰色「未收藏」星（全 App 唯一来源）。
 * ★ 第六十八轮：换成 images/marker/star-gray-big.png —— 与已收藏的黄色五角星
 *   (marker/star-0-big.png) **同一张图形、同一尺寸（102×102 实心）**，只把填充换成中性灰。
 *   旧的 star-line-gray.png 是 44×44 的描边星，在小图上毛刺明显、且和收藏后的
 *   实心星大小/形状都对不上（用户 R68 反馈）。历史常量名保留兼容旧调用点。 */
const STAR_GRAY = 'images/marker/star-gray-big.png';
const STAR_LINE_GRAY = STAR_GRAY;

/** 语义色号（COLORS 下标）→ marker 图库色号 */
function markerColorIdx(colorIdx) {
  const i = (typeof colorIdx === 'number' && colorIdx >= 0 && colorIdx < COLORS.length) ? colorIdx : 0;
  return MARKER_CI_BY_COLOR[i];
}

/** marker 图库色号（0-11，分类默认会用到）→ 语义色号（COLORS 下标）；反查不到给 0 */
function colorIdxOfMarker(mci) {
  const k = MARKER_CI_BY_COLOR.indexOf(mci);
  if (k >= 0) return k;
  const e = MARKER_CI_EXTRA.indexOf(mci);
  return e >= 0 ? (COLORS.length + e) : 0;   // 额外色给一个越界值，调用方应识别为「非语义色」
}

/** 攻略符号的「圆底 marker」路径（用语义色号，内部自动映射到 marker 色号） */
function guideMarkerPath(sym, colorIdx) {
  const s = isGuideShape(sym) ? sym : 'dot';
  return 'images/marker/marker-' + s + '-' + markerColorIdx(colorIdx) + '-big.png';
}

function isShape(k) {
  return SHAPES.some(s => s.key === k);
}

function isGuideShape(k) {
  return GUIDE_SHAPES.some(s => s.key === k);
}

/** 图标路径；非法形状自动降级为五角星，非法颜色降级为索引 0 */
function path(shape, colorIdx) {
  const s = isShape(shape) ? shape : 'star';
  const i = (typeof colorIdx === 'number' && colorIdx >= 0 && colorIdx < COLORS.length) ? colorIdx : 0;
  return 'images/fav/fav-' + s + '-' + i + '.png';
}

/** 攻略符号缩略图路径（纯符号，透明底）；非法符号降级为「其他」圆点 */
function guidePath(sym, colorIdx) {
  const s = isGuideShape(sym) ? sym : 'dot';
  const i = (typeof colorIdx === 'number' && colorIdx >= 0 && colorIdx < COLORS.length) ? colorIdx : 0;
  return 'images/fav/sym-' + s + '-' + i + '.png';
}

/**
 * 地图 marker 路径（第十九轮语义更新）：
 *   点位收藏的「纯形状」图 —— favpin-{shape}-{i}.png（无圆圈，星形除外）。
 *   星形走 star-{i}-big.png，在 mapPinPath 里分流。
 */
function markerPath(shape, colorIdx) {
  const s = isShape(shape) ? shape : 'star';
  const i = (typeof colorIdx === 'number' && colorIdx >= 0 && colorIdx < COLORS.length) ? colorIdx : 0;
  return 'images/marker/favpin-' + s + '-' + i + '.png';
}

/** 从一条收藏记录解析出地图 marker 路径 */
function markerOf(rec, kind) {
  const ic = of(rec, kind);
  return Object.assign(ic, { markerPath: markerPath(ic.shape, ic.colorIdx) });
}

/**
 * 地图 pin 形态（第十九轮定稿，用户明确要求）：
 *
 *   ① 只是「点位收藏」→ **完全照抄收藏页的图标**（形状 + 颜色逐一对齐，不加圈）
 *        · 星形   → star-{ci}-big.png      （纯五角星）
 *        · 其它形 → favpin-{shape}-{ci}.png（纯形状）
 *   ② 只是「攻略收藏」（或攻略里普通点位）→ 纯圆 + 类别符号（圆 = 来自攻略）
 *        不走这里，由 categories.markerIcon() 给。
 *   ③ 两者都有（既是点位收藏、又出现在攻略里）→ **圆环 + 收藏页的那个形状**
 *        · 星形   → star-ring-{ci}-big.png
 *        · 其它形 → ring-{shape}-{ci}.png
 *
 * 一句话：**有圆环 = 两边都有；光秃秃的形状 = 只是我自己收藏的；纯圆+符号 = 只在攻略里。**
 *
 * 颜色：①③ 用**收藏色**（用户自己在收藏页挑的那个颜色，严格对齐）；
 *       ② 用**分类色**。所以同一个点若只在攻略里是分类色、被我收藏后会变成我挑的收藏色——
 *       这正是用户要的「严格按照收藏页的来」。
 *
 * @param {object} rec 收藏记录（取 favShape / favColorIdx）
 * @param {boolean} isCommon 是否「既是攻略收藏又是点位收藏」→ 决定加不加圆环
 * @param {number} [colorIdxOverride] 覆盖颜色索引（保留参数位，当前调用方不再传）
 */
function mapPinPath(rec, isCommon, colorIdxOverride) {
  const ic = of(rec, 'point');
  const ci = (typeof colorIdxOverride === 'number' && colorIdxOverride >= 0) ? colorIdxOverride : ic.colorIdx;
  if (isCommon) {
    return ic.shape === 'star'
      ? 'images/marker/star-ring-' + ci + '-big.png'
      : 'images/marker/ring-' + ic.shape + '-' + ci + '.png';
  }
  // 纯形状：星形单独一套历史文件（star-{i}-big.png），其余走 favpin
  if (ic.shape === 'star') {
    return 'images/marker/star-' + ci + '-big.png';
  }
  return markerPath(ic.shape, ci);
}

/**
 * ★★ 第六十二轮：攻略点位图标的**唯一解析器** —— 地图与详情页必须走同一条路 ★★
 *
 * 起因（用户原话）：「每个点位详情页面，攻略收藏的图标与地图上面显示的图片对应不上」。
 * 根因：地图侧（第二十七轮 `_guideMarkerIcon`）是三级优先：点位级 → 攻略级 → 分类默认；
 *       详情页只看**攻略级**（`favicon.of(guide,'guide')`），连默认值都不一样
 *       （详情页默认红山岳、地图默认按分类走）→ 两边天然对不上。
 *
 * 优先级（与地图侧合并成同一份实现，改一处两边一起变）：
 *   ① 点位自己设了合法攻略符号 → 点位级整套（符号 + 颜色），谁最具体谁优先；
 *   ② 所属攻略设了 → 攻略级整套（同一篇攻略的点位统一成一个符号/颜色）；
 *   ③ 都没有 → 分类默认（圆 + 类别符号 + 分类色），由调用方把
 *      categories.markerIcon(category) 作为 fallbackMarker 传进来。
 *
 * @param {object} guide 所属攻略（可为 null）
 * @param {object} point 攻略点位（可为 null / 收藏副本）
 * @param {string} [fallbackMarker] 分类默认 marker 路径（③ 用）
 * @returns {{sym:string, colorIdx:number, marker:string, path:string,
 *            color:string, level:'point'|'guide'|'category'}}
 *          marker = 地图上画的那张（圆 + 符号）；path = 选择器里的纯符号缩略图
 */
function guideIconOf(guide, point, fallbackMarker) {
  const pairs = [
    { sym: point && point.favShape, ci: point && point.favColorIdx, level: 'point' },
    { sym: guide && guide.favShape, ci: guide && guide.favColorIdx, level: 'guide' }
  ];
  for (const it of pairs) {
    if (!it.sym || !isGuideShape(it.sym)) continue;
    const ci = (typeof it.ci === 'number' && it.ci >= 0 && it.ci < COLORS.length)
      ? it.ci : DEFAULT_GUIDE_SYM.colorIdx;
    return {
      sym: it.sym, colorIdx: ci, level: it.level,
      marker: guideMarkerPath(it.sym, ci),
      path: guidePath(it.sym, ci),
      color: color(ci)
    };
  }
  // ③ 分类默认：把 marker 文件名反解成「符号 + 语义色号」，
  //   选择器打开时才能高亮到对应的色点（否则「看到灰圆、色板却停在黄色」）。
  const m = String(fallbackMarker || '');
  const mm = m.match(/marker-([a-z]+)-(\d+)-big\.png/);
  let sym = DEFAULT_GUIDE_SYM.sym;
  let ci = DEFAULT_GUIDE_SYM.colorIdx;
  if (mm && isGuideShape(mm[1])) {
    sym = mm[1];
    const got = colorIdxOfMarker(Number(mm[2]));
    // 分类里有些色（如「其他」的石板灰）不在 8 色语义板里 → 回落到 0，
    // 但 marker 仍然用真正的分类图，保证「看到的」永远是真的。
    ci = (got >= 0 && got < COLORS.length) ? got : 0;
  }
  return {
    sym: sym, colorIdx: ci, level: 'category',
    marker: m || guideMarkerPath(sym, ci),
    path: guidePath(sym, ci),
    color: color(ci)
  };
}

/**
 * 颜色值（给行头小圆点用） */
function color(colorIdx) {
  return COLORS[colorIdx] || COLORS[0];
}

/**
 * 从一条记录里解析出收藏图标配置
 *
 * 两套体系严格分开（第二十二轮，用户明确）：
 *   kind='point' → 返回 { shape, colorIdx, path, color }，「收藏语义」形状
 *   kind='guide' → 返回 { shape, colorIdx, path, color }，其中
 *                  shape 存的是**攻略符号 key**（mountain/bowl/…），
 *                  path 指向 sym-{sym}-{i}.png。字段名保持 shape 不变，
 *                  以免调用方（pointedit / favorites）大改。
 *
 * 历史数据兼容：老攻略记录里 favShape 可能是 'star'（当时与点位收藏共用一套），
 * 这时降级为默认符号 'mountain'，避免裂图。
 *
 * @param {object} rec 记录（收藏点 / 攻略）
 * @param {'point'|'guide'} kind 默认值取向
 */
function of(rec, kind) {
  const r = rec || {};
  if (kind === 'guide') {
    const sym = isGuideShape(r.favShape) ? r.favShape : DEFAULT_GUIDE_SYM.sym;
    const colorIdx = (typeof r.favColorIdx === 'number') ? r.favColorIdx : DEFAULT_GUIDE_SYM.colorIdx;
    return { shape: sym, colorIdx, path: guidePath(sym, colorIdx), color: color(colorIdx) };
  }
  const def = DEFAULT_POINT;
  const shape = isShape(r.favShape) ? r.favShape : def.shape;
  const colorIdx = (typeof r.favColorIdx === 'number') ? r.favColorIdx : def.colorIdx;
  return { shape, colorIdx, path: path(shape, colorIdx), color: color(colorIdx) };
}

/**
 * ★★ 第三十九轮：唯一对外显示解析器 ★★
 *
 * 用户诉求：「点位名称旁边的那个标点，要和地图上的标点一致。所有。」
 *  → 地图 / 列表行 / 编辑页 / 详情页的图标**必须是同一张 PNG**。
 *  → 所以全 App 只允许通过本函数拿显示图，不许各处自行拼文件名。
 *
 * 三态（与 mapPinPath 完全一致，本函数只是把它推广到「缩略图场景」）：
 *   ① 只在攻略（isFav 假）→ 圆 + 符号：marker-{sym}-{mci}-big.png
 *   ② 只在收藏（isFav 真、在攻略中不存在）→ 纯形状：
 *        · 星形 → star-{ci}-big.png      （fav-star-*.png 不存在，走 marker 库）
 *        · 其它 → favpin-{shape}-{ci}.png
 *   ③ 两边都有 → 形状 + 外圈圆环：
 *        · 星形 → star-ring-{ci}-big.png
 *        · 其它 → ring-{shape}-{ci}.png
 *
 * kind='point' 时 rec 用 favShape/favColorIdx（收集点自身的形状）；
 * kind='guide' 时 rec 用 favShape(符号key)/favColorIdx（攻略的符号与颜色）。
 *
 * ★ opts.state 可显式指定三态（'point'|'guide'|'both'|'none'），
 *   优先级最高 —— 地图弹窗的星按钮要用它：
 *     · 'none'  → 灰色描边星（这一个点位什么都没收藏）
 *     · 'guide' → 灰色描边星（只是攻略里的点，本体未收藏）
 *     · 'point' → 该点位收藏的真实形状
 *     · 'both'  → 形状 + 圆环
 *   不传 state 时按 kind/isFav/isCommon 推（列表/详情页的常规用法）。
 *
 * @param {object} rec 收藏点 / 攻略记录
 * @param {{kind?:'point'|'guide', isFav?:boolean, isCommon?:boolean, state?:string}} opts
 * @returns {{path:string, marker:string, shape:string, colorIdx:number, color:string, ring:boolean, state:'guide'|'point'|'both'|'none'}}
 */
function display(rec, opts) {
  const o = opts || {};
  const kind = o.kind === 'guide' ? 'guide' : 'point';

  // 显式 state 优先
  let state = o.state;
  if (state !== 'point' && state !== 'guide' && state !== 'both' && state !== 'none') state = '';

  // 未收藏（无论哪种表述）→ 统一返回灰星，不给彩色形状误导
  const favUnknown = (state === 'none' || state === 'guide');
  if (favUnknown) {
    return {
      path: STAR_LINE_GRAY, marker: STAR_LINE_GRAY, shape: 'star', colorIdx: -1,
      color: '#94A3B8', ring: false, state: state || 'none'
    };
  }

  const isFav = state ? true : ((kind === 'point') ? true : !!o.isFav);
  const isCommon = state === 'both' ? true : !!o.isCommon;
  const ic = of(rec, kind);
  const colorHex = color(ic.colorIdx);

  if (!isFav) {
    // ① 只在攻略：圆 + 符号
    const p = guideMarkerPath(ic.shape, ic.colorIdx);
    return { path: p, marker: p, shape: ic.shape, colorIdx: ic.colorIdx, color: colorHex, ring: false, state: 'guide' };
  }

  // ② / ③ 已收藏：形状（+ 可选圆环）
  const p = mapPinPath(rec, isCommon, ic.colorIdx);
  return {
    path: p, marker: p, shape: ic.shape, colorIdx: ic.colorIdx, color: colorHex,
    ring: isCommon, state: isCommon ? 'both' : 'point'
  };
}

export default {
  SHAPES, GUIDE_SHAPES, COLORS, DEFAULT_POINT, DEFAULT_GUIDE, DEFAULT_GUIDE_SYM,
  MARKER_CI_BY_COLOR, MARKER_CI_EXTRA, STAR_GRAY, STAR_LINE_GRAY,
  path, guidePath, markerPath, markerOf, mapPinPath, color, of, isShape, isGuideShape,
  markerColorIdx, colorIdxOfMarker, guideMarkerPath, display, guideIconOf
};
