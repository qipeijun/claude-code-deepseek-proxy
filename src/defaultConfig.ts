import type { AppConfig } from "./types.js";

// 内置默认配置 — 在没有任何存储方案时使用。
// 不包含 API Key，需通过 admin 页面 http://127.0.0.1:8787/admin 配置。
export const defaultConfig: AppConfig = {
  server: {
    host: "127.0.0.1",
    port: 8787
  },
  providers: {},
  routes: []
};
