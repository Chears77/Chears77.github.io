/**
 * api.js（网页版桩）—— 在线解析通道（R72 起下线，网页版同口径）
 *
 * analyze() 恒返回「未启用」，调用方（regen 等）收到非 0 code 会走本地兜底。
 * 保留此文件是为了让 import 不炸，接口形状与小程序版一致。
 */
const OFF_MSG = '在线解析未启用，已使用本地规则解析';

function analyze() {
  return Promise.resolve({ code: 1001, message: OFF_MSG, data: null });
}
function chat() { return Promise.reject(new Error(OFF_MSG)); }
function ocr() { return Promise.reject(new Error(OFF_MSG)); }
function regeo() { return Promise.reject(new Error(OFF_MSG)); }
function warmUp() { /* 纯本地版没有远端服务需要预热 */ }
function mapDelete() { return Promise.resolve({ code: 0 }); }

export default { analyze, chat, ocr, regeo, warmUp, mapDelete };
