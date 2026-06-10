import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ProxyError, sendAnthropicError } from "./errors.js";
import { filterUnsupportedContentBlocks } from "./contentBlocks.js";
import { acquireUpstreamSlot, callAnthropicUpstream, releaseUpstreamSlot } from "./http.js";
import { restoreResponseModel, rewriteRequestModel, rewriteSseChunkText } from "./modelRewrite.js";
import { normalizeUpstreamBody } from "./requestNormalize.js";
import { listExternalModels, matchRoute } from "./router.js";
import type { AppConfig, MatchedRoute, ResolvedRouteTarget } from "./types.js";
import { adminPageHtml, registerAdminRoutes } from "./admin.js";
import { isObject } from "./util.js";
import { recordRequestDone, recordRequestStart } from "./metrics.js";

type AnthropicMessagesBody = {
  model?: unknown;
  stream?: unknown;
  [key: string]: unknown;
};

function createLogger() {
  const isDev = process.env.NODE_ENV !== "production";
  const level = process.env.LOG_LEVEL ?? "info";

  const baseConfig = {
    level,
    redact: ["req.headers.authorization", "req.headers.x-api-key", "req.headers.*api*key"]
  };

  if (!isDev) {
    return baseConfig;
  }

  // 开发环境使用 pino-pretty 输出人类可读日志
  return {
    ...baseConfig,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname"
      }
    }
  };
}

export function printStartupBanner(app: FastifyInstance, config: AppConfig, adminUrl: string): void {
  const lines = [
    "",
    "══════════════════════════════════════════════════════",
    "  Claude Code DeepSeek Proxy",
    "══════════════════════════════════════════════════════",
    `  监听地址:  http://${config.server.host}:${config.server.port}`,
    `  管理后台:  ${adminUrl}`,
    `  认证方式:  ${config.server.authToken ? "已设置" : config.server.authTokenEnv ? `环境变量 $${config.server.authTokenEnv}` : "无（未启用）"}`,
    `  上游 Provider:`,
  ];

  for (const [name, provider] of Object.entries(config.providers)) {
    lines.push(`    - ${name}: ${provider.baseUrl ?? `$${provider.baseUrlEnv}`}`);
  }

  lines.push(
    "  路由规则:",
    ...config.routes.map((route) => {
      const match = route.match.exact
        ? `exact "${route.match.exact}"`
        : `prefix "${route.match.prefix}*"`;
      const fallback = route.fallback.length > 0
        ? `  (fallback: ${route.fallback.map((f) => f.provider).join(", ")})`
        : "";
      return `    ${match}  →  ${route.provider}/${route.upstreamModel}${fallback}`;
    }),
    "══════════════════════════════════════════════════════",
    ""
  );

  app.log.info(lines.join("\n"));
}

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLogger(),
    disableRequestLogging: true,       // 关闭 Fastify 默认的每次请求日志，我们自己在 proxyWithFallback 里打
    connectionTimeout: 30_000,
    keepAliveTimeout: 60_000,
    requestTimeout: 300_000,
    bodyLimit: 10 * 1024 * 1024        // 10MB 上限，防止超大上下文撑爆内存
  });

  await app.register(cors, {
    origin: false
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProxyError) {
      return sendAnthropicError(reply, error);
    }

    _request.log.error({ err: error }, "Unhandled request error");
    return sendAnthropicError(reply, error);
  });

  app.addHook("preHandler", async (request) => {
    // 管理页面和 API 不要求认证
    if (request.url === "/healthz" || request.url === "/admin" || request.url.startsWith("/api/admin")) {
      return;
    }

    authenticate(config, request);
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/models", async () => ({
    data: listExternalModels(config).map((id) => ({
      id,
      type: "model",
      display_name: id
    })),
    has_more: false
  }));

  app.post("/v1/messages", async (request, reply) => {
    const body = parseMessagesBody(request.body);
    const route = matchRoute(config, body.model);
    return proxyWithFallback(request, reply, route, "/v1/messages", body);
  });

  app.post("/v1/messages/count_tokens", async (request, reply) => {
    const body = parseMessagesBody(request.body);
    const route = matchRoute(config, body.model);
    return proxyWithFallback(request, reply, route, "/v1/messages/count_tokens", body);
  });

  // ── 管理后台 ──
  app.get("/admin", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return adminPageHtml();
  });

  await registerAdminRoutes(app);

  return app;
}

function authenticate(config: AppConfig, request: FastifyRequest): void {
  const expected = config.server.authToken ?? (config.server.authTokenEnv ? process.env[config.server.authTokenEnv] : undefined);
  if (!expected && !config.server.authTokenEnv) {
    return; // 未配置鉴权，跳过
  }
  if (!expected) {
    throw new ProxyError(500, "api_error", config.server.authToken
      ? "Server authToken is empty"
      : `Environment variable ${config.server.authTokenEnv} is not set`);
  }

  const provided = extractAuthToken(request);
  if (provided !== expected) {
    throw new ProxyError(401, "authentication_error", "Invalid proxy API key");
  }
}

function extractAuthToken(request: FastifyRequest): string | undefined {
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string") {
    return apiKey;
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return undefined;
}

async function proxyWithFallback(
  request: FastifyRequest,
  reply: FastifyReply,
  route: MatchedRoute,
  path: string,
  body: AnthropicMessagesBody
): Promise<FastifyReply | void> {
  const targets = [route.primary, ...route.fallback];
  let lastError: unknown;
  let responseStatus = 500;
  const startTime = Date.now();
  const isStream = body.stream === true;
  // 共享标记，防止 sendUpstreamResponse 异常后重复记录
  const metricDone = { value: false };
  recordRequestStart();

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const isFallback = index > 0;
    let upstream: Awaited<ReturnType<typeof callAnthropicUpstream>> | undefined;
    let slotAcquired = false;

    try {
      // 连接槽位生命周期：从请求发出到响应体完全消费（含 SSE 流）
      acquireUpstreamSlot(target.provider);
      slotAcquired = true;

      request.log.info(
        { model: route.externalModel, provider: target.provider, upstream: target.upstreamModel, fb: isFallback || undefined },
        "→ upstream"
      );

      const { filtered: filteredBlocks, body: cleanedBody } = filterUnsupportedContentBlocks(
        body,
        target.providerConfig
      );
      if (filteredBlocks.length > 0) {
        request.log.warn(
          { filtered: filteredBlocks, provider: target.provider, model: route.externalModel },
          "已过滤不支持的内容块，已在消息中注入提示文本"
        );
      }
      const upstreamBody = normalizeUpstreamBody(rewriteRequestModel(cleanedBody, target.upstreamModel));
      upstream = await callAnthropicUpstream(target, path, upstreamBody, {
        accept: headerToString(request.headers.accept),
        "anthropic-version": headerToString(request.headers["anthropic-version"]),
        "anthropic-beta": headerToString(request.headers["anthropic-beta"])
      });

      if ((upstream.statusCode >= 500 || upstream.statusCode === 429) && index < targets.length - 1) {
        lastError = new ProxyError(502, "api_error", `Upstream "${target.provider}" returned ${upstream.statusCode}`);
        await upstream.body.dump();
        continue;
      }

      responseStatus = upstream.statusCode;
      return sendUpstreamResponse(reply, upstream, route.externalModel, {
        startTime,
        provider: target.provider,
        stream: isStream,
        done: metricDone
      });
    } catch (error) {
      lastError = error;
      if (index === targets.length - 1) {
        break;
      }

      // 确保异常时上游响应体被消费，释放底层连接
      if (upstream?.body) {
        await upstream.body.dump().catch(() => {});
      }

      request.log.warn(
        {
          err: error,
          failedProvider: target.provider,
          nextProvider: targets[index + 1].provider
        },
        "Trying configured fallback provider"
      );
    } finally {
      if (slotAcquired) releaseUpstreamSlot();
    }
  }

  if (!metricDone.value) {
    recordRequestDone({
      latencyMs: Date.now() - startTime,
      status: responseStatus >= 400 ? responseStatus : 500,
      inputTokens: 0,
      outputTokens: 0,
      stream: isStream,
      provider: route.primary.provider,
      model: route.externalModel
    });
  }

  return sendAnthropicError(reply, lastError ?? new ProxyError(502, "api_error", "All upstream providers failed"));
}

async function sendUpstreamResponse(
  reply: FastifyReply,
  upstream: Awaited<ReturnType<typeof callAnthropicUpstream>>,
  externalModel: string,
  metric: { startTime: number; provider: string; stream: boolean; done: { value: boolean } }
): Promise<FastifyReply | void> {
  const contentType = headerToString(upstream.headers["content-type"]) ?? "application/json";
  reply.status(upstream.statusCode);
  reply.header("content-type", contentType);

  if (contentType.includes("text/event-stream")) {
    let inputTokens = 0;
    let outputTokens = 0;
    reply.header("cache-control", "no-cache");
    reply.header("connection", "keep-alive");

    let buffered = "";
    for await (const chunk of upstream.body) {
      buffered +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const eventBoundary = buffered.lastIndexOf("\n\n");
      if (eventBoundary === -1) {
        continue;
      }

      const complete = buffered.slice(0, eventBoundary + 2);
      buffered = buffered.slice(eventBoundary + 2);
      // 从 message_stop 事件中提取 usage（轻量解析，不做全量 JSON 反序列化）
      extractUsageFromSse(complete, (i, o) => { inputTokens = i; outputTokens = o; });
      reply.raw.write(rewriteSseChunkText(complete, externalModel));
    }

    if (buffered.length > 0) {
      extractUsageFromSse(buffered, (i, o) => { inputTokens = i; outputTokens = o; });
      reply.raw.write(rewriteSseChunkText(buffered, externalModel));
    }

    reply.raw.end();

    metric.done.value = true;
    recordRequestDone({
      latencyMs: Date.now() - metric.startTime,
      status: upstream.statusCode,
      inputTokens,
      outputTokens,
      stream: true,
      provider: metric.provider,
      model: externalModel
    });
    return;
  }

  const text = await upstream.body.text();

  // 从 JSON 响应中提取 usage
  let inputTokens = 0;
  let outputTokens = 0;
  if (contentType.includes("application/json") && text.trim() !== "") {
    try {
      const parsed = JSON.parse(text);
      if (isObject(parsed.usage)) {
        inputTokens = Number(parsed.usage.input_tokens) || 0;
        outputTokens = Number(parsed.usage.output_tokens) || 0;
      }
    } catch { /* 忽略解析失败 */ }
  }

  metric.done.value = true;
  recordRequestDone({
    latencyMs: Date.now() - metric.startTime,
    status: upstream.statusCode,
    inputTokens,
    outputTokens,
    stream: false,
    provider: metric.provider,
    model: externalModel
  });

  if (!contentType.includes("application/json") || text.trim() === "") {
    return reply.send(text);
  }

  try {
    return reply.send(restoreResponseModel(JSON.parse(text), externalModel));
  } catch {
    return reply.send(text);
  }
}

function parseMessagesBody(value: unknown): AnthropicMessagesBody & { model: string } {
  if (!isObject(value)) {
    throw new ProxyError(400, "invalid_request_error", "Request body must be a JSON object");
  }

  if (typeof value.model !== "string" || value.model.length === 0) {
    throw new ProxyError(400, "invalid_request_error", "Request body must include a non-empty model");
  }

  return value as AnthropicMessagesBody & { model: string };
}

/** 从 SSE 事件文本中提取 message_stop 的 usage 信息（轻量，不做完整 JSON 解析） */
function extractUsageFromSse(eventText: string, setUsage: (input: number, output: number) => void): void {
  const lines = eventText.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    const data = line.slice("data: ".length);
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "message_stop" && isObject(parsed.usage)) {
        setUsage(Number(parsed.usage.input_tokens) || 0, Number(parsed.usage.output_tokens) || 0);
        return; // 只取第一个 message_stop
      }
    } catch { /* 忽略解析失败 */ }
  }
}

function headerToString(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.join(",");
  }

  if (typeof value === "number") {
    return String(value);
  }

  return value;
}

