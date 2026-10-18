/**
 * page.js —— 页面基类工具（各页面 mixin 用）
 * 提供：setData 合并 + 整页重渲染（保滚动位置）、HTML 转义、事件绑定快捷方式
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 给页面对象混入基础能力（router 会 Object.assign 复制，方法走 this 调用保持一致） */
function mixin(page) {
  const p = page;
  p.data = p.data || {};
  /**
   * 合并数据；默认整页重渲染（保滚动位置）。
   * 兼容小程序两套调用习惯：
   *   · setData(patch)            → 合并 + 重渲染
   *   · setData(patch, cb)        → 合并 + 重渲染 + 执行回调（cb 在渲染后跑）
   *   · setData(patch, true)      → 只合并不渲染（受控输入框等热路径用）
   * patch 支持 'a.b' 点路径 key（对齐小程序的 setData({'x.y': v}) 语义）
   */
  p.setData = function (patch, arg) {
    const src = patch || {};
    for (const k of Object.keys(src)) {
      if (k.indexOf('.') >= 0) {
        const parts = k.split('.');
        let o = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          if (!o[seg] || typeof o[seg] !== 'object') o[seg] = {};
          o = o[seg];
        }
        o[parts[parts.length - 1]] = src[k];
      } else {
        this.data[k] = src[k];
      }
    }
    if (arg === true) return;               // 显式 noRender
    this.rerender();
    if (typeof arg === 'function') arg();   // 渲染后回调
  };
  /** 整页重渲染 */
  p.rerender = function () {
    const root = document.getElementById('page-root');
    if (!root) return;
    const st = window.scrollY || 0;
    root.innerHTML = this.render();
    this.bind(root);
    window.scrollTo(0, st);
  };
  /** 在 root 范围内按 data-act 委托绑定 */
  p.on = function (root, act, fn) {
    root.querySelectorAll('[data-act="' + act + '"]').forEach((n) => {
      n.addEventListener('click', (e) => {
        const el = e.currentTarget;
        fn.call(this, e, el.getAttribute('data-arg') || '');
      });
    });
  };
  return p;
}

export { esc, mixin };
