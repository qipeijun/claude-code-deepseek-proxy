import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "../types.js";

// ── 类型 ──

export interface ConfigProfile {
  id: string;
  name: string;
  config: AppConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigHistoryEntry {
  id: string;
  profileId: string;
  profileName: string;
  config: AppConfig;
  timestamp: string;
}

const MAX_HISTORY = 50;

// ── 数据库文件路径（惰性求值，支持测试切换） ──

function getStorePath(): string {
  return process.env.CONFIG_STORE_PATH ?? "./config-store.db";
}

// ── Schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_active
  ON profiles(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS history (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  config       TEXT NOT NULL,
  timestamp    TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_profile_id ON history(profile_id);
`;

// ── 行类型 ──

interface ProfileRow {
  id: string;
  name: string;
  config: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  profile_id: string;
  profile_name: string;
  config: string;
  timestamp: string;
}

// ── 工具 ──

function isNodeError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

// ── 数据库单例 ──

let db: Database.Database | null = null;
let dbInitError: Error | null = null;

function getDb(): Database.Database {
  if (db) return db;
  // 缓存初始化错误，避免每次 API 调用都尝试重新打开数据库
  if (dbInitError) throw dbInitError;

  try {
    mkdirSync(dirname(getStorePath()), { recursive: true });
    db = new Database(getStorePath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    migrateFromJsonIfNeeded(db);
    return db;
  } catch (err) {
    dbInitError = err instanceof Error ? err : new Error(String(err));
    console.error("[store] 数据库打开失败:", dbInitError.message);
    throw dbInitError;
  }
}

// ── 行映射 ──

function rowToProfile(row: ProfileRow): ConfigProfile | null {
  try {
    return {
      id: row.id,
      name: row.name,
      config: JSON.parse(row.config) as AppConfig,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    console.warn(
      `[store] 跳过配置损坏的方案 ${row.id} (${row.name}):`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function rowToHistoryEntry(row: HistoryRow): ConfigHistoryEntry | null {
  try {
    return {
      id: row.id,
      profileId: row.profile_id,
      profileName: row.profile_name,
      config: JSON.parse(row.config) as AppConfig,
      timestamp: row.timestamp,
    };
  } catch (err) {
    console.warn(
      `[store] 跳过损坏的历史记录 ${row.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ── JSON → SQLite 迁移 ──

function migrateFromJsonIfNeeded(database: Database.Database): void {
  // 检查 profiles 表是否已有数据
  const row = database.prepare("SELECT COUNT(*) as cnt FROM profiles").get() as { cnt: number };
  if (row.cnt > 0) return;

  const jsonPath = process.env.CONFIG_STORE_MIGRATE_FROM ?? "./config-store.json";
  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf8");
  } catch (err) {
    // ENOENT: 无旧 JSON 文件，正常跳过
    if (isNodeError(err) && err.code === "ENOENT") return;
    // 其他错误（权限、磁盘等）：输出警告，运维可感知
    console.warn(
      `[store] 无法读取 JSON 迁移文件 ${jsonPath}:`,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  let data: {
    activeProfileId: string | null;
    profiles: ConfigProfile[];
    history?: ConfigHistoryEntry[];
  };
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn("[store] JSON 迁移文件解析失败，跳过");
    // 将损坏的 JSON 重命名，避免每次启动重复尝试
    try {
      renameSync(jsonPath, jsonPath + ".corrupted");
      console.warn(`[store] 已重命名损坏的配置为 ${jsonPath}.corrupted`);
    } catch {
      // 重命名失败也跳过
    }
    return;
  }

  // 运行时结构校验：防止手工编辑 JSON 写错字段名导致深层 TypeError
  if (!Array.isArray(data.profiles)) {
    console.warn("[store] JSON 迁移文件 profiles 不是数组，跳过。");
    try {
      renameSync(jsonPath, jsonPath + ".corrupted");
      console.warn(`[store] 已重命名损坏的配置为 ${jsonPath}.corrupted`);
    } catch {
      // 重命名失败也跳过
    }
    return;
  }

  if (data.profiles.length === 0) return;

  const insertProfile = database.prepare(
    "INSERT INTO profiles (id, name, config, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertHistory = database.prepare(
    "INSERT INTO history (id, profile_id, profile_name, config, timestamp) VALUES (?, ?, ?, ?, ?)"
  );

  const txn = database.transaction(() => {
    for (const p of data.profiles) {
      insertProfile.run(
        p.id,
        p.name,
        JSON.stringify(p.config),
        p.id === data.activeProfileId ? 1 : 0,
        p.createdAt,
        p.updatedAt,
      );
    }
    for (const h of data.history ?? []) {
      insertHistory.run(h.id, h.profileId, h.profileName, JSON.stringify(h.config), h.timestamp);
    }
  });

  txn();
  console.log(
    `[store] 已从 ${jsonPath} 迁移 ${data.profiles.length} 个方案到 SQLite`,
  );

  // 备份旧 JSON 文件
  try {
    renameSync(jsonPath, jsonPath + ".bak");
    console.log(`[store] 旧配置已备份为 ${jsonPath}.bak`);
  } catch {
    console.warn("[store] 无法备份旧 JSON 文件");
  }
}

// ── 公开 API ──

export async function listProfiles(): Promise<ConfigProfile[]> {
  const rows = getDb()
    .prepare("SELECT * FROM profiles ORDER BY created_at ASC")
    .all() as ProfileRow[];
  return rows.map(rowToProfile).filter((p): p is ConfigProfile => p !== null);
}

export async function getActiveProfile(): Promise<ConfigProfile | null> {
  const row = getDb()
    .prepare("SELECT * FROM profiles WHERE is_active = 1 LIMIT 1")
    .get() as ProfileRow | undefined;
  if (!row) return null;
  return rowToProfile(row) ?? null;
}

export async function getProfile(id: string): Promise<ConfigProfile | null> {
  const row = getDb()
    .prepare("SELECT * FROM profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  if (!row) return null;
  return rowToProfile(row) ?? null;
}

export async function createProfile(
  name: string,
  config: AppConfig,
): Promise<ConfigProfile> {
  const database = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  const txn = database.transaction(() => {
    // 当前无活跃方案时自动激活（与旧逻辑语义对齐）
    const activeRow = database
      .prepare("SELECT COUNT(*) as cnt FROM profiles WHERE is_active = 1")
      .get() as { cnt: number };
    const isActive = activeRow.cnt === 0 ? 1 : 0;

    database
      .prepare(
        "INSERT INTO profiles (id, name, config, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, name, JSON.stringify(config), isActive, now, now);

    return { id, name, config, createdAt: now, updatedAt: now };
  });

  return txn();
}

export async function updateProfile(
  id: string,
  name: string,
  config: AppConfig,
): Promise<ConfigProfile | null> {
  const database = getDb();
  const now = new Date().toISOString();

  const txn = database.transaction(() => {
    const old = database
      .prepare("SELECT * FROM profiles WHERE id = ?")
      .get(id) as ProfileRow | undefined;
    if (!old) return null;

    // 记录历史（保存旧值）
    database
      .prepare(
        "INSERT INTO history (id, profile_id, profile_name, config, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), id, old.name, old.config, now);

    // 裁剪全局历史到 MAX_HISTORY 条
    database
      .prepare(
        `DELETE FROM history WHERE id NOT IN (
          SELECT id FROM history ORDER BY timestamp DESC LIMIT ?
        )`,
      )
      .run(MAX_HISTORY);

    // 更新 profile
    database
      .prepare(
        "UPDATE profiles SET name = ?, config = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, JSON.stringify(config), now, id);

    return { id, name, config, createdAt: old.created_at, updatedAt: now };
  });

  return txn();
}

export async function deleteProfile(id: string): Promise<boolean> {
  const database = getDb();

  const txn = database.transaction(() => {
    const exists = database
      .prepare("SELECT id, is_active FROM profiles WHERE id = ?")
      .get(id) as { id: string; is_active: number } | undefined;
    if (!exists) return false;

    // 删除（ON DELETE CASCADE 自动清理关联 history）
    database.prepare("DELETE FROM profiles WHERE id = ?").run(id);

    // 如果删除的是活跃方案，激活剩余第一个
    if (exists.is_active) {
      database
        .prepare(
          "UPDATE profiles SET is_active = 1 WHERE id = (SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1)",
        )
        .run();
    }

    return true;
  });

  return txn();
}

export async function activateProfile(id: string): Promise<boolean> {
  const database = getDb();

  const txn = database.transaction(() => {
    const exists = database
      .prepare("SELECT COUNT(*) as cnt FROM profiles WHERE id = ?")
      .get(id) as { cnt: number };
    if (exists.cnt === 0) return false;

    // 取消所有活跃 → 激活目标
    database.prepare("UPDATE profiles SET is_active = 0").run();
    database
      .prepare("UPDATE profiles SET is_active = 1 WHERE id = ?")
      .run(id);

    return true;
  });

  return txn();
}

export async function getProfileHistory(
  profileId: string,
): Promise<ConfigHistoryEntry[]> {
  const rows = getDb()
    .prepare(
      "SELECT * FROM history WHERE profile_id = ? ORDER BY timestamp DESC LIMIT 10",
    )
    .all(profileId) as HistoryRow[];
  return rows.map(rowToHistoryEntry).filter((h): h is ConfigHistoryEntry => h !== null);
}

export async function rollbackProfile(
  profileId: string,
  historyId: string,
): Promise<ConfigProfile | null> {
  const database = getDb();
  const now = new Date().toISOString();

  const txn = database.transaction(() => {
    // 查找目标历史条目
    const historyRow = database
      .prepare(
        "SELECT * FROM history WHERE id = ? AND profile_id = ?",
      )
      .get(historyId, profileId) as HistoryRow | undefined;
    if (!historyRow) return null;

    // 查找当前 profile
    const current = database
      .prepare("SELECT * FROM profiles WHERE id = ?")
      .get(profileId) as ProfileRow | undefined;
    if (!current) return null;

    // 回滚前先记录当前状态为历史
    database
      .prepare(
        "INSERT INTO history (id, profile_id, profile_name, config, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), profileId, current.name, current.config, now);

    // 裁剪历史
    database
      .prepare(
        `DELETE FROM history WHERE id NOT IN (
          SELECT id FROM history ORDER BY timestamp DESC LIMIT ?
        )`,
      )
      .run(MAX_HISTORY);

    // 回滚配置（名称不变）
    database
      .prepare("UPDATE profiles SET config = ?, updated_at = ? WHERE id = ?")
      .run(historyRow.config, now, profileId);

    // 返回值用已知值拼装，避免事务内冗余 SELECT
    return {
      id: profileId,
      name: current.name,
      config: JSON.parse(historyRow.config) as AppConfig,
      createdAt: current.created_at,
      updatedAt: now,
    };
  });

  return txn();
}

/**
 * 优雅关闭数据库：执行 WAL checkpoint 合并日志，然后关闭连接。
 * 应在进程退出前调用。
 */
export function closeStore(): void {
  if (!db) return;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  } catch (err) {
    console.error("[store] 数据库关闭失败:", err instanceof Error ? err.message : String(err));
    // 关闭失败不阻止进程退出
  }
  db = null;
}
