/**
 * config.js（网页版）—— 全局配置
 *
 * 与小程序版的差异：
 *   · qqmapKey / mapKey 同一个值：腾讯位置服务的 Key 同时用于
 *     WebService（apis.map.qq.com，搜地点）和 JS API GL（map.qq.com，画地图）。
 *     ⚠️ 部署后需到腾讯位置服务控制台 → 应用管理 → 给该 Key 添加域名
 *     「chears77.github.io」，否则地图不显示、地点搜索 111/199。
 *   · llm 段整体下线（R72 口径），留档说明。
 */
export default {
  // ===== 运行模式：网页版恒纯本地 =====
  localOnly: true,

  // ===== 腾讯位置服务 Key（WebService 地点搜索 + JS API GL 地图，同一个 Key）=====
  qqmapKey: 'FRKBZ-6WL6T-M7HXS-L3DWN-W42T7-WFF3I',
  mapKey: 'FRKBZ-6WL6T-M7HXS-L3DWN-W42T7-WFF3I',

  // ===== 外部文本服务：网页版同样下线（第七十二轮口径）=====
  llm: {
    baseUrl: '',
    apiKey: '',
    model: '',
    fallbackModels: [],
    vision: false
  },
  llmKeyParts: [],
  llmKeyOrder: [],
  llmDailyLimit: 0,

  // ===== 二期预留：自有后端地址（留空 = 纯本地）=====
  backendUrl: '',

  // ===== 地图缩放级别阈值：>= 该级别时常显点位备注摘要 =====
  noteZoomLevel: 13,

  // ===== 本地解析上限：一次最多定位多少个点 =====
  maxLocate: 30
};

