/**
 * store.js —— 网页版数据层（替代小程序的 wx.Storage + wx.fileSystem）
 *
 * 三层存储：
 *   ① localStorage  —— 结构化数据（攻略、收藏、设置），同步 API，语义与 wx.Storage 一致
 *   ② IndexedDB     —— 图片本体（base64 dataURL），localStorage 5MB 装不下
 *   ③ 内存 Map      —— 图片 dataURL 缓存，避免同一次会话里反复读库
 *
 * 图片寻址方式（与小程序的关键差异）：
 *   小程序里 imageUrls 存的是 wxfile:// 临时路径；网页版改存「图片 id」，
 *   渲染时用 store.img.url(id) 异步换成 dataURL 再上 <img>。
 */
const NS = 'midian_';

const mem = {};

const store = {
  /* ============ 结构化数据（同步，兼容 wx.Storage 语义）============ */

  get(key) {
    try {
      const raw = localStorage.getItem(NS + key);
      if (raw === null || raw === undefined) return '';
      return JSON.parse(raw);
    } catch (e) { return ''; }
  },

  set(key, val) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(val));
      return true;
    } catch (e) {
      // 容量溢出：与小程序 write() 的降级思路一致，交由调用方决定丢数据
      return false;
    }
  },

  remove(key) {
    try { localStorage.removeItem(NS + key); } catch (e) { /* ignore */ }
  },

  /* ============ 图片（IndexedDB，异步）============ */

  img: {
    _db: null,

    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('midian_imgs', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs');
        };
        req.onsuccess = () => { this._db = req.result; resolve(req.result); };
        req.onerror = () => reject(req.error);
      });
    },

    async save(dataUrl) {
      const id = 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      mem[id] = dataUrl;
      try {
        const db = await this.open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('imgs', 'readwrite');
          tx.objectStore('imgs').put(dataUrl, id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { /* 内存缓存仍然有效，刷新后才丢 */ }
      return id;
    },

    async remove(id) {
      delete mem[id];
      try {
        const db = await this.open();
        await new Promise((resolve) => {
          const tx = db.transaction('imgs', 'readwrite');
          tx.objectStore('imgs').delete(id);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      } catch (e) { /* ignore */ }
    },

    /** 同步取缓存（渲染热路径用）；未命中返回 ''，调用方再用 url() 异步补 */
    peek(id) {
      return mem[id] || '';
    },

    async url(id) {
      if (!id) return '';
      if (mem[id]) return mem[id];
      try {
        const db = await this.open();
        const v = await new Promise((resolve) => {
          const tx = db.transaction('imgs', 'readonly');
          const r = tx.objectStore('imgs').get(id);
          r.onsuccess = () => resolve(r.result || '');
          r.onerror = () => resolve('');
        });
        if (v) mem[id] = v;
        return v;
      } catch (e) { return ''; }
    },

    /** 预热：把一批 id 全部读进内存缓存 */
    async warm(ids) {
      const uniq = Array.from(new Set((ids || []).filter(Boolean)));
      await Promise.all(uniq.map((id) => this.url(id)));
    },

    /** 打包成 { id: dataURL }，用于导出/分享信封（对应小程序 imgpack.pack） */
    async pack(ids) {
      const out = {};
      const uniq = Array.from(new Set((ids || []).filter(Boolean)));
      for (const id of uniq) {
        const u = await this.url(id);
        if (u) out[id] = u;
      }
      return out;
    },

    /** 从 { id: dataURL } 还原，返回 旧id → 新id 的映射（对应 imgpack.unpack） */
    async unpack(map) {
      const idMap = {};
      for (const oldId of Object.keys(map || {})) {
        idMap[oldId] = await this.save(String(map[oldId]));
      }
      return idMap;
    }
  }
};

export default store;
