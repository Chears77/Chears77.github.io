/**
 * ui.js —— 自绘 UI 组件（替代 wx.showToast / showModal / showLoading / showActionSheet）
 *
 * 设计原则（对齐小程序端 tip.js 的节奏）：
 *   · toast  轻提示 2 秒自动消失，图标可选 success / error / none
 *   · modal  确认弹窗，返回 Promise<boolean>
 *   · loading 加载遮罩（默认**不带** mask，避免 R84 那种盖住整页的坑）
 *   · sheet  底部动作面板，返回 Promise<index>
 */
const tipHost = () => document.getElementById('ui-tips');

function el(cls, html) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}

/* ============ toast ============ */
let toastTimer = 0;
function toast(title, icon = 'none', duration = 2000) {
  const host = tipHost();
  if (!host) return;
  host.innerHTML = '';
  const t = el('ui-toast');
  const iconHtml = icon === 'success'
    ? '<svg viewBox="0 0 24 24" class="ui-toast-ic ok"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : icon === 'error'
      ? '<svg viewBox="0 0 24 24" class="ui-toast-ic err"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
      : '';
  t.innerHTML = iconHtml + '<span class="ui-toast-t"></span>';
  t.querySelector('.ui-toast-t').textContent = String(title || '');
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
  }, duration);
}

/* ============ modal ============ */
function modal(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const mask = el('ui-mask');
    const box = el('ui-modal');
    box.innerHTML =
      '<div class="ui-modal-t"></div>' +
      '<div class="ui-modal-c"></div>' +
      '<div class="ui-modal-btns">' +
      '  <button class="ui-modal-btn cancel" type="button"></button>' +
      '  <button class="ui-modal-btn ok" type="button"></button>' +
      '</div>';
    box.querySelector('.ui-modal-t').textContent = o.title || '提示';
    const c = box.querySelector('.ui-modal-c');
    if (o.html) c.innerHTML = o.html; else c.textContent = o.content || '';
    const okBtn = box.querySelector('.ui-modal-btn.ok');
    const cancelBtn = box.querySelector('.ui-modal-btn.cancel');
    okBtn.textContent = o.confirmText || '确定';
    cancelBtn.textContent = o.cancelText || '取消';
    okBtn.style.color = o.confirmColor || '#12B76A';
    if (o.showCancel === false) cancelBtn.style.display = 'none';
    const done = (v) => {
      mask.classList.remove('in');
      box.classList.remove('in');
      setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
      resolve(v);
    };
    okBtn.addEventListener('click', () => done(true));
    cancelBtn.addEventListener('click', () => done(false));
    mask.addEventListener('click', () => { if (o.maskClosable !== false) done(false); });
    document.body.appendChild(mask);
    document.body.appendChild(box);
    requestAnimationFrame(() => { mask.classList.add('in'); box.classList.add('in'); });
  });
}

/* ============ loading（默认不带 mask，绝不再造 R84 的坑）============ */
let loadingCount = 0;
function loading(title = '处理中…') {
  loadingCount++;
  let host = document.getElementById('ui-loading');
  if (!host) {
    host = el('ui-loading');
    host.id = 'ui-loading';
    host.innerHTML = '<div class="ui-loading-box"><span class="ui-spin"></span><span class="ui-loading-t"></span></div>';
    document.body.appendChild(host);
  }
  host.querySelector('.ui-loading-t').textContent = title;
  requestAnimationFrame(() => host.classList.add('in'));
}
function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount > 0) return;
  const host = document.getElementById('ui-loading');
  if (host) {
    host.classList.remove('in');
    setTimeout(() => { if (host.parentNode) host.parentNode.removeChild(host); }, 220);
  }
}
/** 兜底：无论计数如何，强制清掉（页面切换时调用，幂等） */
function forceHideLoading() {
  loadingCount = 0;
  hideLoading();
}

/* ============ actionSheet ============ */
function sheet(items) {
  return new Promise((resolve) => {
    const mask = el('ui-mask');
    const panel = el('ui-sheet');
    const list = el('ui-sheet-list');
    (items || []).forEach((it, i) => {
      const row = el('ui-sheet-item');
      row.textContent = it;
      if (it.indexOf('删除') >= 0 || it.indexOf('清除') >= 0) row.classList.add('danger');
      row.addEventListener('click', () => {
        mask.classList.remove('in');
        panel.classList.remove('in');
        setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
        resolve(i);
      });
      list.appendChild(row);
    });
    const cancel = el('ui-sheet-item cancel');
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      mask.classList.remove('in');
      panel.classList.remove('in');
      setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
      resolve(-1);
    });
    panel.appendChild(list);
    panel.appendChild(cancel);
    mask.addEventListener('click', () => {
      mask.classList.remove('in');
      panel.classList.remove('in');
      setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
      resolve(-1);
    });
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    requestAnimationFrame(() => { mask.classList.add('in'); panel.classList.add('in'); });
  });
}

/* ============ 轻量 confirm（alert 语义）============ */
function alert(title, content) {
  return modal({ title, content, showCancel: false });
}

export { toast, modal, loading, hideLoading, forceHideLoading, sheet, alert };
export default { toast, modal, loading, hideLoading, forceHideLoading, sheet, alert };
