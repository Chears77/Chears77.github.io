/**
 * pages/sharepanel.js —— 分享面板（网页版）
 *
 * 功能对齐小程序 sharepanel 页：
 *   · 发送模式：四种零后端出口（网页版对应改造）
 *       ① 复制分享链接（fitsPath 时；好友打开即入接收模式，替代微信卡片直传）
 *       ② 保存海报（canvas 画二维码 → 下载 PNG，替代存相册）
 *       ③ 复制分享码（MIDX1 完整码）
 *       ④ 下载分享文件（.txt；勾选「带图分享」走 base64 信封，替代微信发文件）
 *   · 接收模式（?c=CODE）：解析分享码 → 落成攻略 → 自动跳地图
 *   · 说明卡（?big=1&n=N）：链接装不下这么多点位时的指引
 *
 * 与小程序的关键差异：
 *   · 没有 open-type="share" 的转发卡片 —— 用「复制链接」替代（点开即看，体验等价）
 *   · canvas 从 wx canvas 2d 换成原生 <canvas>，画海报代码逐行一致
 *   · 保存海报 = 下载 PNG；发文件 = 下载 .txt（浏览器下载就是唯一可靠的落地方式）
 *   · R84 教训延续：loading 默认不带 mask；imgpack 链条无文件回调，不存在悬挂
 */
import { esc, mixin } from '../page.js';
import store from '../store.js';
import ui from '../ui.js';
import router from '../router.js';
import share from '../lib/share.js';
import qr from '../lib/qr.js';
import guides from '../lib/guides.js';
import qqmap from '../lib/qqmap.js';
import dl from '../dl.js';

const CTX_KEY = 'share_panel_ctx';

/** 拼出好友能直接打开的完整链接（保留子目录，GitHub Pages 部署在 /midianxunji/ 下） */
function fullShareUrl(code) {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return location.origin + dir + '#/sharepanel?c=' + encodeURIComponent(code);
}

const page = {
  data: {
    mode: 'send',
    title: '',
    count: 0,
    way: '',
    tipText: '',
    linkBtnTitle: '复制分享链接',
    linkBtnSub: '',
    qrReady: false,
    canFile: true,
    withImage: false,
    hasImage: false,
    bigCount: 0,
    recvTitle: '正在打开分享…',
    recvSub: '',
    recvFail: false
  },

  _pack: null,
  _canvas: null,

  onLoad(query) {
    const q = query || {};
    if (q.c) { this._receive(q.c); return; }
    if (q.big) { this._big(q); return; }
    this._send();
  },

  onShow() {
    ui.forceHideLoading();
  },

  /* ================= 说明卡 ================= */
  _big(q) {
    const n = parseInt(q.n, 10);
    this.setData({ mode: 'big', bigCount: isNaN(n) ? 0 : n });
  },

  /* ================= 接收模式 ================= */
  _receive(code) {
    const r = share.unpackCode(code);
    if (!r || !r.ok) {
      const truncated = r && r.reason === 'truncated';
      this.setData({
        mode: 'recv',
        recvFail: true,
        recvTitle: truncated ? '这条分享不完整' : '打不开这条分享',
        recvSub: truncated
          ? '分享链接太长，点位数据在传输中被截断了。可以让好友改用「保存海报」或「复制分享码」发给你。'
          : '分享码可能不完整或被改过，请让好友重新发一次。'
      });
      return;
    }

    let map = store.get('imported_map') || {};
    const key = share.hashOf(code);
    let g = map[key] ? guides.getById(map[key]) : null;
    let fresh = false;
    if (!g) {
      g = guides.create({
        name: r.data.name,
        sourceTitle: '好友分享',
        rawText: '',
        points: r.data.points
      });
      map[key] = g.id;
      const ks = Object.keys(map);
      if (ks.length > 30) delete map[ks[0]];
      store.set('imported_map', map);
      fresh = true;
    }

    if (guides.setSoloVisible) guides.setSoloVisible(g.id);
    store.set('map_layer_intent', 'guide');
    store.set('map_focus_gid', g.id);
    store.set('map_focus_reason', 'share');
    this.setData({
      mode: 'recv',
      recvTitle: fresh ? ('已收到《' + g.name + '》') : ('再次打开《' + g.name + '》'),
      recvSub: r.data.points.length + ' 个点位，正在帮你标到地图上…'
    });
    setTimeout(() => { router.navigate('/map'); }, 800);
  },

  goMap() { router.navigate('/map'); },

  /* ================= 发送模式 ================= */
  _send() {
    const ctx = store.get(CTX_KEY) || {};
    const pack = share.packOf(ctx.kind || 'guide', ctx);
    if (!pack || !pack.ok) {
      let msg = '这个内容里没有可分享的点位';
      const reason = pack && pack.reason;
      if (reason === 'gone') {
        msg = '这条内容已经不存在了，请返回后重试';
      } else if (reason === 'kind') {
        msg = '暂不支持分享这类内容';
      } else if (reason === 'bad') {
        msg = '分享内容生成失败，请返回后重试';
      } else {
        const g = guides.current();
        const pts = (g && g.points) || [];
        if (pts.length && !pts.some(p => p.located)) {
          msg = qqmap.quotaOut()
            ? '点位还没查到坐标（今日定位额度用完，次日恢复）'
            : '点位还没查到坐标，先去地图页补一下';
        }
      }
      ui.toast(msg, 'none');
      setTimeout(() => { router.back('/map'); }, 1600);
      return;
    }
    this._pack = pack;

    // 三档：链接 → 二维码 → 仅文本/文件（档位由长度自动判定）
    let way, linkTitle, linkSub, tip;
    if (pack.fitsPath) {
      way = '链接直传';
      linkTitle = '复制分享链接';
      linkSub = '好友点开链接就是一张现成的地图';
      tip = '也可以保存海报，或复制分享码';
    } else if (pack.chars <= qr.MAX_BYTES) {
      way = '内容偏多，走二维码';
      linkTitle = '保存海报（二维码）';
      linkSub = '链接装不下这么多点位，用二维码海报';
      tip = '好友长按识别二维码 → 复制分享码 →「我的 → 导入」粘贴';
    } else {
      way = '点位太多，二维码也装不下';
      linkTitle = '复制分享码';
      linkSub = '建议用「复制分享码」或「下载分享文件」';
      tip = '好友收到分享码后，在「我的 → 导入」里粘贴';
    }

    this.setData({
      title: pack.title,
      count: pack.count,
      way,
      tipText: tip,
      linkBtnTitle: linkTitle,
      linkBtnSub: linkSub,
      canFile: true,
      hasImage: !!pack.hasImage
    });
    this._draw();
  },

  /* ===== 画海报 ===== */
  _draw() {
    const pack = this._pack;
    if (!pack) return;
    const m = qr.matrix(pack.compact || pack.code, 'M');
    if (!m) { this.setData({ qrReady: false }); return; }

    // 等一帧，确保 canvas 已在 DOM 里
    requestAnimationFrame(() => {
      const canvas = document.getElementById('sp-qr');
      if (!canvas) { this.setData({ qrReady: false }); return; }
      const c = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 2;

      const W = 300, H = 430;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      c.scale(dpr, dpr);
      this._canvas = canvas;

      c.fillStyle = '#FFFFFF';
      c.fillRect(0, 0, W, H);

      c.fillStyle = '#12B76A';
      c.fillRect(0, 0, W, 92);
      c.fillStyle = '#FFFFFF';
      c.font = '500 21px sans-serif';
      c.fillText('觅点寻迹', 24, 42);
      c.font = '12px sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.fillText('把攻略里的地点标到地图上', 24, 66);

      c.fillStyle = '#0F172A';
      c.font = '500 17px sans-serif';
      c.fillText(this._clip(c, pack.title, W - 48), 24, 128);
      c.fillStyle = '#64748B';
      c.font = '12px sans-serif';
      c.fillText(pack.count + ' 个点位', 24, 150);

      const box = 176;
      const x0 = Math.round((W - box) / 2), y0 = 164;
      c.fillStyle = '#FFFFFF';
      c.fillRect(x0 - 6, y0 - 6, box + 12, box + 12);
      const cell = box / (m.size + 2);
      c.fillStyle = '#0F172A';
      for (let r = 0; r < m.size; r++) {
        for (let col = 0; col < m.size; col++) {
          if (m.get(r, col)) c.fillRect(x0 + (col + 1) * cell, y0 + (r + 1) * cell, cell, cell);
        }
      }

      c.fillStyle = '#94A3B8';
      c.font = '11px sans-serif';
      c.textAlign = 'center';
      if (pack.fitsPath) {
        c.fillText('长按识别二维码，或直接打开分享链接', W / 2, H - 40);
      } else {
        c.fillText('长按识别二维码 → 复制分享码', W / 2, H - 42);
        c.fillText('在「我的 → 导入」粘贴即可', W / 2, H - 24);
      }
      c.textAlign = 'left';

      this.setData({ qrReady: true });
    });
  },

  _clip(c, text, maxW) {
    let t = String(text || '');
    if (c.measureText(t).width <= maxW) return t;
    while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  },

  /* ===== 四个出口 ===== */

  /** ① 主按钮：按档位自动变成「复制链接 / 保存海报 / 复制分享码」 */
  primaryAction() {
    const pack = this._pack;
    if (!pack) return;
    if (pack.fitsPath) {
      this.copyLink();
    } else if (pack.chars <= qr.MAX_BYTES) {
      this.savePoster();
    } else {
      this.copyCode();
    }
  },

  copyLink() {
    const pack = this._pack;
    if (!pack || !pack.fitsPath) {
      ui.toast('这份内容链接装不下，请用下面的海报或分享码', 'none');
      return;
    }
    const url = fullShareUrl(pack.compact);
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      ui.modal({
        title: '请手动复制链接',
        content: '当前环境不支持自动复制，请长按选择下面链接复制：\n\n' + url,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      ui.modal({
        title: '链接已复制',
        content: '把链接发给好友（微信 / QQ / 邮件都可以），他点开就是这张地图。\n\n' + url,
        showCancel: false,
        confirmText: '知道了'
      });
    }).catch(() => {
      ui.modal({
        title: '复制失败',
        content: '请手动复制下面的链接：\n\n' + url,
        showCancel: false,
        confirmText: '知道了'
      });
    });
  },

  /** ② 保存海报：canvas → PNG 下载（网页 Blob / 安卓壳原生桥双通道） */
  savePoster() {
    if (!this._canvas) { ui.toast('海报还没准备好', 'none'); return; }
    const pack = this._pack;
    const name = (pack && pack.name) || '分享海报';
    this._canvas.toBlob(async (blob) => {
      if (!blob) { ui.toast('海报制作失败', 'none'); return; }
      await dl.saveBlob(name + ' · 觅点寻迹海报.png', blob);
      ui.toast('海报已下载，可直接发给好友', 'success');
    }, 'image/png');
  },

  /** ③ 复制分享码（完整码 MIDX1，比紧凑码多存推荐理由） */
  copyCode() {
    if (!this._pack) return;
    share.copyPack(Object.assign({}, this._pack, { code: this._pack.code }));
  },

  /** ④ 下载分享文件（.txt；勾选带图时走 base64 信封） */
  async sendFile() {
    if (!this._pack) return;
    if (this.data.withImage) {
      ui.loading('正在打包图片…');
      try {
        const env = await share.buildImgEnvelope(this._pack.name, this._pack._points, { sourceTitle: '觅点寻迹' });
        ui.hideLoading();
        if (!env.ok) {
          ui.toast('图片打包失败，请用普通分享', 'none');
          return;
        }
        share.filePackEnvelope(env);
      } catch (e) {
        ui.hideLoading();
        ui.toast('图片打包失败，请用普通分享', 'none');
      }
      return;
    }
    share.filePack(this._pack);
  },

  toggleWithImage() {
    this.setData({ withImage: !this.data.withImage });
  },

  /* ===== 渲染 ===== */
  render() {
    const d = this.data;

    /* 接收 / 说明卡 */
    if (d.mode === 'recv' || d.mode === 'big') {
      if (d.mode === 'big') {
        return (
          '<div class="sp-page">' +
          '  <div class="sp-recv">' +
          '    <div class="sp-recv-ic"><img src="images/ui/pin-relocate.png" alt=""></div>' +
          '    <div class="sp-recv-t">这份分享点位比较多</div>' +
          '    <div class="sp-recv-s">' + (d.bigCount ? d.bigCount + ' 个点位，' : '') + '分享链接装不下这么多内容。可以请好友「保存海报」把二维码发给你，长按识别二维码就能看到；或者让他「复制分享码 / 下载分享文件」给你，在「我的 → 导入」里粘贴或选文件。</div>' +
          '    <button class="sp-recv-btn" data-act="go-map">先去看看地图</button>' +
          '  </div>' +
          '</div>'
        );
      }
      return (
        '<div class="sp-page">' +
        '  <div class="sp-recv">' +
        '    <div class="sp-recv-ic">' + (d.recvFail ? '' : '<img src="images/ui/pin-relocate.png" alt="">') + '</div>' +
        '    <div class="sp-recv-t">' + esc(d.recvTitle) + '</div>' +
        '    <div class="sp-recv-s">' + esc(d.recvSub) + '</div>' +
        (d.recvFail ? '<button class="sp-recv-btn" data-act="go-map">先去看看地图</button>' : '') +
        '  </div>' +
        '</div>'
      );
    }

    /* 发送模式 */
    const pack = this._pack;
    return (
      '<div class="sp-page">' +
      '  <div class="sp-card">' +
      '    <canvas id="sp-qr" class="sp-canvas"></canvas>' +
      (!d.qrReady ? '<div class="sp-canvas-ph">二维码处理中…</div>' : '') +
      '  </div>' +

      /* 带图分享开关（仅文件方式支持）*/
      (d.canFile && d.hasImage ?
        '<div class="sp-imgtoggle">' +
        '  <div class="sp-imgtoggle-txt">' +
        '    <div class="sp-imgtoggle-t">带图分享（文件方式）</div>' +
        '    <div class="sp-imgtoggle-s">把点位里的图片一起打包发给好友，他导入后能看到图（图片较大时文件会偏慢）</div>' +
        '  </div>' +
        '  <button class="sp-switch ' + (d.withImage ? 'on' : '') + '" data-act="toggle-img"><span class="sp-switch-dot"></span></button>' +
        '</div>'
        : '') +

      '  <div class="sp-acts">' +

      /* ① 主按钮（按档位自动切换）*/
      '    <button class="sp-act sp-act-main" data-act="primary">' +
      '      <img class="sp-ic" src="images/ui/share-dark.png" alt="">' +
      '      <span class="sp-act-txt"><span class="sp-act-t">' + esc(d.linkBtnTitle) + '</span>' +
      '      <span class="sp-act-s">' + esc(d.linkBtnSub) + '</span></span>' +
      '    </button>' +

      /* ② 保存海报 */
      '    <button class="sp-act" data-act="save-poster">' +
      '      <img class="sp-ic" src="images/ui/export-dark.png" alt="">' +
      '      <span class="sp-act-txt"><span class="sp-act-t">保存海报</span>' +
      '      <span class="sp-act-s">下载二维码图片，可发朋友圈或聊天里直接发图</span></span>' +
      '      <img class="sp-arrow" src="images/ui/chevron-right.png" alt="">' +
      '    </button>' +

      /* ③ 复制分享码 */
      '    <button class="sp-act" data-act="copy-code">' +
      '      <img class="sp-ic" src="images/ui/tool-copy-dark.png" alt="">' +
      '      <span class="sp-act-txt"><span class="sp-act-t">复制分享码</span>' +
      '      <span class="sp-act-s">好友在「我的 → 导入」粘贴</span></span>' +
      '      <img class="sp-arrow" src="images/ui/chevron-right.png" alt="">' +
      '    </button>' +

      /* ④ 下载分享文件 */
      '    <button class="sp-act" data-act="send-file">' +
      '      <img class="sp-ic" src="images/ui/send-dark.png" alt="">' +
      '      <span class="sp-act-txt"><span class="sp-act-t">下载分享文件</span>' +
      '      <span class="sp-act-s">点位特别多的时候用这个最稳（可带图）</span></span>' +
      '      <img class="sp-arrow" src="images/ui/chevron-right.png" alt="">' +
      '    </button>' +

      '  </div>' +

      '  <div class="sp-way">当前方式：' + esc(d.way) + ' · ' + esc(pack ? pack.count : 0) + ' 个点位</div>' +
      '  <div class="sp-tip">' + esc(d.tipText) + '</div>' +
      '  <div class="sp-foot">数据只存在各自的设备里，全程不经过服务器</div>' +
      '  <div class="sp-bottom"></div>' +
      '</div>'
    );
  },

  bind(root) {
    this.on(root, 'go-map', () => this.goMap());
    this.on(root, 'primary', () => this.primaryAction());
    this.on(root, 'save-poster', () => this.savePoster());
    this.on(root, 'copy-code', () => this.copyCode());
    this.on(root, 'send-file', () => this.sendFile());
    this.on(root, 'toggle-img', () => this.toggleWithImage());
  }
};

export default mixin(page);
