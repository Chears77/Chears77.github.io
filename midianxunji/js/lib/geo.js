/**
 * geo.js —— 地理工具
 */
/** 计算两点直线距离（米），Haversine 公式 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 距离文案 */
function formatDistance(m) {
  if (m == null || isNaN(m)) return '';
  if (m < 1000) return Math.round(m) + 'm';
  return (m / 1000).toFixed(1) + 'km';
}

/** 点位集合中心点（用于地图初始化视野） */
function centerOf(points) {
  const valid = (points || []).filter(p => p.latitude && p.longitude);
  if (!valid.length) return null;
  const lat = valid.reduce((s, p) => s + p.latitude, 0) / valid.length;
  const lng = valid.reduce((s, p) => s + p.longitude, 0) / valid.length;
  return { latitude: lat, longitude: lng };
}

/** 字符串截断 */
function truncate(str, max) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default { distanceMeters, formatDistance, centerOf, truncate };
