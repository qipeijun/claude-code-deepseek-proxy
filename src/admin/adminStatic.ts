/**
 * 管理后台静态文件服务。
 * 启动时预加载所有文件到内存，沿用项目当前"读文件到内存"模式，零额外依赖。
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FastifyInstance } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminDir = __dirname;

interface StaticFile {
  path: string;
  contentType: string;
}

// URL 路径 → { 磁盘相对路径, Content-Type }
const STATIC_FILES: Record<string, StaticFile> = {
  "/admin/style.css": {
    path: join(adminDir, "style.css"),
    contentType: "text/css; charset=utf-8"
  },
  "/admin/js/app.js": {
    path: join(adminDir, "js", "app.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/api.js": {
    path: join(adminDir, "js", "api.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/state.js": {
    path: join(adminDir, "js", "state.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/views/dashboard.js": {
    path: join(adminDir, "js", "views", "dashboard.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/views/config.js": {
    path: join(adminDir, "js", "views", "config.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/ui/toast.js": {
    path: join(adminDir, "js", "ui", "toast.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/ui/metrics.js": {
    path: join(adminDir, "js", "ui", "metrics.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/ui/sidebar.js": {
    path: join(adminDir, "js", "ui", "sidebar.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/ui/providerCards.js": {
    path: join(adminDir, "js", "ui", "providerCards.js"),
    contentType: "application/javascript; charset=utf-8"
  },
  "/admin/js/ui/routes.js": {
    path: join(adminDir, "js", "ui", "routes.js"),
    contentType: "application/javascript; charset=utf-8"
  },
};

// 启动时预加载所有文件到内存
const fileCache = new Map<string, string>();
for (const [url, { path }] of Object.entries(STATIC_FILES)) {
  fileCache.set(url, readFileSync(path, "utf-8"));
}

// admin.html 单独处理
const adminHtml = readFileSync(join(adminDir, "admin.html"), "utf-8");

/** 返回 admin 页面 HTML */
export function adminPageHtml(): string {
  return adminHtml;
}

/** 注册所有管理后台静态文件路由 */
export function registerAdminStaticRoutes(app: FastifyInstance): void {
  for (const [url, { contentType }] of Object.entries(STATIC_FILES)) {
    app.get(url, async (_req, reply) => {
      reply.header("content-type", contentType);
      return fileCache.get(url);
    });
  }
}
