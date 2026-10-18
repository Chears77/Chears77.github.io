/**
 * app.js —— 网页版入口（对应小程序 app.js + app.json 的页面注册）
 */
import router from './router.js';
import device from './lib/device.js';
import guides from './lib/guides.js';
import geo from './lib/geo.js';

/* 距离计算挂在 window 上，pointedit 的「距我」行要用（与小程序同口径） */
window.__geo = geo;

/* 页面注册：tab 页五个 + 非 tab 页两个（review 复核 / sharepanel 分享） */
router.register('/index', { title: '首页', tab: 'index', loader: () => import('./pages/index.js') });
router.register('/guides', { title: '攻略', tab: 'guides', loader: () => import('./pages/guides.js') });
router.register('/map', { title: '点位地图', tab: 'map', loader: () => import('./pages/map.js') });
router.register('/favorites', { title: '收藏', tab: 'favorites', loader: () => import('./pages/favorites.js') });
router.register('/mine', { title: '我的', tab: 'mine', loader: () => import('./pages/mine.js') });
router.register('/review', { title: '点位复核', loader: () => import('./pages/review.js') });
router.register('/sharepanel', { title: '分享点位', loader: () => import('./pages/sharepanel.js') });

/* ============ 启动 ============ */
(async function boot() {
  try {
    device.getDeviceId();      // 本机标识（免登录）
    guides.migrateLegacy();    // 老版本数据迁移（只跑一次）
  } catch (e) {
    console.error('[boot]', e);
  }
  if (!location.hash) location.hash = '/index';
  await router.render();
  // 深链：location.hash 已带 query 时 render 用的是初始 hash，这里补一次保证 query 生效
  if (location.hash && location.hash.indexOf('?') >= 0) await router.render();
})();
