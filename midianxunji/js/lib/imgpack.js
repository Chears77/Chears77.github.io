/**
 * imgpack.js（网页版）—— 图片打包/还原，底层换成 IndexedDB
 *
 * 与小程序版的差异：
 *   · 小程序 imageUrls 存 wxfile:// 路径，打包靠 wx.fs 读文件；
 *   · 网页版 imageUrls 存「图片 id」，本体在 IndexedDB（store.img），
 *     pack 直接导出 {id: dataURL}，unpack 存回库拿新 id。
 *   · 不再需要 readB64/statSize/downloadTmp/withTimeout —— 没有文件回调链，
 *     也就不存在 R84 那种「回调不回来把页面挂死」的坑。
 *
 * API 与小程序版保持一致：pack / unpack / rewriteUrls / collectUrls / extOf
 */
import store from '../store.js';

/** 网络地址判断（网页版图片只来自本机文件，保留此函数仅为兼容旧数据） */
function isNetwork(u) {
  return /^https?:\/\//i.test(String(u || ''));
}

function extOf(u) {
  const m = String(u || '').match(/\.(png|jpe?g|webp|gif)(?:$|\?)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

/** 从 favorites/guides 数据结构里收集所有图片 id */
function collectUrls(target) {
  const out = [];
  const push = (arr) => {
    for (const u of (arr || [])) {
      const s = String(u || '').trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
  };
  const walkNodes = (nodes) => {
    for (const nd of (nodes || [])) {
      for (const p of ((nd && nd.points) || [])) push(p.imageUrls);
      walkNodes((nd && nd.children) || []);
    }
  };
  if (target && target.favorites) {
    const fav = target.favorites;
    if (Array.isArray(fav)) walkNodes(fav);
    else walkNodes(fav.tree || []);
  }
  if (target && Array.isArray(target.guides)) {
    for (const g of target.guides) {
      for (const p of (g.points || [])) push(p.imageUrls);
    }
  }
  return out;
}

/** 打包：{ id: dataURL } */
async function pack(urls, opts) {
  const ids = (urls || []).filter(u => String(u || '').trim());
  const imgs = await store.img.pack(ids);
  let bytes = 0;
  for (const k of Object.keys(imgs)) bytes += String(imgs[k]).length;
  const packed = Object.keys(imgs).length;
  if (opts && opts.onProgress) opts.onProgress(packed, ids.length);
  return { imgs, packed, skipped: ids.length - packed, bytes, total: ids.length };
}

/** 还原：{ id: dataURL } → { 旧id: 新id } */
async function unpack(imgs, opts) {
  const keys = Object.keys(imgs || {});
  const pathMap = await store.img.unpack(imgs);
  const restored = keys.filter(k => pathMap[k]).length;
  if (opts && opts.onProgress) opts.onProgress(restored, keys.length);
  return { pathMap, restored, failed: keys.length - restored, total: keys.length };
}

/** 按 pathMap 就地替换备份对象里的 imageUrls（调用方改完要再写一次存储） */
function rewriteUrls(target, pathMap) {
  let n = 0;
  const map = pathMap || {};
  const fix = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const np = map[arr[i]];
      if (np && np !== arr[i]) { arr[i] = np; n++; }
    }
  };
  const walkNodes = (nodes) => {
    for (const nd of (nodes || [])) {
      for (const p of ((nd && nd.points) || [])) fix(p.imageUrls);
      walkNodes((nd && nd.children) || []);
    }
  };
  if (target && target.favorites) {
    const fav = target.favorites;
    if (Array.isArray(fav)) walkNodes(fav);
    else walkNodes(fav.tree || []);
  }
  if (target && Array.isArray(target.guides)) {
    for (const g of target.guides) {
      for (const p of (g.points || [])) fix(p.imageUrls);
    }
  }
  return n;
}

export default {
  isNetwork, extOf, collectUrls, pack, unpack, rewriteUrls,
  // 兼容旧引用
  BUDGET: 24 * 1024 * 1024, MAX_COUNT: 80, MAX_ONE: 6 * 1024 * 1024
};
