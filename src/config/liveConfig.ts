import type { AppConfig } from "../types.js";
import { getActiveProfile } from "./store.js";
import { defaultConfig } from "./defaultConfig.js";

// 模块级可变配置引用，替代 buildServer 闭包中的固化 config 快照。
// server.ts 的路由处理函数每次请求时调用 getConfig() 获取最新配置。
let currentConfig: AppConfig = defaultConfig;

/** 返回当前配置（每次请求时调用，支持热更新） */
export function getConfig(): AppConfig {
  return currentConfig;
}

/** 从持久化存储重新加载配置（admin API 保存方案后调用） */
export async function reloadConfig(): Promise<AppConfig> {
  const profile = await getActiveProfile();
  currentConfig = profile?.config ?? defaultConfig;
  return currentConfig;
}

/** 启动时首次加载配置。数据库异常时降级到默认空配置，确保服务至少能启动。 */
export async function initConfig(): Promise<AppConfig> {
  try {
    return await reloadConfig();
  } catch (err) {
    console.error(
      "[config] 无法从存储加载配置，将使用内置默认空配置:",
      err instanceof Error ? err.message : String(err),
    );
    currentConfig = defaultConfig;
    return defaultConfig;
  }
}
