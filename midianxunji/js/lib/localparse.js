/**
 * localparse.js —— 本地攻略解析引擎（★ 第五十三轮新增）
 *
 * 为什么要有它：本地版没有远程服务了，「粘贴一段攻略 → 出点位」这条主链路
 * 必须能在手机上自己跑完。所以这里写一套**纯前端规则引擎**：
 *
 *   正文 → 切句 → 挑出像地名的片段 → 去重排序 → 逐个用腾讯位置服务查坐标
 *
 * 定位（地名→经纬度）仍然要联网——手机上不可能内置全国 POI 库，
 * 但走的是腾讯位置服务 WebService（有免费额度，且和 <map> 同坐标系 GCJ-02，不偏移）。
 * 查不到坐标的点位照样保留、标成「未定位」，用户可在编辑页手动选点补上。
 *
 * 若用户在「我的 → 服务与 Key 设置」里填了自己的模型 Key，会先用模型摘一遍地点（更准），
 * 模型不可用或没填 Key 时自动回退到本文件的规则，任何情况下都不会卡住主流程。
 */
import qqmap from './qqmap.js';
import geosearch from './geosearch.js';
import config from './config.js';
import llm from './llm.js';
import placecat from './placecat.js';
/* ================= 词表 ================= */

/** 地名后缀：命中它基本可以断定是个地方 */
const SUFFIX = [
  '景区', '风景区', '景点', '地质公园', '国家公园', '森林公园', '湿地公园', '主题公园',
  '公园', '古镇', '古村', '古城', '古街', '老街', '步行街', '商业街', '文化街',
  '博物馆', '美术馆', '纪念馆', '展览馆', '图书馆', '科技馆', '规划馆',
  '遗址', '遗迹', '石窟', '石刻', '故居', '王府', '皇宫', '陵园', '墓',
  '寺', '寺庙', '庙', '观', '宫', '庵', '教堂', '清真寺',
  '山', '峰', '雪山', '冰川', '垭口', '峡谷', '峡', '谷', '沟', '崖', '岩', '洞',
  '湖', '海', '江', '河', '溪', '泉', '温泉', '瀑布', '湿地', '草原', '草甸', '森林',
  '岛', '半岛', '半岛', '沙滩', '海滩', '湾',
  '广场', '中心', '塔', '桥', '码头', '港口', '机场', '车站', '服务区', '观景台',
  '大学', '学院', '书院', '营地', '牧场', '梯田', '茶园', '庄园', '农庄',
  '村', '寨', '镇', '乡', '县', '区', '城', '堡', '关', '园', '巷'
];

/** 出发/到达类动词：后面紧跟的多半是地名 */
const VERBS = ['前往', '去', '到', '抵达', '到达', '游览', '游玩', '参观', '打卡', '逛', '爬', '登', '看', '游览完', '路过', '绕道', '徒步', '骑行'];

/**
 * 口语动词（实测补）：这些词开头的片段不是地名本身。
 * 例：「逛老院子」「看夜景」「吃火锅」—— 保留原句没意义，
 *     剥离动词后再判断，剥完还是噪声就被后缀/泛指词表挡掉。
 */
const LEAD_VERBS = ['前往', '抵达', '到达', '游览', '游玩', '参观', '打卡', '路过', '绕道', '徒步', '骑行',
  '逛', '爬', '登', '看', '去', '到', '吃', '买', '玩', '住', '拍', '走'];

/** 泛指名词（实测补）：命中就不是具体地点 —— 「老院子」「房间」「门口」这类 */
const GENERIC = ['院子', '地方', '里面', '旁边', '附近', '周边', '对面', '门口', '房间', '楼上', '楼下',
  '前面', '后面', '上面', '下面', '中间', '一带', '一带', '区域', '片区'];

/** 说明性文字：命中就直接扔掉（这些不是地名） */
const STOP = [
  '门票', '开放时间', '营业', '小时', '分钟', '公里', 'km', 'km', '米', '元', '免费', '预约', '预订', '订票',
  '建议', '注意', '提醒', '提前', '最好', '最佳', '旺季', '淡季', '人少', '人多', '排队',
  '住宿', '酒店', '民宿', '客栈', '青旅', '房', '入住', '退房',
  '美食', '餐厅', '吃饭', '小吃', '早饭', '午饭', '晚饭', '早餐', '午餐', '晚餐', '味道', '价格', '人均',
  '交通', '打车', '公交', '地铁', '自驾', '包车', '拼车', '停车', '路况', '限速', '加油',
  '路线', '行程', '攻略', '介绍', '总结', 'tips', 'Tips', 'TIPS', '小结', '结语', '直达',
  '天气', '气温', '海拔', '高反', '防晒', '装备', '行李', '准备', '出发', '返程', '回家',
  '个人', '我们', '大家', '小伙伴', '朋友', '孩子', '老人', '适合', '推荐理由',
  '第一天', '第二天', '第三天', '第四天', '第五天', '第六天', '第七天',
  '上午', '中午', '下午', '晚上', '傍晚', '清晨', '凌晨', '早上'
];

/** 段落小标题：用来给点位分组（第几天 / 上午下午） */
const GROUP_RE = /^\s*(?:第\s*([一二三四五六七八九十\d]+)\s*[天日]|day\s*(\d+)|D(\d+)|(上午|中午|下午|晚上|傍晚))[\s:：、,，.。-]*/i;

const MAX_POINTS = 30;

/* ================= 区域推断（第六十一轮） =================
 * 本地版没有远程服务兜底，腾讯地点搜索默认全国范围时，
 * 「故宫」「祈年殿」这种常见地名会被同名点带偏（沈阳故宫、长春天坛）。
 * 所以从标题+正文里先抓一个主区域，搜坐标时优先按这个区域约束；
 * 区域里找不到再 fallback 全国。
 */

/** 省级 / 直辖市 / 自治区（用于区域约束） */
const PROVINCES = ['北京','上海','天津','重庆','河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆','香港','澳门'];

/** 主要城市：如果正文里明确提到城市，优先用城市（比省更准） */
const CITIES = ['成都','杭州','武汉','西安','南京','广州','深圳','苏州','长沙','青岛','厦门','昆明','贵阳','郑州','沈阳','大连','哈尔滨','长春','济南','合肥','福州','南昌','石家庄','太原','呼和浩特','乌鲁木齐','拉萨','南宁','兰州','银川','西宁','三亚','海口','宁波','无锡','佛山','温州','东莞','常州','烟台','泉州','唐山','徐州','洛阳','芜湖','绍兴','珠海','桂林','遵义','咸阳','宜宾','赣州','荆州','岳阳','襄阳','保定','潍坊','临沂','嘉兴','台州','金华','惠州','中山','江门','湛江','廊坊','邢台','沧州','衡水','张家口','承德','秦皇岛','通辽','呼伦贝尔','包头','鄂尔多斯','赤峰','锡林郭勒','乌兰察布','巴彦淖尔','阿拉善','兴安','乌海','海拉尔','满洲里','齐齐哈尔','牡丹江','佳木斯','大庆','绥化','鸡西','双鸭山','伊春','七台河','黑河','鹤岗','大兴安岭','鞍山','抚顺','本溪','丹东','锦州','营口','阜新','辽阳','盘锦','铁岭','朝阳','葫芦岛','四平','辽源','通化','白山','松原','白城','延边','吉林','盐城','扬州','镇江','泰州','宿迁','淮安','连云港','徐州','南通','常州','昆山','江阴','张家港','常熟','太仓','宜兴','溧阳','丹阳','义乌','慈溪','余姚','诸暨','海宁','桐乡','平湖','嘉善','海盐','德清','安吉','长兴','嵊州','新昌','上虞','柯桥','萧山','富阳','临安','桐庐','建德','淳安','奉化','宁海','象山','慈溪','瑞安','乐清','永嘉','洞头','平阳','苍南','文成','泰顺','龙港','嵊泗','岱山','普陀','定海','椒江','黄岩','路桥','临海','温岭','玉环','天台','仙居','三门','江山','龙游','常山','开化','衢江','柯城','莲都','龙泉','青田','云和','庆元','缙云','遂昌','松阳','景宁','莲都','婺城','金东','兰溪','东阳','永康','武义','浦江','磐安','越城','柯桥','上虞','新昌','诸暨','嵊州','金塘','六横','桃花','普陀山','朱家尖','定海','新城','高新区','天府新区','双流','郫都','新都','温江','龙泉驿','青白江','都江堰','彭州','邛崃','崇州','简阳','大邑','蒲江','新津','金堂','青羊','锦江','成华','金牛','武侯','高新','高新南','高新西','天府新','锦江','青羊','金牛','武侯','成华','龙泉驿','青白江','新都','温江','双流','郫都','新津','都江堰','彭州','邛崃','崇州','简阳','大邑','蒲江','金堂','高新区','天府新区','东部新区','眉山','乐山','德阳','绵阳','南充','达州','宜宾','内江','自贡','泸州','攀枝花','广元','遂宁','巴中','资阳','雅安','广安','凉山','阿坝','甘孜','西昌','康定','马尔康','九寨沟','稻城亚丁','色达','理塘','巴塘','新都桥','塔公草原','丹巴','小金','金川','壤塘','阿坝县','若尔盖','红原','松潘','茂县','汶川','理县','黑水','马尔康','金川','壤塘','阿坝县','若尔盖','红原','松潘','茂县','汶川','理县','黑水','马尔康','甘孜县','石渠','德格','白玉','新龙','炉霍','道孚','色达','理塘','巴塘','乡城','稻城','得荣','九龙','雅江','康定','泸定','丹巴','九龙','雅江','巴塘','乡城','稻城','得荣','理塘','石渠','德格','白玉','新龙','炉霍','道孚','色达','甘孜县','色达县','新龙县','炉霍县','道孚县','甘孜','康定','泸定','丹巴','九龙','雅江','巴塘','乡城','稻城','得荣','理塘','石渠','德格','白玉','新龙','炉霍','道孚','色达','甘孜县','色达县','新龙县','炉霍县','道孚县','甘孜'];

/** 跨区域路线/特殊区域：不能用单一城市约束，但可以给出默认视野中心 */
const ROUTES = {
  '川藏线': { hint: '川藏线为跨区域路线，已用全国搜索', center: { latitude: 30.5, longitude: 102.0 } },
  '川藏': { hint: '川藏线为跨区域路线，已用全国搜索', center: { latitude: 30.5, longitude: 102.0 } },
  '川西': { hint: '川西为区域路线，已用省内搜索', center: { latitude: 31.0, longitude: 102.0 } },
  '318': { hint: 'G318 为跨区域路线，已用全国搜索', center: { latitude: 30.5, longitude: 102.0 } },
  '青藏线': { hint: '青藏线为跨区域路线，已用全国搜索', center: { latitude: 33.0, longitude: 92.0 } },
  '滇藏线': { hint: '滇藏线为跨区域路线，已用全国搜索', center: { latitude: 27.0, longitude: 99.0 } },
  '新藏线': { hint: '新藏线为跨区域路线，已用全国搜索', center: { latitude: 32.0, longitude: 84.0 } }
};

/**
 * 从标题+正文推断主区域。
 * 优先序：① 特殊路线；② 城市名；③ 省/直辖市/自治区名。
 * @returns {{name:string, type:string, center?:object, hint?:string}|null}
 */
function inferRegion(text) {
  const s = String(text || '');
  if (!s) return null;
  // 先判特殊路线：避免把「川藏线」里的「四川」当城市约束
  for (const k of Object.keys(ROUTES)) {
    if (s.indexOf(k) >= 0) return Object.assign({ name: k, type: 'route' }, ROUTES[k]);
  }
  // 城市名（更细）优先于省名
  for (const c of CITIES) {
    if (s.indexOf(c) >= 0) return { name: c, type: 'city' };
  }
  for (const p of PROVINCES) {
    if (s.indexOf(p) >= 0) return { name: p, type: 'province' };
  }
  return null;
}

/* ================= 工具 ================= */

function hasSuffix(s) {
  for (const suf of SUFFIX) {
    if (s.length > suf.length && s.slice(-suf.length) === suf) return true;
  }
  return false;
}

function isStop(s) {
  for (const w of STOP) {
    if (s.indexOf(w) >= 0) return true;
  }
  return false;
}

/** 丢掉行首的序号 / 项目符号 */
function stripBullet(line) {
  return String(line || '')
    .replace(/^\s*\d{1,2}\s*[.、)）]\s*/, '')
    .replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
    .replace(/^\s*[-—*•·]+\s*/, '')
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .trim();
}

/** 书名号里的地名（《xx》几乎一定是重点地点） */
function pickBrackets(line) {
  const out = [];
  const re = /[《【]([^》】]{2,20})[》】]/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1].trim());
  return out;
}

/** 动词后的名词碎片：「从成都出发前往四姑娘山」→ 四姑娘山 */
function pickAfterVerb(seg) {
  const out = [];
  for (const v of VERBS) {
    const i = seg.indexOf(v);
    if (i < 0) continue;
    const tail = seg.slice(i + v.length).replace(/^[的了\s]+/, '');
    // 取动词后面连续的一小段（遇到标点就停）
    const m = tail.match(/^[\u4e00-\u9fa5A-Za-z0-9]{2,15}/);
    if (m) out.push(m[0]);
  }
  return out;
}

/**
 * 一条片段是否「像地名」：
 *   ① 带地点后缀（宽窄巷子 / 四姑娘山）；
 *   ② 长度 2~10、不含停用词与泛指词、且不以口语动词开头（短小精悍的独立短句多半就是地名）；
 *   ③ 出现在动词之后。
 */
function looksLikePlace(s) {
  if (!s) return false;
  if (s.length < 2 || s.length > 20) return false;
  if (isStop(s)) return false;
  if (/^[\d\s.、,，:：\-—]+$/.test(s)) return false;      // 纯标点/数字（「——」这类）
  if (hasGeneric(s)) return false;                       // 泛指名词（老院子 / 门口）
  if (hasSuffix(s)) return true;
  // 短句里含口语虚词的大概率不是地名（「很好看」「太多了」）。
  // ★ 第五十四轮：**去掉了「太」** —— 「太古里 / 太湖 / 太行山 / 太白山」全是常见地名，
  //   把「太」当虚词会让它们整批消失（实测成都模板丢了「太古里」）。
  //   「太贵」「太远」这类噪声本身极少独立成段，代价远小于漏掉真实地名。
  if (s.length >= 2 && s.length <= 10 && !/[的了和与或就还再很]/.test(s)) return true;
  return false;
}

/** 泛指名词命中判断 */
function hasGeneric(s) {
  for (const w of GENERIC) {
    if (s.indexOf(w) >= 0) return true;
  }
  return false;
}

/** 剥掉开头的口语动词：「逛老院子」→「老院子」 */
function stripLeadVerb(s) {
  for (const v of LEAD_VERBS) {
    if (s.length > v.length && s.slice(0, v.length) === v) return s.slice(v.length);
  }
  return s;
}

/** 从一行里挑出候选地名 */
function pickFromLine(line) {
  const out = [];
  const br = pickBrackets(line);
  for (const b of br) if (looksLikePlace(b)) out.push(b);

  const body = stripBullet(line);
  if (!body) return out;

  // 先按分隔符切成小片段（★ 括号也算分隔：否则「武侯祠（门票 50 元…）」会整段命中
  // 停用词「门票」而被误杀 —— 实测出来的真 bug）
  const segs = body.split(/[、,，;；。!！?？\/|｜（）()【】\[\]「」『』\s]+/)
    .map(s => s.trim()).filter(Boolean);
  for (const seg of segs) {
    // 先剥口语动词再判（「前往青城山」→「青城山」）。
    // ★ 顺序很关键：反过来先判原串的话，「前往青城山」会因为有「山」字后缀直接过关，
    //   结果地图上多一个定位不到的假点位（实测定）。
    const peeled = stripLeadVerb(seg);
    if (peeled !== seg && looksLikePlace(peeled)) { out.push(peeled); continue; }
    if (looksLikePlace(seg)) { out.push(seg); continue; }
    for (const v of pickAfterVerb(seg)) if (looksLikePlace(v)) out.push(v);
  }
  return out;
}

/** 分组标题：第N天 / Day N / 上午 */
function groupOfLine(line) {
  const m = GROUP_RE.exec(line || '');
  if (!m) return '';
  if (m[1]) return '第' + m[1] + '天';
  if (m[2]) return 'Day' + m[2];
  if (m[3]) return 'D' + m[3];
  if (m[4]) return m[4];
  return '';
}

/** 攻略标题：取开头第一行非空、且不像正文长句的那行 */
function titleOf(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  const first = lines[0].replace(/^[#*\s]+/, '').replace(/[《》【】]/g, '').trim();
  if (!first) return '';
  if (first.length > 30) return first.slice(0, 30);
  return first;
}

/**
 * 剥掉行首的「第一天：」「Day2 」「下午：」这类分组前缀，返回剩下的正文。
 * 「第一天：青城山、都江堰」是攻略里最常见的写法，剥完剩下的才是真正要提取的内容。
 * @returns {string} 剥完后的正文；整行只有分组标题时返回空串
 */
function stripGroupPrefix(line) {
  const s = String(line || '');
  const m = GROUP_RE.exec(s);
  if (!m) return s.trim();
  return s.slice(m[0].length).trim();
}

/**
 * 规则提取：文本 → [{name, group}]
 * 保留了出现顺序（攻略顺序 = 行程顺序），去重后按 MAX_POINTS 截断。
 *
 * ★ 第五十四轮修复：以前遇到「第二天：青城山、都江堰」会**整行跳过**
 *   （只把它当分组标题），结果这一天的地名一个都提不出来 —— 而这恰恰是
 *   攻略里最常见的写法。现在改成：先记下分组，剥掉前缀后**继续从剩下的正文里提取**。
 *   只有整行确实只是个光秃秃的标题（「第一天」后面没有任何内容）才跳过。
 */
function extractByRule(text) {
  const lines = String(text || '').split(/\r?\n/);
  // 标题那一行不是点位（「成都三日游」本身不是个地方），整行跳过
  const title = titleOf(text);
  let group = '';
  const seen = {};
  const out = [];
  const collect = (body) => {
    for (const name of pickFromLine(body)) {
      if (seen[name]) continue;
      seen[name] = 1;
      out.push({ name, group });
      if (out.length >= MAX_POINTS) return false;
    }
    return true;
  };
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    if (title && line.replace(/^[#*\s]+/, '').replace(/[《》【】]/g, '').trim() === title) continue;
    const g = groupOfLine(line);
    if (g) {
      group = g;
      const rest = stripGroupPrefix(line);
      // 光秃秃的「第一天」：只是个分组标题，后面没内容可提
      if (!rest) continue;
      if (!collect(rest)) return out;
      continue;
    }
    if (!collect(line)) return out;
  }
  return out;
}

/* ================= 定位（腾讯位置服务） ================= */

/** 串行查坐标：一次一个，避免瞬间打爆配额
 *  @returns Promise<{ points:[...], quotaOut:boolean }>
 *  ★ 第六十轮：① 命中本机缓存不再等 60ms；② 撞到 121 立即停止后续请求
 *  ★ 第六十四轮：改走 geosearch（腾讯+高德双通道 + 多候选名 + 统一缓存）
 */
function locateAll(cands, region) {
  const limit = Math.min(cands.length, (config && config.maxLocate) || MAX_POINTS);
  const list = cands.slice(0, limit);
  const miss = (c) => ({ name: c.name, group: c.group, reason: c.reason || '', latitude: 0, longitude: 0, located: false });
  if (!qqmap.hasKey() && !geosearch.getAmapKey()) {
    return Promise.resolve({ points: list.map(miss), quotaOut: false });
  }

  const out = [];
  let i = 0;
  const step = () => {
    if (i >= list.length) return Promise.resolve({ points: out, quotaOut: false });
    const c = list[i++];
    return geosearch.search(c.name, region).then((r) => {
      // 双通道配额都耗尽：剩下全部记为未定位
      if (r && r.code === 121) {
        out.push(miss(c));
        while (i < list.length) out.push(miss(list[i++]));
        return Promise.resolve({ points: out, quotaOut: true });
      }
      const hit = (r && r.code === 0 && r.data && r.data.length) ? r.data[0] : null;
      out.push({
        name: c.name,
        group: c.group,
        reason: c.reason || '',
        latitude: hit ? hit.latitude : 0,
        longitude: hit ? hit.longitude : 0,
        located: !!(hit && hit.latitude && hit.longitude)
      });
      const wait = (r && r.cached) ? 0 : 60;
      return new Promise(res => setTimeout(res, wait)).then(step);
    }, () => {
      out.push(miss(c));
      return new Promise(res => setTimeout(res, 60)).then(step);
    });
  };
  return step();
}

/* ================= 对外：解析入口 ================= */

/**
 * @param {string} text 攻略正文
 * @returns {Promise<{code:number, data:{title, points}, message:string}>}
 *   points: [{name, category, group, reason, quote, latitude, longitude, located}]
 */
function parseText(text) {
  const raw = String(text || '').trim();
  if (!raw) return Promise.resolve({ code: 1003, message: '内容为空', data: null });

  const title = titleOf(raw);

  // ① 有 Key 就先让模型摘一遍，失败/没 Key 一律回退本地规则
  const pick = llm.ready()
    ? llm.extractPlaces(raw).catch(() => null)
    : Promise.resolve(null);

  return pick.then((ai) => {
    let cands = (ai && ai.length) ? ai.slice(0, MAX_POINTS) : extractByRule(raw);
    if (!cands.length) cands = extractByRule(raw);      // 模型给空 → 规则兜底
    // 标题行本身不是点位（「成都三日游」会被规则当成候选），同名剔除
    if (title) cands = cands.filter(c => c.name !== title);
    if (!cands.length) {
      return { code: 1004, message: '没有从内容里识别出地点', data: null };
    }
    // ⑥① 轮：从标题+正文推断主区域，让搜坐标时优先在区域内查找，避免同名点串到别的省
    const region = inferRegion(raw);
    return locateAll(cands, region).then((res) => {
      // 第六十轮：locateAll 现在回 {points, quotaOut}，兼容老的「直接给数组」写法
      const pts = Array.isArray(res) ? res : (res && res.points) || [];
      const quotaOut = Array.isArray(res) ? false : !!(res && res.quotaOut);
      return {
        code: 0,
        message: '',
        // quotaOut 由 index 页面读出来，换成「今日额度用完」的人话提示
        quotaOut,
        data: {
          title,
          regionHint: region ? region.hint : '',
          routeCenter: (region && region.type === 'route') ? region.center : null,
          points: pts.map((p, i) => ({
          name: p.name,
          category: guessCategory(p.name),
          group: p.group || '',
          section: p.group || '',
          primary: true,
          reason: p.reason || '',
          quote: '',
          latitude: p.latitude,
          longitude: p.longitude,
          located: p.located,
          order: i
        }))
      }
    };
  });
  });
}

/** 按名字猜分类（只猜三类，猜不准就「景点」，用户可在编辑页改）
 *  ★ 第六十九轮：规则抽到 utils/placecat.js —— 模板链路与解析链路共用同一份判据，
 *    保证「攻略生成的点位图标」在哪条路进来都一致。这里保留同名导出兼容旧调用点。
 */
function guessCategory(name) {
  return placecat.guessCategory(name);
}

export default { parseText, extractByRule, guessCategory, titleOf, MAX_POINTS };
