import { killProcessOnPort } from "./killPort.js";
import { initConfig } from "./config/liveConfig.js";
import { buildServer, printStartupBanner } from "./server.js";
import { destroyAgents } from "./proxy/http.js";

// 从持久化存储加载活动方案，没有则使用内置默认配置
const config = await initConfig();
const port = config.server.port;
const adminUrl = `http://${config.server.host}:${port}/admin`;

// ── 启动前自动释放端口 ──
killProcessOnPort(port);

const app = await buildServer();

printStartupBanner(app);

// ── 优雅关闭 ──
// 使用 once 防止重复 Ctrl+C 触发并发 shutdown；关闭流程最长等 5 秒后强制退出
let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) {
    // 再次收到信号，跳过等待，直接强制退出
    app.log.warn(`再次收到 ${signal}，强制退出`);
    process.exit(1);
  }
  shuttingDown = true;

  app.log.info(`收到 ${signal}，正在关闭服务...`);

  // 5 秒超时：SSE 流式请求可能长时间阻塞 app.close()，超时后强制退出
  const forceTimer = setTimeout(() => {
    app.log.warn("关闭超时（5秒），强制退出");
    process.exit(1);
  }, 5000);
  // unref 避免 timer 自身阻止事件循环退出；只要有其他活跃句柄（如 undici 连接），
  // 回调仍会按时触发
  forceTimer.unref();

  app.close().then(() => {
    clearTimeout(forceTimer);
    destroyAgents();
    process.exit(0);
  }).catch(() => {
    clearTimeout(forceTimer);
    destroyAgents();
    process.exit(0);
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

await app.listen({
  host: config.server.host,
  port
});

app.log.info(`配置来源: ${config.routes.length > 0 ? "存储方案" : "内置默认配置（空）"}`);

if (config.routes.length === 0) {
  app.log.warn("══════════════════════════════════════════════════════");
  app.log.warn("  当前没有任何路由规则，代理无法转发请求。");
  app.log.warn(`  请打开管理后台 ${adminUrl} 完成配置后保存即可生效。`);
  app.log.warn("══════════════════════════════════════════════════════");
}

app.log.info("服务已启动");
