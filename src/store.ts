import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./types.js";

// ── 类型 ──

export interface ConfigProfile {
  id: string;
  name: string;
  config: AppConfig;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  activeProfileId: string | null;
  profiles: ConfigProfile[];
}

// ── 存储路径 ──

const storePath = process.env.CONFIG_STORE_PATH ?? "./config-store.json";

// ── 内部读写 ──

async function readStore(): Promise<StoreData> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);

    // 轻量结构校验：防止手工编辑 JSON 写错字段名导致深层 TypeError
    if (!isRecord(parsed) || !Array.isArray(parsed.profiles)) {
      console.warn(
        `[store] ${storePath} 缺少 profiles 数组字段，将使用空配置（请检查文件格式）`
      );
      return { activeProfileId: null, profiles: [] };
    }

    return {
      activeProfileId: typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : null,
      profiles: parsed.profiles as ConfigProfile[]
    };
  } catch (error) {
    // ENOENT 是首次启动的正常状态
    if (isNodeError(error) && error.code === "ENOENT") {
      return { activeProfileId: null, profiles: [] };
    }
    console.warn(
      `[store] 读取 ${storePath} 失败（将使用空配置）:`,
      error instanceof Error ? error.message : String(error)
    );
    return { activeProfileId: null, profiles: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

// 写锁：串行化所有 read-modify-write 操作
let writeLock: Promise<void> = Promise.resolve();

/**
 * 原子更新：锁内完成 read → modify → write，防并发覆盖。
 * fn 接收当前 StoreData，原地修改后返回需要对外暴露的结果。
 */
async function atomicUpdate<T>(fn: (store: StoreData) => T): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolve) => { release = resolve; });

  await prev;
  try {
    const store = await readStore();
    const result = fn(store);
    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
    return result;
  } finally {
    release!();
  }
}

// ── 公开 API ──

export async function listProfiles(): Promise<ConfigProfile[]> {
  // 只读，无需加锁
  const store = await readStore();
  return store.profiles;
}

export async function getActiveProfile(): Promise<ConfigProfile | null> {
  const store = await readStore();
  if (!store.activeProfileId) return null;
  return store.profiles.find((p) => p.id === store.activeProfileId) ?? null;
}

export async function getProfile(id: string): Promise<ConfigProfile | null> {
  const store = await readStore();
  return store.profiles.find((p) => p.id === id) ?? null;
}

export async function createProfile(name: string, config: AppConfig): Promise<ConfigProfile> {
  return atomicUpdate((store) => {
    const now = new Date().toISOString();
    const profile: ConfigProfile = {
      id: randomUUID(),
      name,
      config,
      createdAt: now,
      updatedAt: now
    };
    store.profiles.push(profile);

    // 第一个 profile 自动激活
    if (!store.activeProfileId) {
      store.activeProfileId = profile.id;
    }

    return profile;
  });
}

export async function updateProfile(id: string, name: string, config: AppConfig): Promise<ConfigProfile | null> {
  return atomicUpdate((store) => {
    const idx = store.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    store.profiles[idx] = {
      ...store.profiles[idx],
      name,
      config,
      updatedAt: new Date().toISOString()
    };

    return store.profiles[idx];
  });
}

export async function deleteProfile(id: string): Promise<boolean> {
  return atomicUpdate((store) => {
    const idx = store.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    store.profiles.splice(idx, 1);

    if (store.activeProfileId === id) {
      store.activeProfileId = store.profiles[0]?.id ?? null;
    }

    return true;
  });
}

export async function activateProfile(id: string): Promise<boolean> {
  return atomicUpdate((store) => {
    if (!store.profiles.some((p) => p.id === id)) return false;

    store.activeProfileId = id;
    return true;
  });
}
