import type { FastifyInstance, FastifyRequest } from "fastify";
import { request } from "undici";
import { appConfigSchema, providerSchema, type AppConfig, type ProviderConfig } from "./types.js";
import {
  listProfiles,
  getActiveProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile
} from "./store.js";
import { readEnv, trimTrailingSlash } from "./config.js";
import { getMetricsSnapshot } from "./metrics.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

interface ProfileBody { name: string; config: AppConfig; }
interface ActivateBody { id: string; }
interface ModelsBody { provider: ProviderConfig; apiKey?: string; }

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/profiles", async () => {
    const profiles = await listProfiles();
    const active = (await getActiveProfile())?.id ?? null;
    return { profiles, activeProfileId: active };
  });

  app.post("/api/admin/profiles", async (req: FastifyRequest<{ Body: ProfileBody }>, reply) => {
    const body = normalizeProfileBody(req.body);
    if (!body.ok) {
      reply.code(400);
      return body;
    }

    const p = await createProfile(body.name, body.config);
    return { ok: true, profile: p };
  });

  app.put("/api/admin/profiles/:id", async (req: FastifyRequest<{ Body: ProfileBody; Params: { id: string } }>, reply) => {
    const body = normalizeProfileBody(req.body);
    if (!body.ok) {
      reply.code(400);
      return body;
    }

    const p = await updateProfile(req.params.id, body.name, body.config);
    return p ? { ok: true, profile: p } : { ok: false, error: "not found" };
  });

  app.delete("/api/admin/profiles/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const ok = await deleteProfile(req.params.id);
    return { ok };
  });

  app.post("/api/admin/profiles/activate", async (req: FastifyRequest<{ Body: ActivateBody }>) => {
    const ok = await activateProfile(req.body.id);
    return ok ? { ok: true } : { ok: false, error: "not found" };
  });

  app.post("/api/admin/upstream-models", async (req: FastifyRequest<{ Body: ModelsBody }>, reply) => {
    const parsed = providerSchema.safeParse(req.body?.provider);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map(formatIssue).join("; ") };
    }

    const result = await fetchUpstreamModels(parsed.data, req.body?.apiKey);
    if (!result.ok) {
      reply.code(result.statusCode);
    }

    return result;
  });

  // 性能指标
  app.get("/api/admin/metrics", async () => {
    return getMetricsSnapshot();
  });

  // 释放当前端口（用于重启前清理）
  app.post("/api/admin/kill-port", async () => {
    const { killProcessOnPort } = await import("./index.js");
    const port = app.server.address() && typeof app.server.address() === "object"
      ? (app.server.address() as { port: number }).port
      : null;
    if (port) {
      // 先关闭当前服务器，再杀掉端口上残留的进程
      try { await app.close(); } catch { /* 忽略 */ }
      killProcessOnPort(port);
      // 退出进程，tsx watch 检测到退出后会重启
      setTimeout(() => process.exit(0), 200);
      return { ok: true, message: `端口 ${port} 已释放，服务器正在退出（watch 模式将自动重启）` };
    }
    return { ok: false, error: "无法获取当前服务器端口" };
  });
}

type NormalizedProfileBody =
  | { ok: true; name: string; config: AppConfig }
  | { ok: false; error: string };

function normalizeProfileBody(body: ProfileBody | undefined): NormalizedProfileBody {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return { ok: false, error: "配置方案名称不能为空" };
  }

  const parsed = appConfigSchema.safeParse(body?.config);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map(formatIssue).join("; ") };
  }

  const referenceError = findProviderReferenceError(parsed.data);
  if (referenceError) {
    return { ok: false, error: referenceError };
  }

  return { ok: true, name, config: parsed.data };
}

function formatIssue(issue: { path: (string | number)[]; message: string }): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "config";
  return `${path}: ${issue.message}`;
}

function findProviderReferenceError(config: AppConfig): string | null {
  for (const route of config.routes) {
    if (!config.providers[route.provider]) {
      return `路由引用了不存在的 Provider: ${route.provider}`;
    }

    for (const fallback of route.fallback) {
      if (!config.providers[fallback.provider]) {
        return `Fallback 引用了不存在的 Provider: ${fallback.provider}`;
      }
    }
  }

  return null;
}

type UpstreamModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string; statusCode: number };

async function fetchUpstreamModels(provider: ProviderConfig, inlineApiKey?: string): Promise<UpstreamModelsResult> {
  const baseUrl = provider.baseUrl ?? readEnv(provider.baseUrlEnv);
  if (!baseUrl) {
    return { ok: false, statusCode: 400, error: provider.baseUrlEnv ? `环境变量 ${provider.baseUrlEnv} 未设置` : "上游地址不能为空" };
  }
  const modelsUrl = resolveModelsUrl(provider, baseUrl);

  const apiKey = provider.apiKey ?? inlineApiKey?.trim() ?? readEnv(provider.apiKeyEnv);
  if (!apiKey) {
    return { ok: false, statusCode: 400, error: "未提供 API Key" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 120_000);

  try {
    const response = await request(modelsUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`
      }
    });
    const text = await response.body.text();

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        ok: false,
        statusCode: 502,
        error: `上游模型列表请求失败: ${modelsUrl} HTTP ${response.statusCode}${text ? ` ${truncate(text, 180)}` : ""}`
      };
    }

    const models = extractModelIds(JSON.parse(text));
    return { ok: true, models };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, statusCode: 504, error: "获取上游模型列表超时" };
    }
    return {
      ok: false,
      statusCode: 502,
      error: `获取上游模型失败: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractModelIds(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  const models = data
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && typeof item.id === "string") return item.id;
      return null;
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
}

function resolveModelsUrl(provider: ProviderConfig, baseUrl: string): string {
  if (provider.modelsUrl) {
    return provider.modelsUrl;
  }

  const trimmedBaseUrl = trimTrailingSlash(baseUrl);
  if (trimmedBaseUrl.endsWith("/anthropic")) {
    return `${trimmedBaseUrl.slice(0, -"/anthropic".length)}/models`;
  }

  return `${trimmedBaseUrl}/v1/models`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminHtml = readFileSync(join(__dirname, "admin.html"), "utf-8");

export function adminPageHtml(): string {
  return adminHtml;
}
