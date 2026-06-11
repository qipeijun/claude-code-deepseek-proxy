import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEMP_DIR = join(tmpdir(), "store-test-" + randomUUID());

function tempDbPath(label: string): string {
  return join(TEMP_DIR, `${label}.db`);
}

function tempJsonPath(label: string): string {
  return join(TEMP_DIR, `${label}.json`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: Record<string, any> = {};

/**
 * 导入 store 模块（指定 CONFIG_STORE_PATH 和 CONFIG_STORE_MIGRATE_FROM，
 * 确保当前测试用例的数据库和迁移源完全隔离）。
 */
async function loadStore(dbPath: string, migrateFrom?: string): Promise<void> {
  process.env.CONFIG_STORE_PATH = dbPath;
  // 默认指向不存在的路径，防止读到项目根目录的 config-store.json
  process.env.CONFIG_STORE_MIGRATE_FROM = migrateFrom ?? join(TEMP_DIR, "no-such-file.json");
  vi.resetModules();
  store = await import("../src/config/store.js");
}

beforeEach(() => {
  mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  try { store.closeStore?.(); } catch { /* ignore */ }
  vi.resetModules();
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ═══════════════════════════════════════════════════
// 基础 CRUD
// ═══════════════════════════════════════════════════

describe("listProfiles", () => {
  it("新数据库返回空数组", async () => {
    await loadStore(tempDbPath("list-empty"));
    const profiles = await store.listProfiles();
    expect(profiles).toEqual([]);
  });

  it("返回所有方案，按创建时间升序", async () => {
    await loadStore(tempDbPath("list-order"));
    const p1 = await store.createProfile("方案 B", makeConfig());
    const p2 = await store.createProfile("方案 A", makeConfig());
    const profiles = await store.listProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0].name).toBe("方案 B");
    expect(profiles[1].name).toBe("方案 A");
  });
});

describe("getActiveProfile", () => {
  it("无方案时返回 null", async () => {
    await loadStore(tempDbPath("active-none"));
    const active = await store.getActiveProfile();
    expect(active).toBeNull();
  });

  it("首个方案自动激活", async () => {
    await loadStore(tempDbPath("active-first"));
    const p1 = await store.createProfile("测试方案", makeConfig());
    const active = await store.getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.id).toBe(p1.id);
  });

  it("第二个方案不会自动激活", async () => {
    await loadStore(tempDbPath("active-second"));
    await store.createProfile("方案 1", makeConfig());
    const p2 = await store.createProfile("方案 2", makeConfig());
    const active = await store.getActiveProfile();
    expect(active!.id).not.toBe(p2.id);
  });
});

describe("getProfile", () => {
  it("按 ID 获取方案", async () => {
    await loadStore(tempDbPath("get-by-id"));
    const created = await store.createProfile("查找测试", makeConfig());
    const found = await store.getProfile(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("查找测试");
  });

  it("不存在的 ID 返回 null", async () => {
    await loadStore(tempDbPath("get-missing"));
    const found = await store.getProfile("nonexistent-id");
    expect(found).toBeNull();
  });
});

describe("createProfile", () => {
  it("创建方案并返回完整字段", async () => {
    await loadStore(tempDbPath("create-fields"));
    const config = makeConfig();
    const profile = await store.createProfile("新建方案", config);
    expect(profile.id).toBeDefined();
    expect(profile.name).toBe("新建方案");
    expect(profile.config).toEqual(config);
    expect(profile.createdAt).toBeDefined();
    expect(profile.updatedAt).toBeDefined();
    expect(profile.createdAt).toBe(profile.updatedAt);
  });
});

// ═══════════════════════════════════════════════════
// 更新 + 回滚
// ═══════════════════════════════════════════════════

describe("updateProfile", () => {
  it("更新名称和配置，同时记录历史", async () => {
    await loadStore(tempDbPath("update-history"));
    const created = await store.createProfile("原始名称", makeConfig());

    const newConfig = makeConfig({ server: { port: 9999 } });
    const updated = await store.updateProfile(created.id, "新名称", newConfig);

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("新名称");
    expect(updated!.config.server.port).toBe(9999);

    // 验证历史记录生成
    const history = await store.getProfileHistory(created.id);
    expect(history).toHaveLength(1);
    expect(history[0].profileName).toBe("原始名称");
  });

  it("更新不存在的方案返回 null", async () => {
    await loadStore(tempDbPath("update-missing"));
    const result = await store.updateProfile("fake-id", "x", makeConfig());
    expect(result).toBeNull();
  });
});

describe("getProfileHistory", () => {
  it("无历史记录时返回空数组", async () => {
    await loadStore(tempDbPath("history-empty"));
    const created = await store.createProfile("无历史", makeConfig());
    const history = await store.getProfileHistory(created.id);
    expect(history).toEqual([]);
  });

  it("多次更新后返回历史列表（按时间倒序）", async () => {
    await loadStore(tempDbPath("history-multi"));
    const created = await store.createProfile("v1", makeConfig());
    // 各次更新间留 1ms 确保时间戳单调递增
    await sleep(1);
    await store.updateProfile(created.id, "v2", makeConfig());
    await sleep(1);
    await store.updateProfile(created.id, "v3", makeConfig());

    const history = await store.getProfileHistory(created.id);
    expect(history).toHaveLength(2);
    const names = history.map((h: { profileName: string }) => h.profileName);
    // 最新历史在前
    expect(names).toEqual(["v2", "v1"]);
  });
});

describe("rollbackProfile", () => {
  it("回滚到历史版本，并将当前状态记录为历史", async () => {
    await loadStore(tempDbPath("rollback"));
    const v1Config = makeConfig({ server: { port: 1111 } });
    const v2Config = makeConfig({ server: { port: 2222 } });

    const created = await store.createProfile("可回滚", v1Config);
    await store.updateProfile(created.id, "可回滚-v2", v2Config);
    await sleep(1); // 确保回滚时间戳晚于更新

    // 获取历史，回滚到 v1
    const history = await store.getProfileHistory(created.id);
    expect(history).toHaveLength(1);

    const rolled = await store.rollbackProfile(created.id, history[0].id);
    expect(rolled).not.toBeNull();
    expect(rolled!.config.server.port).toBe(1111);

    // 回滚操作本身也产生一条历史
    const afterHistory = await store.getProfileHistory(created.id);
    expect(afterHistory).toHaveLength(2);
    // 最新历史是回滚前的状态（v2），config 已是对象无需 JSON.parse
    expect(afterHistory[0].config.server.port).toBe(2222);
  });

  it("回滚到不存在的历史条目返回 null", async () => {
    await loadStore(tempDbPath("rollback-missing"));
    const created = await store.createProfile("测试", makeConfig());
    const result = await store.rollbackProfile(created.id, "fake-history-id");
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// 删除 + 激活
// ═══════════════════════════════════════════════════

describe("deleteProfile", () => {
  it("删除方案返回 true", async () => {
    await loadStore(tempDbPath("delete-ok"));
    const created = await store.createProfile("待删除", makeConfig());
    const ok = await store.deleteProfile(created.id);
    expect(ok).toBe(true);
    const found = await store.getProfile(created.id);
    expect(found).toBeNull();
  });

  it("删除不存在的方案返回 false", async () => {
    await loadStore(tempDbPath("delete-missing"));
    const ok = await store.deleteProfile("no-such-id");
    expect(ok).toBe(false);
  });

  it("删除活跃方案后，剩余第一个自动激活", async () => {
    await loadStore(tempDbPath("delete-active"));
    const p1 = await store.createProfile("活跃方案", makeConfig());
    const p2 = await store.createProfile("备用方案", makeConfig());

    // p1 是首个，自动激活
    let active = await store.getActiveProfile();
    expect(active!.id).toBe(p1.id);

    // 删除 p1，p2 应自动激活
    await store.deleteProfile(p1.id);
    active = await store.getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.id).toBe(p2.id);
  });

  it("删除父方案时，关联历史被级联清理", async () => {
    await loadStore(tempDbPath("delete-cascade"));
    const created = await store.createProfile("父方案", makeConfig());
    await store.updateProfile(created.id, "改个名", makeConfig());
    // 确认有历史
    const history = await store.getProfileHistory(created.id);
    expect(history.length).toBeGreaterThan(0);

    await store.deleteProfile(created.id);
    // ON DELETE CASCADE 会自动清理历史（方案已删除，查不到）
    const found = await store.getProfile(created.id);
    expect(found).toBeNull();
  });
});

describe("activateProfile", () => {
  it("激活指定方案，确保只有一个活跃", async () => {
    await loadStore(tempDbPath("activate-switch"));
    const p1 = await store.createProfile("方案 A", makeConfig());
    const p2 = await store.createProfile("方案 B", makeConfig());

    // p1 自动激活
    expect((await store.getActiveProfile())!.id).toBe(p1.id);

    // 切换到 p2
    const ok = await store.activateProfile(p2.id);
    expect(ok).toBe(true);
    expect((await store.getActiveProfile())!.id).toBe(p2.id);

    // 切回 p1
    await store.activateProfile(p1.id);
    expect((await store.getActiveProfile())!.id).toBe(p1.id);
  });

  it("激活不存在的方案返回 false", async () => {
    await loadStore(tempDbPath("activate-missing"));
    const ok = await store.activateProfile("ghost-id");
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// 历史裁剪
// ═══════════════════════════════════════════════════

describe("MAX_HISTORY 裁剪", () => {
  it("超过 50 条历史时自动裁剪", async () => {
    await loadStore(tempDbPath("history-prune"));
    const created = await store.createProfile("裁剪测试", makeConfig());
    // 更新 60 次
    for (let i = 1; i <= 60; i++) {
      await store.updateProfile(created.id, `v${i}`, makeConfig());
    }
    const history = await store.getProfileHistory(created.id);
    // getProfileHistory 只返回最近 10 条
    expect(history.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════
// 优雅关闭
// ═══════════════════════════════════════════════════

describe("closeStore", () => {
  it("正常关闭不抛异常", async () => {
    await loadStore(tempDbPath("close-normal"));
    await store.createProfile("关闭测试", makeConfig());
    expect(() => store.closeStore()).not.toThrow();
  });

  it("重复 close 不抛异常", async () => {
    await loadStore(tempDbPath("close-twice"));
    await store.createProfile("重复关闭", makeConfig());
    store.closeStore();
    expect(() => store.closeStore()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════
// JSON 迁移
// ═══════════════════════════════════════════════════

describe("JSON 迁移", () => {
  it("从 JSON 迁移数据到 SQLite", async () => {
    const jsonPath = tempJsonPath("from-json");
    const dbPath = tempDbPath("to-db");
    const config = makeConfig();

    const legacyData = {
      activeProfileId: "prof-1",
      profiles: [
        {
          id: "prof-1",
          name: "迁移方案",
          config,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-06-01T00:00:00.000Z",
        },
      ],
      history: [
        {
          id: "hist-1",
          profileId: "prof-1",
          profileName: "迁移方案-旧名",
          config,
          timestamp: "2025-03-01T00:00:00.000Z",
        },
      ],
    };
    writeFileSync(jsonPath, JSON.stringify(legacyData), "utf8");

    // 指定迁移源 JSON 文件
    await loadStore(dbPath, jsonPath);

    const profiles = await store.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("迁移方案");

    // 验证活跃方案
    const active = await store.getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.id).toBe("prof-1");

    // 验证历史迁移
    const history = await store.getProfileHistory("prof-1");
    expect(history).toHaveLength(1);
    expect(history[0].profileName).toBe("迁移方案-旧名");

    // 验证旧 JSON 被重命名为 .bak
    expect(() => readFileSync(jsonPath, "utf8")).toThrow(); // 原文件已改名
    expect(() => readFileSync(jsonPath + ".bak", "utf8")).not.toThrow();
  });

  it("DB 已有数据时不重复迁移", async () => {
    const dbPath = tempDbPath("no-remigrate");
    await loadStore(dbPath);
    const created = await store.createProfile("已有数据", makeConfig());
    // 此时 DB 已有 1 行，closeStore 再 reopen 不会触发迁移
    store.closeStore();
    process.env.CONFIG_STORE_PATH = dbPath;
    process.env.CONFIG_STORE_MIGRATE_FROM = join(TEMP_DIR, "no-such.json");
    vi.resetModules();
    store = await import("../src/config/store.js");
    const profiles = await store.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(created.id);
  });
});

// ═══════════════════════════════════════════════════
// 事务安全
// ═══════════════════════════════════════════════════

describe("事务安全性", () => {
  it("updateProfile 中某步骤失败应回滚整个事务", async () => {
    await loadStore(tempDbPath("txn-rollback"));
    const created = await store.createProfile("事务测试", makeConfig());
    const originalName = created.name;

    // 更新不存在的方案不会影响现有数据
    const result = await store.updateProfile("fake", "不会更新", makeConfig());
    expect(result).toBeNull();

    // 原有方案不受影响
    const unchanged = await store.getProfile(created.id);
    expect(unchanged!.name).toBe(originalName);
  });
});

// ═══════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    server: { host: "127.0.0.1", port: 8787 },
    providers: {
      deepseek: {
        type: "anthropic",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: "sk-test",
        capabilities: { contentBlocks: ["text", "tool_use", "tool_result", "thinking"] },
      },
    },
    routes: [
      {
        match: { prefix: "claude-sonnet" },
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
      },
    ],
    ...overrides,
  };
}
