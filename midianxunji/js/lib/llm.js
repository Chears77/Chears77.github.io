/**
 * llm.js（网页版桩）—— 第七十二轮起在线生成已下线，网页版保持同一口径。
 *
 * 这个文件只保留接口形状，所有能力恒不可用：
 *   · ready() / usable() 恒 false → localparse 直接走本地规则引擎
 *   · chat / extractPlaces 恒 reject → 任何漏掉的调用点也不会卡死（Promise 落地）
 *   · quotaInfo 返回 0 → 我的页显示「未启用」
 *
 * 将来若要在网页版恢复在线能力：把小程序 utils/llm.js 机械移植过来，
 * 把 wx.request 换成 http.post、wx.Storage 换成 store 即可（函数全是纯逻辑）。
 */
const OFF = '在线解析未启用';

function ready() { return false; }
function usable() { return false; }
function needTip() { return ''; }
function chat() { return Promise.reject(new Error(OFF)); }
function vision() { return Promise.reject(new Error(OFF)); }
function extractPlaces() { return Promise.reject(new Error(OFF)); }
function noteOf() { return ''; }
function presets() { return []; }
function presetOf() { return null; }
function builtin() { return null; }
function usingBuiltin() { return false; }
function quotaInfo() { return { left: 0, limit: 0, used: 0 }; }
function get() { return ''; }
function set() { return false; }
function clear() { return true; }
function fallbackModels() { return []; }

export default {
  KEY: '', get, set, clear, ready, needTip, chat, vision, extractPlaces,
  presets, presetOf, builtin, usingBuiltin, quotaInfo, usable, noteOf,
  fallbackModels
};
