/**
 * dl.js —— 文件保存双通道
 *   · 普通浏览器：Blob + <a download>（原有行为）
 *   · 安卓 WebView 壳：window.AndroidBridge.saveBlob / saveText（原生存媒体目录）
 * 桥不存在时自动回落网页通道，网页版行为零变化。
 */
function _aDownload(url, fileName) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }, 800);
}

function _blobToB64(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => res('');
    r.readAsDataURL(blob);
  });
}

/** 保存二进制（海报 PNG 等）；返回是否成功 */
async function saveBlob(fileName, blob) {
  if (!blob) return false;
  if (window.AndroidBridge && typeof window.AndroidBridge.saveBlob === 'function') {
    const b64 = await _blobToB64(blob);
    if (b64) { window.AndroidBridge.saveBlob(fileName, b64); return true; }
  }
  _aDownload(URL.createObjectURL(blob), fileName);
  return true;
}

/** 保存文本（导出 .txt/.json/.csv/.kml 等）；返回是否成功 */
async function saveText(fileName, text) {
  if (window.AndroidBridge && typeof window.AndroidBridge.saveText === 'function') {
    window.AndroidBridge.saveText(fileName, String(text == null ? '' : text));
    return true;
  }
  const blob = new Blob([text], { type: 'application/octet-stream;charset=utf-8' });
  _aDownload(URL.createObjectURL(blob), fileName);
  return true;
}

const dl = { saveBlob, saveText };
export default dl;
