import { execSync } from "child_process";

/**
 * 强制释放指定端口上的所有进程（查找并 kill -9），然后轮询等待端口真正空闲。
 */
export function killProcessOnPort(p: number): void {
  // ── 1. 查找并杀死占用进程 ──
  let killed = false;
  try {
    const stdout = execSync(`lsof -ti :${p} -sTCP:LISTEN`, { encoding: "utf8" });
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (pids.length > 0) {
      console.log(`端口 ${p} 被进程 ${pids.join(", ")} 占用，正在释放...`);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`);
          killed = true;
        } catch {
          console.warn(`无法终止进程 ${pid}（可能需要 sudo）`);
        }
      }
    }
  } catch {
    // lsof 没找到 LISTEN 进程，端口空闲
  }

  if (!killed) {
    // 端口本来就是空闲的
    return;
  }

  // ── 2. 轮询等待端口真正释放（期间也可能有 tsx watch 自动重启） ──
  const maxWaitMs = 8000;
  const intervalMs = 300;
  const start = Date.now();
  let retryKill = 0;

  while (Date.now() - start < maxWaitMs) {
    try {
      const stdout = execSync(`lsof -ti :${p} -sTCP:LISTEN`, { encoding: "utf8", stdio: "pipe" });
      const pids = stdout.trim().split("\n").filter(Boolean);
      if (pids.length > 0) {
        // 端口又被占了（可能是 watch 模式自动重启），再次尝试 kill
        retryKill++;
        if (retryKill === 1) {
          console.log(`检测到新进程 ${pids.join(", ")} 占用端口，再次释放...`);
        }
        for (const pid of pids) {
          try { execSync(`kill -9 ${pid}`); } catch { /* ignore */ }
        }
      }
    } catch {
      // lsof 失败 → 端口已空闲
      const waited = Date.now() - start;
      if (waited > 100) console.log(`端口 ${p} 已释放`);
      return;
    }
    execSync(`sleep ${(intervalMs / 1000).toFixed(2)}`);
  }

  // ── 3. 超时仍未释放 ──
  console.error(`端口 ${p} 在 ${maxWaitMs}ms 内未能释放`);
  console.error("可能有其他进程在自动重启（如 tsx watch），请先停止后再启动");
  process.exit(1);
}
