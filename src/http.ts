import { Agent, request } from "undici";
import { ProxyError } from "./errors.js";
import type { ResolvedRouteTarget } from "./types.js";

export type UpstreamResponse = Awaited<ReturnType<typeof request>>;

// 按 baseUrl 缓存 Agent 实例，复用 TCP + TLS 连接
const agentCache = new Map<string, Agent>();

// 通过环境变量调整并发连接数上限（每个上游 origin），默认 32
const MAX_CONNECTIONS = resolvePoolSize(process.env.UPSTREAM_MAX_CONNECTIONS, 32);

function resolvePoolSize(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    console.warn(`[http] UPSTREAM_MAX_CONNECTIONS="${raw}" 无效，使用默认值 ${fallback}`);
    return fallback;
  }
  return n;
}
// keep-alive 空闲保持时间，5 分钟
const KEEP_ALIVE_TIMEOUT = 300_000;
// 连接建立超时，超过此时间 undici 内部会超时
const CONNECT_TIMEOUT = 30_000;

// 当前活跃的上游请求数（生命周期覆盖整个请求，含 SSE 流传输期间）
let activeUpstreamCount = 0;

export function getUpstreamPoolStats(): { active: number; max: number } {
  return { active: activeUpstreamCount, max: MAX_CONNECTIONS };
}

/** 尝试占一个上游连接槽位。池满时抛 503，≥80% 时打警告。 */
export function acquireUpstreamSlot(providerName: string): void {
  if (activeUpstreamCount >= MAX_CONNECTIONS) {
    throw new ProxyError(
      503,
      "overloaded_error",
      `Upstream "${providerName}" connection pool exhausted (${activeUpstreamCount}/${MAX_CONNECTIONS})`
    );
  }

  if (activeUpstreamCount >= MAX_CONNECTIONS * 0.8) {
    console.warn(`[http] ${providerName} pool ${activeUpstreamCount}/${MAX_CONNECTIONS} (≥80%)`);
  }

  activeUpstreamCount += 1;
}

/** 释放上游连接槽位。必须在请求完全结束（含 SSE 流关闭）后调用。 */
export function releaseUpstreamSlot(): void {
  if (activeUpstreamCount > 0) {
    activeUpstreamCount -= 1;
  }
}

function getAgent(baseUrl: string): Agent {
  if (!agentCache.has(baseUrl)) {
    agentCache.set(baseUrl, new Agent({
      connections: MAX_CONNECTIONS,
      pipelining: 1,
      connectTimeout: CONNECT_TIMEOUT,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT,
      keepAliveMaxTimeout: 600_000,
      bodyTimeout: 300_000,     // LLM 长请求 5 分钟
      headersTimeout: 15_000
    }));
  }
  return agentCache.get(baseUrl)!;
}

export async function callAnthropicUpstream(
  target: ResolvedRouteTarget,
  path: string,
  body: unknown,
  headers: Record<string, string | undefined>
): Promise<UpstreamResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), target.providerConfig.timeoutMs);

  try {
    return await request(`${target.providerConfig.baseUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
      dispatcher: getAgent(target.providerConfig.baseUrl),
      headers: buildUpstreamHeaders(target, headers)
    });
  } catch (error) {
    throw new ProxyError(
      502,
      "api_error",
      `Upstream "${target.provider}" request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildUpstreamHeaders(target: ResolvedRouteTarget, headers: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {
    "content-type": "application/json",
    accept: headers.accept ?? "application/json",
    "x-api-key": target.providerConfig.apiKey,
    authorization: `Bearer ${target.providerConfig.apiKey}`
  };

  if (headers["anthropic-version"]) {
    result["anthropic-version"] = headers["anthropic-version"];
  }

  if (headers["anthropic-beta"]) {
    result["anthropic-beta"] = headers["anthropic-beta"];
  }

  return result;
}
