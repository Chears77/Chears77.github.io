/**
 * templates.js —— 离线攻略模板库（★ 第五十四轮新增）
 *
 * 为什么要有它：云开发（云函数 / 云数据库）到期要收费，本版已整体下线。
 * 随之出现的真空是——「整理攻略」原本靠云端的生成服务写，现在没后端了；
 * 而让每个用户自己去申请外部服务 Key 才能用，门槛太高，等于功能没了。
 *
 * 所以这里内置一批**离线行程模板**：
 *   · 全是真实存在的地名（景区 / 古镇 / 山峰 / 湖泊 / 寺院 / 街道）；
 *   · 按天分组，格式与本地解析引擎（utils/localparse.js）完全对齐；
 *   · 选一个 → 拼成攻略文本 → 走同一条解析链路 → 定位上地图。
 *
 * 成本：模板本身**零网络**（纯字符串），只有「地名 → 坐标」这一步走腾讯位置服务
 *       （有免费额度，和 <map> 同坐标系）。用户不填任何 Key 也能完整跑通。
 *
 * 与生成通道的关系（首页「整理攻略」弹层里二选一）：
 *   · 没填 Key → 只能走这里（免费、稳定、可预期）；
 *   · 填了 Key → 写出行安排那条仍在，适合「新疆8日自驾」这类模板里没有的个性化需求。
 *
 * ⚠ 维护约定：
 *   1. lines 里每行只放**纯地名**，用顿号分隔。不要写描述句——
 *      解析引擎是按顿号切句的，混进描述会被当成地名。
 *   2. 结尾的「提示」行故意含「建议 / 注意 / 门票」等停用词，
 *      保证被 localparse 的 STOP 词表过滤掉，不会混进点位。
 *   3. 新增模板时天数要和 lines.length 一致。
 */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 第六十九轮：地名→坐标烘焙表（tools/_bake_template_coords.js 自动生成）。
 *  有它以后，模板落位**全程零网络**——不再逐地名调腾讯/高德查坐标。 */
import COORDS from './template_coords.js';
/** 第六十九轮：分类判据与解析链路共用同一份（否则模板点位会全落「其他」→ 灰图标） */
import placecat from './placecat.js';
/** 模板清单：id / 名称 / 天数 / 标签 / 逐天地名 */
const LIST = [
  {
    id: 'chengdu', name: '成都', days: 3, tag: '美食 · 熊猫',
    lines: [
      '宽窄巷子、武侯祠、锦里古街、杜甫草堂',
      '大熊猫繁育研究基地、都江堰景区、青城山',
      '春熙路、太古里、人民公园、望江楼公园'
    ]
  },
  {
    id: 'chongqing', name: '重庆', days: 3, tag: '夜景 · 山城',
    lines: [
      '洪崖洞、解放碑、长江索道、李子坝轻轨站',
      '磁器口古镇、南山一棵树、鹅岭公园',
      '武隆天生三桥、大足石刻'
    ]
  },
  {
    id: 'xian', name: '西安', days: 3, tag: '古迹 · 历史',
    lines: [
      '秦始皇兵马俑、华清宫、骊山',
      '大雁塔、大唐不夜城、陕西历史博物馆',
      '西安城墙、回民街、钟鼓楼'
    ]
  },
  {
    id: 'chuanxi', name: '川西', days: 4, tag: '高原 · 自驾',
    lines: [
      '四姑娘山、巴郎山、卧龙自然保护区',
      '丹巴甲居藏寨、塔公草原、新都桥',
      '海螺沟、折多山、康定古城',
      '稻城亚丁、牛奶海、五色海'
    ]
  },
  {
    id: 'yunnan', name: '云南', days: 5, tag: '风花雪月',
    lines: [
      '石林风景区、滇池、翠湖公园',
      '大理古城、崇圣寺三塔、双廊古镇',
      '洱海、喜洲古镇、苍山',
      '丽江古城、束河古镇、黑龙潭公园',
      '玉龙雪山、蓝月谷、泸沽湖'
    ]
  },
  {
    id: 'xizang', name: '西藏', days: 5, tag: '高原 · 信仰',
    lines: [
      '布达拉宫、大昭寺、八廓街',
      '纳木错、羊卓雍措、卡若拉冰川',
      '扎什伦布寺、日喀则、珠峰大本营',
      '巴松措、鲁朗林海、雅鲁藏布大峡谷',
      '哲蚌寺、色拉寺、药王山'
    ]
  },
  {
    id: 'xiamen', name: '厦门', days: 3, tag: '海岛 · 文艺',
    lines: [
      '鼓浪屿、日光岩、菽庄花园',
      '南普陀寺、厦门大学、胡里山炮台',
      '曾厝垵、环岛路、集美学村'
    ]
  },
  {
    id: 'qingdao', name: '青岛', days: 3, tag: '海滨 · 啤酒',
    lines: [
      '栈桥、小青岛、小鱼山',
      '八大关、五四广场、青岛啤酒博物馆',
      '崂山风景区、金沙滩、信号山公园'
    ]
  },
  {
    id: 'hangzhou', name: '杭州', days: 3, tag: '西湖 · 茶香',
    lines: [
      '西湖风景区、断桥残雪、雷峰塔',
      '灵隐寺、飞来峰、龙井村',
      '西溪湿地、千岛湖、宋城'
    ]
  },
  {
    id: 'beijing', name: '北京', days: 4, tag: '首都 · 名胜',
    lines: [
      '天安门广场、故宫博物院、景山公园',
      '八达岭长城、明十三陵、奥林匹克公园',
      '颐和园、圆明园、香山公园',
      '天坛公园、南锣鼓巷、什刹海'
    ]
  },
  {
    id: 'guilin', name: '桂林', days: 3, tag: '山水 · 漓江',
    lines: [
      '象鼻山、靖江王府、两江四湖',
      '漓江、兴坪古镇、九马画山',
      '阳朔西街、遇龙河、龙脊梯田'
    ]
  },
  {
    id: 'sanya', name: '三亚', days: 3, tag: '海岛 · 度假',
    lines: [
      '亚龙湾、亚龙湾热带天堂森林公园',
      '蜈支洲岛、海棠湾、后海村',
      '天涯海角、南山寺、大小洞天'
    ]
  },
  {
    id: 'zhangjiajie', name: '张家界', days: 3, tag: '奇峰 · 玻璃栈道',
    lines: [
      '张家界国家森林公园、袁家界、金鞭溪',
      '天门山、玻璃栈道、天门洞',
      '凤凰古城、芙蓉镇、黄龙洞'
    ]
  },
  {
    id: 'xinjiang', name: '新疆', days: 5, tag: '草原 · 湖泊',
    lines: [
      '天山天池、吐鲁番火焰山、葡萄沟',
      '喀纳斯湖、禾木村、白哈巴村',
      '赛里木湖、果子沟大桥、霍尔果斯口岸',
      '那拉提草原、巴音布鲁克、独库公路',
      '魔鬼城、五彩滩、布尔津'
    ]
  },
  {
    id: 'guizhou', name: '贵州', days: 4, tag: '瀑布 · 苗寨',
    lines: [
      '黄果树瀑布、陡坡塘瀑布、天星桥',
      '荔波小七孔、大七孔、鸳鸯湖',
      '西江千户苗寨、朗德上寨、镇远古城',
      '梵净山、青岩古镇、甲秀楼'
    ]
  },
  {
    id: 'xibei', name: '西北大环线', days: 4, tag: '丹霞 · 青海湖',
    lines: [
      '莫高窟、鸣沙山月牙泉、敦煌古城',
      '张掖丹霞地貌、嘉峪关关城、七彩镇',
      '茶卡盐湖、青海湖、塔尔寺',
      '坎布拉森林公园、贵德黄河、互助土族故土园'
    ]
  },
  {
    id: 'shanghai', name: '上海', days: 3, tag: '都市 · 外滩',
    lines: [
      '外滩、南京路步行街、东方明珠',
      '豫园、城隍庙、田子坊',
      '上海迪士尼乐园、朱家角古镇、武康路'
    ]
  },
  {
    id: 'nanjiang', name: '苏杭', days: 3, tag: '园林 · 水乡',
    lines: [
      '拙政园、狮子林、苏州博物馆',
      '虎丘、平江路、周庄古镇',
      '乌镇、西塘古镇、南浔古镇'
    ]
  },
  {
    id: 'nanjing', name: '南京', days: 3, tag: '六朝古都',
    lines: [
      '中山陵、明孝陵、音乐台',
      '夫子庙、秦淮河、中华门',
      '总统府、南京博物院、鸡鸣寺、玄武湖'
    ]
  },
  {
    id: 'taishan', name: '山东泰安', days: 3, tag: '名山 · 泉城',
    lines: [
      '泰山、岱庙、红门宫',
      '十八盘、南天门、玉皇顶',
      '趵突泉、大明湖、千佛山'
    ]
  }
];

/** 结尾的通用提示行：含停用词，保证不会被误判成地名 */
const TAIL_TIP = '提示：建议出发前查一下各景区开放时间，注意山区天气变化，热门景点门票最好提前预约。';

/** 把 lines 拼成可被 localparse 直接解析的攻略正文 */
function buildText(t) {
  const title = t.name + t.days + '日行程';
  const days = t.lines.map((line, i) => {
    const n = CN_NUM[i] || String(i + 1);
    return '第' + n + '天：' + line;
  });
  return [title].concat(days).join('\n\n') + '\n\n' + TAIL_TIP;
}

/** 第六十八轮：展示用标题「成都三日游」（中文数字，不再出现「成都3日行程」这种生硬写法） */
function tripTitle(t) {
  const n = CN_NUM[(t.days || 1) - 1] || String(t.days || '');
  return (t.name || '') + n + '日游';
}

/** 第六十八轮：这篇模板共多少个点位（按顿号切地名计数），热门卡片直接展示 */
function pointCount(t) {
  return (t.lines || []).reduce((n, line) => {
    return n + String(line || '').split('、').filter(s => s.trim()).length;
  }, 0);
}

/** 坐标取值：兼容精简表 [lat,lng] 与对象 {lat,lng} 两种写法 */
function _coord(name) {
  const c = COORDS[name];
  if (!c) return null;
  const lat = Array.isArray(c) ? c[0] : c.lat;
  const lng = Array.isArray(c) ? c[1] : c.lng;
  return (lat && lng) ? { lat, lng } : null;
}

/**
 * 第六十九轮：把模板**直接展开**成点位数组（用烘焙坐标，零网络）。
 *   · 每个地名 → {name, category, group='第N天', lat/lng 取自 COORDS}；
 *   · category 走与解析链路同一份判据（placecat.guessCategory）→ 图标统一为
 *     景点（绿·山岳）/ 美食（橙·碗）/ 住宿（蓝·房子），**不会是灰点**；
 *   · 缺坐标的地名 → located:false（调用方会走实时 geosearch 兜底，见 fullyBaked）。
 */
function pointsOf(id) {
  const t = get(id);
  if (!t) return [];
  const pts = [];
  (t.lines || []).forEach((line, i) => {
    const group = '第' + (CN_NUM[i] || String(i + 1)) + '天';
    String(line).split('、').forEach((raw) => {
      const nm = raw.trim();
      if (!nm) return;
      const c = _coord(nm);
      pts.push({
        name: nm, category: placecat.guessCategory(nm), group, section: group, primary: true,
        reason: '', quote: '', imageUrls: [], colorOverride: '',
        latitude: c ? c.lat : 0, longitude: c ? c.lng : 0, located: !!c
      });
    });
  });
  return pts;
}

/** 这篇模板是不是**全部**地名都有烘焙坐标（true 才能零网络直出） */
function fullyBaked(id) {
  const t = get(id);
  if (!t) return false;
  let all = true;
  (t.lines || []).forEach((line) => {
    String(line).split('、').forEach((raw) => {
      const nm = raw.trim();
      if (nm && !_coord(nm)) all = false;
    });
  });
  return all;
}

/** 点位质心（做 routeCenter，让地图有个合理初始中心） */
function centerOf(pts) {
  const ok = (pts || []).filter((p) => p.latitude && p.longitude);
  if (!ok.length) return null;
  let la = 0, lo = 0;
  ok.forEach((p) => { la += p.latitude; lo += p.longitude; });
  return { latitude: la / ok.length, longitude: lo / ok.length };
}

/** 全部模板（给页面渲染列表用） */
function list() {
  return LIST.map(t => ({
    id: t.id,
    name: t.name,
    days: t.days,
    tag: t.tag || '',
    title: t.name + t.days + '日行程',
    tripTitle: tripTitle(t),
    count: pointCount(t)
  }));
}

/** 按 id 取一个模板的完整攻略文本；没有就返回空串 */
function textOf(id) {
  const t = LIST.filter(x => x.id === id)[0];
  return t ? buildText(t) : '';
}

/** 按 id 取模板元信息 */
function get(id) {
  return LIST.filter(x => x.id === id)[0] || null;
}

/** 按关键词搜模板（搜索框用） */
function search(kw) {
  const k = String(kw || '').trim();
  if (!k) return list();
  return list().filter(t =>
    t.name.indexOf(k) >= 0 || (t.tag || '').indexOf(k) >= 0 || t.title.indexOf(k) >= 0
  );
}

export default { list, get, textOf, search, buildText, tripTitle, pointCount, pointsOf, fullyBaked, centerOf };
