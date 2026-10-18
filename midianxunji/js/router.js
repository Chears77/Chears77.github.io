/**
 * router.js —— hash 路由（替代 wx.navigateTo / switchTab / reLaunch / navigateBack）
 *
 * 路由表由 app.js 注册：
 *   router.register('/index', { title:'首页', tab:'index', mount: async (root)=>{...} })
 *   router.register('/map',    { title:'地图', tab:'map',    mount: ... })
 *
 * 约定：
 *   · tabBar 五个页用「切换」语义（清空页面栈，等价 switchTab）
 *   · 非 tabBar 页（review / sharepanel）用「压栈」语义（等价 navigateTo）
 *   · 返回用 history.back()，或 router.back() 显式调用页面 onHide 钩子
 */
import { forceHideLoading } from './ui.js';

const routes = {};
let current = null;
let pageStack = [];

function register(path, def) {
  routes[path] = def;
}

function parseHash() {
  const h = location.hash || '';
  const qi = h.indexOf('?');
  const path = (qi >= 0 ? h.slice(1, qi) : h.slice(1)) || '/index';
  const query = {};
  if (qi >= 0) {
    const qs = h.slice(qi + 1);
    for (const kv of qs.split('&')) {
      const eq = kv.indexOf('=');
      if (eq > 0) query[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1));
    }
  }
  return { path, query };
}

async function render() {
  const { path, query } = parseHash();
  const def = routes[path];
  const root = document.getElementById('page-root');
  if (!def || !root) return;
  if (current && current.onHide) { try { current.onHide(); } catch (e) { /* ignore */ } }
  forceHideLoading();

  root.innerHTML = '';
  root.className = 'page page-' + path.replace(/\//g, '-').slice(1);
  document.title = (def.title || '觅点寻迹') + ' - 觅点寻迹';

  const mod = await def.loader();
  const inst = mod.default || mod;
  const page = Object.assign({}, inst);
  page._query = query;
  page._path = path;
  if (typeof page.onLoad === 'function') { try { await page.onLoad(query); } catch (e) { console.error('[onLoad]', e); } }
  if (typeof page.render === 'function') {
    const html = await page.render();
    if (typeof html === 'string') root.innerHTML = html;
  }
  if (typeof page.bind === 'function') { try { page.bind(root); } catch (e) { console.error('[bind]', e); } }
  if (typeof page.onShow === 'function') { try { await page.onShow(); } catch (e) { console.error('[onShow]', e); } }

  current = page;
  if (def.tab) {
    pageStack = [path];
    highlightTab(def.tab);
  } else if (pageStack[pageStack.length - 1] !== path) {
    pageStack.push(path);
  }
  highlightTab(def.tab);
  // 地图页 / 分享页走宽容器（桌面视野更好）；地图页另开 map-on（画布挂 #map-layer）
  const app = document.getElementById('app');
  if (app) {
    app.classList.toggle('wide', path === '/map' || path === '/sharepanel');
    app.classList.toggle('map-on', path === '/map');
  }
  root.scrollTop = 0;
}

function highlightTab(tab) {
  document.querySelectorAll('#tabbar .tb-item').forEach((n) => {
    n.classList.toggle('on', n.getAttribute('data-tab') === (tab || ''));
  });
}

function navigate(path) {
  if (location.hash === '#' + path) { render(); return; }
  location.hash = path;
}

function switchTab(path) {
  // tabBar 页：直接改 hash，render 里会压栈重置
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

function reLaunch(path) {
  pageStack = [];
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

function back(fallback = '/mine') {
  if (pageStack.length > 1) {
    pageStack.pop();
    const prev = pageStack[pageStack.length - 1];
    if (location.hash === '#' + prev) render();
    else location.hash = prev;
  } else {
    navigate(fallback);
  }
}

window.addEventListener('hashchange', render);

const router = { register, navigate, switchTab, reLaunch, back, render, get current() { return current; } };

export default router;
export { navigate, switchTab, reLaunch, back, register, render };
