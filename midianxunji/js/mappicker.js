/**
 * mappicker.js —— 全屏地图选点（替代小程序的 wx.chooseLocation）
 *
 * 用腾讯地图 JS API GL（index.html 已引入，全局 TMap）。
 * 点击地图放一个 marker，底部显示「逆地理出的地名 + 坐标」，确认返回。
 * @returns Promise<{latitude, longitude, name}|null> 取消返回 null
 */
import qqmap from './lib/qqmap.js';

function waitTMap(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (window.TMap) return resolve(window.TMap);
    const t0 = Date.now();
    const tick = () => {
      if (window.TMap) return resolve(window.TMap);
      if (Date.now() - t0 > timeout) return reject(new Error('地图组件加载超时'));
      setTimeout(tick, 120);
    };
    tick();
  });
}

export async function pickPointOnMap(lat, lng, hintName) {
  let TMap;
  try { TMap = await waitTMap(); } catch (e) { return null; }

  return new Promise((resolve) => {
    const center = new TMap.LatLng(Number(lat) || 30.5728, Number(lng) || 104.0668);
    const wrap = document.createElement('div');
    wrap.className = 'mp-wrap';
    wrap.innerHTML =
      '<div class="mp-map" id="mpMap"></div>' +
      '<div class="mp-bar">' +
      '  <button class="btn btn-s line" data-mp="cancel">取消</button>' +
      '  <div class="mp-info"><div class="mp-name" id="mpName">' + (hintName ? String(hintName) : '点地图选一个位置') + '</div>' +
      '    <div class="mp-coord" id="mpCoord"></div></div>' +
      '  <button class="btn btn-s" data-mp="ok">确定</button>' +
      '</div>';
    document.body.appendChild(wrap);

    const map = new TMap.Map(document.getElementById('mpMap'), {
      center: center,
      zoom: Number(lat) ? 16 : 10,
      viewMode: '2D'
    });
    let marker = null;
    let picked = Number(lat) ? { latitude: Number(lat), longitude: Number(lng) } : null;

    const nameEl = wrap.querySelector('#mpName');
    const coordEl = wrap.querySelector('#mpCoord');
    const okBtn = wrap.querySelector('[data-mp="ok"]');
    okBtn.disabled = true;

    const setPick = (la, ln, nm) => {
      picked = { latitude: la, longitude: ln };
      nameEl.textContent = nm || '已选位置';
      coordEl.textContent = la.toFixed(5) + ', ' + ln.toFixed(5);
      okBtn.disabled = false;
    };

    if (Number(lat)) {
      marker = new TMap.MultiMarker({
        id: 'pick',
        map,
        styles: { pick: new TMap.MarkerStyle({ width: 25, height: 35, src: 'images/ui/pin-on.png' }) },
        geometries: [{ id: 'pick', position: center, styleId: 'pick' }]
      });
      setPick(Number(lat), Number(lng), hintName || '');
    }

    map.on('click', (ev) => {
      const la = ev.latLng.getLat().toFixed(6);
      const ln = ev.latLng.getLng().toFixed(6);
      const p = new TMap.LatLng(Number(la), Number(ln));
      if (marker) marker.updateGeometries([{ id: 'pick', position: p, styleId: 'pick' }]);
      else marker = new TMap.MultiMarker({
        id: 'pick', map,
        styles: { pick: new TMap.MarkerStyle({ width: 25, height: 35, src: 'images/ui/pin-on.png' }) },
        geometries: [{ id: 'pick', position: p, styleId: 'pick' }]
      });
      setPick(Number(la), Number(ln), '正在识别地名…');
      qqmap.regeo(Number(la), Number(ln)).then((r) => {
        if (r && r.code === 0 && r.data && r.data.name) nameEl.textContent = r.data.name;
        else nameEl.textContent = '已选位置';
      }).catch(() => { nameEl.textContent = '已选位置'; });
    });

    const done = (v) => {
      try { marker && marker.setMap(null); map.destroy(); } catch (e) { /* ignore */ }
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      resolve(v);
    };
    wrap.querySelector('[data-mp="cancel"]').addEventListener('click', () => done(null));
    wrap.querySelector('[data-mp="ok"]').addEventListener('click', () => {
      if (!picked) { done(null); return; }
      done({ latitude: picked.latitude, longitude: picked.longitude, name: nameEl.textContent });
    });
  });
}

export default pickPointOnMap;
