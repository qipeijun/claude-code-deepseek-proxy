/* ═══════════════════════════════════════════════════════
   发布/订阅状态管理 — 替代散落的全局变量
   ═══════════════════════════════════════════════════════ */

export function createStore(initial) {
  const listeners = new Map();
  const data = { ...initial };

  return {
    get(key) {
      return data[key];
    },

    set(key, value) {
      data[key] = value;
      const subs = listeners.get(key);
      if (subs) subs.forEach(fn => fn(value));
    },

    on(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => {
        listeners.get(key)?.delete(fn);
      };
    },

    /** 直接读取内部数据（用于需要一次取多个值的场景） */
    data
  };
}

/** 应用级单例 store */
export const store = createStore({
  profiles: [],
  activeProfileId: null,
  currentId: null,
  dirty: false,
  modelsByProvider: {},
  currentStep: 1,
  currentTab: 'dashboard'
});
