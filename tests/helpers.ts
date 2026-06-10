import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../src/types.js";

export function makeConfig(baseUrl: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 8787,
      authTokenEnv: "LOCAL_PROXY_API_KEY"
    },
    providers: {
      deepseek: {
        type: "anthropic",
        baseUrl,
        apiKeyEnv: "DEEPSEEK_API_KEY",
        timeoutMs: 120_000,
        capabilities: {
          contentBlocks: ["text", "tool_use", "tool_result", "thinking"]
        }
      },
      mapper: {
        type: "anthropic",
        baseUrl,
        apiKeyEnv: "MAPPER_API_KEY",
        timeoutMs: 120_000,
        capabilities: {
          contentBlocks: ["text", "tool_use", "tool_result", "thinking"]
        }
      }
    },
    routes: [
      {
        match: { prefix: "claude-sonnet" },
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
        fallback: []
      },
      {
        match: { prefix: "claude-opus" },
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
        fallback: []
      },
      {
        match: { prefix: "claude-haiku" },
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
        fallback: []
      }
    ],
    ...overrides
  };
}

export async function createUpstream(
  handler: (body: Record<string, unknown>, requestCount: number) => { statusCode?: number; body?: unknown }
): Promise<{ app: FastifyInstance; baseUrl: string; calls: Record<string, unknown>[] }> {
  const calls: Record<string, unknown>[] = [];
  const app = Fastify({ logger: false });

  app.post("/v1/messages", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    calls.push(body);
    const response = handler(body, calls.length);
    return reply.status(response.statusCode ?? 200).send(response.body ?? {});
  });

  app.post("/v1/messages/count_tokens", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    calls.push(body);
    const response = handler(body, calls.length);
    return reply.status(response.statusCode ?? 200).send(response.body ?? { input_tokens: 42 });
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls
  };
}
