/* 资源级冒烟：本地 http 服务上逐个抓取关键资源，确认 200 */
const BASE = 'http://127.0.0.1:8931';
const paths = [
  '/', '/index.html', '/css/styles.css',
  '/js/app.js', '/js/router.js', '/js/page.js', '/js/store.js', '/js/ui.js', '/js/http.js', '/js/mappicker.js',
  '/js/lib/device.js', '/js/lib/guides.js', '/js/lib/favorites.js', '/js/lib/follow.js', '/js/lib/favicon.js',
  '/js/lib/categories.js', '/js/lib/geo.js', '/js/lib/places.js', '/js/lib/geosearch.js', '/js/lib/qqmap.js',
  '/js/lib/share.js', '/js/lib/qr.js', '/js/lib/regen.js', '/js/lib/imgpack.js', '/js/lib/localparse.js',
  '/js/lib/history.js', '/js/lib/rawtext.js', '/js/lib/templates.js',
  '/js/pages/index.js', '/js/pages/guides.js', '/js/pages/map.js', '/js/pages/favorites.js',
  '/js/pages/mine.js', '/js/pages/review.js', '/js/pages/sharepanel.js',
  '/js/components/pointedit.js',
  '/images/marker/star-gray-big.png', '/images/ui/chevron-right.png',
  '/images/tab/home_off.png', '/images/tab/map_on.png'
];
(async () => {
  let fail = 0;
  for (const p of paths) {
    try {
      const res = await fetch(BASE + p, { method: 'GET' });
      const ok = res.status === 200;
      if (!ok) fail++;
      console.log((ok ? '✅ ' : '❌ ') + res.status + ' ' + p);
    } catch (e) {
      fail++;
      console.log('❌ ERR ' + p + ' ' + e.message);
    }
  }
  console.log(fail === 0 ? '\n全部 ' + paths.length + ' 个资源可达' : '\n' + fail + ' 个资源失败');
  process.exit(fail ? 1 : 0);
})();
