import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ProxyError, sendAnthropicError } from "./errors.js";
import { assertSupportedContentBlocks } from "./contentBlocks.js";
import { callAnthropicUpstream } from "./http.js";
import { restoreResponseModel, rewriteRequestModel, rewriteSseChunkText } from "./modelRewrite.js";
import { listExternalModels, matchRoute } from "./router.js";
import type { AppConfig, MatchedRoute, ResolvedRouteTarget } from "./types.js";

type AnthropicMessagesBody = {
  model?: unknown;
  stream?: unknown;
  [key: string]: unknown;
};

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.x-api-key"]
    }
  });

  await app.register(cors, {
    origin: false
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProxyError) {
      return sendAnthropicError(reply, error);
    }

    requestLog(_request).error({ err: error }, "Unhandled request error");
    return sendAnthropicError(reply, error);
  });

  app.addHook("preHandler", async (request) => {
    if (request.url === "/healthz") {
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

  return app;
}

function authenticate(config: AppConfig, request: FastifyRequest): void {
  if (!config.server.authTokenEnv) {
    return;
  }

  const expected = process.env[config.server.authTokenEnv];
  if (!expected) {
    throw new ProxyError(500, "api_error", `Environment variable ${config.server.authTokenEnv} is required for local auth`);
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

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const isFallback = index > 0;

    try {
      requestLog(request).info(
        {
          externalModel: route.externalModel,
          provider: target.provider,
          upstreamModel: target.upstreamModel,
          fallback: isFallback
        },
        "Proxying Anthropic request"
      );

      assertSupportedContentBlocks(body, target.providerConfig);
      const upstreamBody = rewriteRequestModel(body, target.upstreamModel);
      const upstream = await callAnthropicUpstream(target, path, upstreamBody, {
        accept: headerToString(request.headers.accept),
        "anthropic-version": headerToString(request.headers["anthropic-version"]),
        "anthropic-beta": headerToString(request.headers["anthropic-beta"])
      });

      if ((upstream.statusCode >= 500 || upstream.statusCode === 429) && index < targets.length - 1) {
        lastError = new ProxyError(502, "api_error", `Upstream "${target.provider}" returned ${upstream.statusCode}`);
        await upstream.body.dump();
        continue;
      }

      return sendUpstreamResponse(reply, upstream, route.externalModel);
    } catch (error) {
      lastError = error;
      if (index === targets.length - 1) {
        break;
      }

      requestLog(request).warn(
        {
          err: error,
          failedProvider: target.provider,
          nextProvider: targets[index + 1].provider
        },
        "Trying configured fallback provider"
      );
    }
  }

  return sendAnthropicError(reply, lastError ?? new ProxyError(502, "api_error", "All upstream providers failed"));
}

async function sendUpstreamResponse(reply: FastifyReply, upstream: Awaited<ReturnType<typeof callAnthropicUpstream>>, externalModel: string): Promise<FastifyReply | void> {
  const contentType = headerToString(upstream.headers["content-type"]) ?? "application/json";
  reply.status(upstream.statusCode);
  reply.header("content-type", contentType);

  if (contentType.includes("text/event-stream")) {
    reply.header("cache-control", "no-cache");
    reply.header("connection", "keep-alive");

    let buffered = "";
    for await (const chunk of upstream.body) {
      buffered += Buffer.from(chunk).toString("utf8");
      const eventBoundary = buffered.lastIndexOf("\n\n");
      if (eventBoundary === -1) {
        continue;
      }

      const complete = buffered.slice(0, eventBoundary + 2);
      buffered = buffered.slice(eventBoundary + 2);
      reply.raw.write(rewriteSseChunkText(complete, externalModel));
    }

    if (buffered.length > 0) {
      reply.raw.write(rewriteSseChunkText(buffered, externalModel));
    }

    reply.raw.end();
    return;
  }

  const text = await upstream.body.text();
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

function headerToString(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.join(",");
  }

  if (typeof value === "number") {
    return String(value);
  }

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestLog(request: FastifyRequest) {
  return request.log;
}
