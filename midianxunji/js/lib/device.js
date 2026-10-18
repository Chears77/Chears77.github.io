import store from '../store.js';
/**
 * device.js —— 免登录方案：生成并维护本机唯一标识
 * 用于把「我的攻略」存在云数据库时区分归属（不涉及任何个人信息）
 */
const STORAGE_KEY = 'device_id';

function genId() {
  return 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function getDeviceId() {
  let id = '';
  try {
    id = store.get(STORAGE_KEY);
  } catch (e) { /* ignore */ }
  if (!id) {
    id = genId();
    try {
      store.set(STORAGE_KEY, id);
    } catch (e) { /* ignore */ }
  }
  return id;
}

export default { getDeviceId };
