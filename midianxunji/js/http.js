/**
 * http.js —— fetch 封装（替代 wx.request）
 * 用法与原来一致：http.get(url) → Promise<data>，失败返回带 status:-3 的对象
 */
async function get(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    const data = await res.json();
    return data || {};
  } catch (e) {
    return { status: '-3', info: '网络不可用', pois: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function post(url, body, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    return await res.json();
  } catch (e) {
    return { error: '网络不可用' };
  } finally {
    clearTimeout(timer);
  }
}

const http = { get, post };
export default http;
