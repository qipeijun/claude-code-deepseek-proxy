import { execSync } from "child_process";
import { defaultConfig } from "./defaultConfig.js";
import { getActiveProfile } from "./store.js";
import { buildServer, printStartupBanner } from "./server.js";

// ── CLI 参数 ──
const killPort = process.argv.includes("--kill-port");

// 优先使用持久化存储的活动方案，没有则使用内置默认配置
const profile = await getActiveProfile();
const configSource = profile ? `存储方案 "${profile.name}"` : "内置默认配置（空）";
const config = profile ? profile.config : defaultConfig;
const port = config.server.port;
const adminUrl = `http://${config.server.host}:${port}/admin`;

// ── 强制释放端口 ──
if (killPort) {
  killProcessOnPort(port);
}

const app = await buildServer(config);

printStartupBanner(app, config, adminUrl);

// ── 优雅关闭 ──
const shutdown = async (signal: string) => {
  app.log.info(`收到 ${signal}，正在关闭服务...`);
  try {
    await app.close();
  } catch {
    // 忽略关闭过程中的错误
  }
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await app.listen({
  host: config.server.host,
  port
});

app.log.info(`配置来源: ${configSource}`);

if (config.routes.length === 0) {
  app.log.warn("══════════════════════════════════════════════════════");
  app.log.warn("  当前没有任何路由规则，代理无法转发请求。");
  app.log.warn(`  请打开管理后台 ${adminUrl} 完成配置后重启服务。`);
  app.log.warn("══════════════════════════════════════════════════════");
}

app.log.info("服务已启动");

// ── 释放端口工具函数 ──
export function killProcessOnPort(p: number): void {
  try {
    const stdout = execSync(`lsof -ti :${p}`, { encoding: "utf8" });
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (pids.length > 0) {
      console.log(`端口 ${p} 被进程 ${pids.join(", ")} 占用，正在释放...`);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`);
        } catch {
          // 继续处理下一个
        }
      }
      console.log(`端口 ${p} 已释放`);
    }
  } catch {
    // lsof 没找到进程会以非 0 退出，说明端口空闲，这是正常情况
  }
}
