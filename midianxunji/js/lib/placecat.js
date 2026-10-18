/**
 * placecat.js —— 点位分类的**唯一判据**（★ 第六十九轮抽出）
 *
 * 为什么单独抽一个模块：
 *   以前「按名字猜分类」的规则只写在 localparse.js 里，只有**自由文本解析**那条路会用它；
 *   而模板（热门攻略 / 首页选现成行程）是**预置好**的点位，从来不走解析 → category 为空
 *   → guides.normalizePoint 兜底成 'qita'（其他）→ 地图上变成**灰色圆点**。
 *   现在把判据抽到这里，解析链路与模板链路共用同一份规则，图标自然统一。
 *
 * 返回值为 categories.js 的分类 key：
 *   'jingdian' 景点（绿·山岳）  'meishi' 美食（橙·碗）  'zhusu' 住宿（蓝·房子）
 *   —— 故意**不会**返回 'qita'（其他=灰），保证攻略点位不会是灰图标。
 *
 * ⚠ 判据顺序（实测定）：住宿 / 美食要**先于**自然景观判，
 *   否则「山间民宿」会因为带「山」字被误判成景点 —— 别调换顺序。
 */

/** 按名字猜分类（猜不准一律「景点」——攻略里的点绝大多数本就是景点） */
function guessCategory(name) {
  const s = String(name || '');
  if (/酒店|宾馆|民宿|客栈|青旅|营地|住宿|度假村/.test(s)) return 'zhusu';
  // 注意：「街/巷」不判美食 —— 宽窄巷子、锦里古街都是景点，判成美食会误导
  if (/小吃|美食|餐厅|火锅|串串|烧烤|咖啡|茶馆|菜市场|夜市|面馆|饭庄|食府|店$/.test(s)) return 'meishi';
  if (/寺|庙|观|宫|塔|古城|古镇|古村|遗址|博物馆|纪念馆|故居|书院|石窟|陵|祠/.test(s)) return 'jingdian';
  if (/山|峰|湖|海|江|河|谷|沟|峡|瀑|泉|草原|森林|湿地|岛|溪|崖|沙|岩|林/.test(s)) return 'jingdian';
  return 'jingdian';
}

/** 分类 key → 中文名（给富文本/提示用） */
const LABEL = { jingdian: '景点', meishi: '美食', zhusu: '住宿', qita: '其他' };
function categoryLabel(key) { return LABEL[key] || LABEL.qita; }

export default { guessCategory, categoryLabel, LABEL };
