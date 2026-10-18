/**
 * regen.js —— 「重新标点位」（第十四轮新增）
 *
 * 攻略页 / 地图页的攻略弹层里都有这个入口：拿攻略原文重新跑一遍解析，
 * 把识别出的点位整份替换进这篇攻略。老点位里有坐标的，按名称匹配带过去，
 * 免得用户辛辛苦苦补的坐标全丢。
 */
import localparse from './localparse.js';
import guides from './guides.js';
/**
 * 重新解析攻略原文并替换点位
 * @param {string} gid 攻略 id
 * @returns {Promise<{count:number}>} 替换后的点位数量
 * 第三十轮：不再传 city（定位改由后端按「逐点城市 -> 全国兜底」完成）
 */
function regenPoints(gid) {
  const g = guides.getById(gid);
  if (!g) return Promise.reject(new Error('攻略不存在'));
  const raw = (g.rawText || '').trim();
  if (!raw) return Promise.reject(new Error('这篇攻略没有原文，无法重新生成'));

  return localparse.parseText(raw).then((r) => {
    if (!r || r.code !== 0) throw new Error((r && r.message) || '解析失败，请稍后再试');
    const list = (r && r.data && r.data.points) || [];
    if (!list.length) throw new Error('没有从原文里识别到点位');

    // 老坐标按名称继承
    const old = {};
    for (const p of (g.points || [])) {
      if (p && p.name) old[String(p.name).trim()] = p;
    }
    const points = list.map((p) => {
      if (!p || !p.name) return null;
      const o = old[String(p.name).trim()] || {};
      const lat = (typeof p.latitude === 'number' && p.latitude) ? p.latitude : (o.latitude || null);
      const lng = (typeof p.longitude === 'number' && p.longitude) ? p.longitude : (o.longitude || null);
      return {
        name: p.name,
        category: p.category || o.category || 'qita',
        group: p.group || o.group || '',
        section: p.section || o.section || '',
        primary: p.primary !== false,
        reason: p.reason || '',
        quote: p.quote || '',
        imageUrls: (p.imageUrls || []).slice(0, 6),
        colorOverride: p.colorOverride || o.colorOverride || '',
        latitude: lat,
        longitude: lng,
        located: !!(lat && lng)
      };
    }).filter(Boolean);

    if (!points.length) throw new Error('没有从原文里识别到点位');
    guides.setPoints(gid, points);
    return { count: points.length };
  });
}

export default { regenPoints };
