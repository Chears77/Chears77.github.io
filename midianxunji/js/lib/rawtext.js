import store from '../store.js';
/**
 * utils/rawtext.js —— 攻略原文备份
 *
 * 背景：云端攻略记录（mapStore / mapList）不一定带 rawText 字段，
 * 而「最近浏览 → 攻略」要看的就是原文。这里用一份本机小字典把原文按
 * 「记录 id / 攻略名」双索引存起来，云端那份没原文时用它兜底。
 */
const KEY = 'raw_text_store';
const MAX = 80;

function all() {
  try { return store.get(KEY) || {}; } catch (e) { return {}; }
}

/** 保存原文：cands 为候选索引（_id、_localId、攻略名） */
function save(cands, text) {
  if (!text) return;
  const s = all();
  (cands || []).forEach((k) => {
    if (k == null || k === '') return;
    s[String(k)] = text;
  });
  const keys = Object.keys(s);
  if (keys.length > MAX) {
    keys.slice(0, keys.length - MAX).forEach(k => { delete s[k]; });
  }
  try { store.set(KEY, s); } catch (e) { /* ignore */ }
}

/** 取原文：按候选索引顺序找 */
function get(cands) {
  const s = all();
  for (const k of (cands || [])) {
    if (k == null || k === '') continue;
    const v = s[String(k)];
    if (v) return v;
  }
  return '';
}

export default { save, get };
