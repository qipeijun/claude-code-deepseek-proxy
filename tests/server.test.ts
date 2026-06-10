import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { createUpstream, makeConfig } from "./helpers.js";

describe("Anthropic proxy server", () => {
  beforeEach(() => {
    process.env.LOCAL_PROXY_API_KEY = "local-secret";
    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    process.env.MAPPER_API_KEY = "mapper-key";
  });

  afterEach(() => {
    delete process.env.LOCAL_PROXY_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MAPPER_API_KEY;
  });

  it("does not require auth for healthz", async () => {
    const app = await buildServer(makeConfig("http://127.0.0.1:9999"));

    const response = await app.inject({
      method: "GET",
      url: "/healthz"
    });

    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rewrites request model upstream and restores response model downstream", async () => {
    const upstream = await createUpstream((body) => ({
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn"
      }
    }));
    const app = await buildServer(makeConfig(upstream.baseUrl));

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer local-secret" },
      payload: {
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    await app.close();
    await upstream.app.close();
    expect(response.statusCode).toBe(200);
    expect(upstream.calls[0].model).toBe("deepseek-v4-pro");
    expect(response.json().model).toBe("claude-sonnet-4-6");
  });

  it("passes tool use fields through without reshaping", async () => {
    const upstream = await createUpstream((body) => ({
      body: {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "README.md" }
          }
        ],
        stop_reason: "tool_use"
      }
    }));
    const app = await buildServer(makeConfig(upstream.baseUrl));

    const tools = [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"]
        }
      }
    ];
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "x-api-key": "local-secret" },
      payload: {
        model: "claude-opus-4-1",
        max_tokens: 128,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: "use a tool" }]
      }
    });

    await app.close();
    await upstream.app.close();
    expect(response.statusCode).toBe(200);
    expect(upstream.calls[0].tools).toEqual(tools);
    expect(response.json().content[0].type).toBe("tool_use");
  });

  it("rejects unsupported content block types explicitly", async () => {
    const app = await buildServer(makeConfig("http://127.0.0.1:9999"));

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer local-secret" },
      payload: {
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        messages: [
          {
            role: "user",
            content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }]
          }
        ]
      }
    });

    await app.close();
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("image");
  });

  it("loads configurable upstream models for admin provider forms", async () => {
    const upstream = Fastify({ logger: false });
    upstream.get("/models", async (request, reply) => {
      expect(request.headers["x-api-key"]).toBe("direct-deepseek-key");
      return reply.send({
        data: [
          { id: "deepseek-v4-pro" },
          { id: "deepseek-v4-flash" }
        ]
      });
    });
    await upstream.listen({ host: "127.0.0.1", port: 0 });
    const address = upstream.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const app = await buildServer(makeConfig(`http://127.0.0.1:${address.port}`));
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/upstream-models",
      payload: {
        provider: {
          type: "anthropic",
          baseUrl: `http://127.0.0.1:${address.port}/anthropic`,
          modelsUrl: `http://127.0.0.1:${address.port}/models`,
          apiKeyEnv: "DEEPSEEK_API_KEY",
          timeoutMs: 120000,
          capabilities: { contentBlocks: ["text"] }
        },
        apiKey: "direct-deepseek-key"
      }
    });

    await app.close();
    await upstream.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      models: ["deepseek-v4-flash", "deepseek-v4-pro"]
    });
  });

  it("derives DeepSeek model list URL from anthropic base URL when modelsUrl is omitted", async () => {
    const upstream = Fastify({ logger: false });
    upstream.get("/models", async (_request, reply) => reply.send({ data: [{ id: "deepseek-v4-pro" }] }));
    upstream.get("/anthropic/v1/models", async (_request, reply) => reply.code(404).send({ error: "wrong endpoint" }));
    await upstream.listen({ host: "127.0.0.1", port: 0 });
    const address = upstream.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const app = await buildServer(makeConfig(`http://127.0.0.1:${address.port}`));
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/upstream-models",
      payload: {
        provider: {
          type: "anthropic",
          baseUrl: `http://127.0.0.1:${address.port}/anthropic`,
          apiKeyEnv: "DEEPSEEK_API_KEY",
          timeoutMs: 120000,
          capabilities: { contentBlocks: ["text"] }
        },
        apiKey: "direct-deepseek-key"
      }
    });

    await app.close();
    await upstream.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      models: ["deepseek-v4-pro"]
    });
  });

  it("uses only configured fallback targets on upstream failure", async () => {
    const upstream = await createUpstream((body, count) => {
      if (count === 1) {
        return { statusCode: 500, body: { type: "error" } };
      }

      return {
        body: {
          id: "msg_3",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: "fallback ok" }],
          stop_reason: "end_turn"
        }
      };
    });
    const app = await buildServer(
      makeConfig(upstream.baseUrl, {
        routes: [
          {
            match: { prefix: "claude-sonnet" },
            provider: "deepseek",
            upstreamModel: "deepseek-v4-pro",
            fallback: [{ provider: "mapper", upstreamModel: "claude-sonnet-4-6" }]
          }
        ]
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer local-secret" },
      payload: {
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    await app.close();
    await upstream.app.close();
    expect(response.statusCode).toBe(200);
    expect(upstream.calls.map((call) => call.model)).toEqual(["deepseek-v4-pro", "claude-sonnet-4-6"]);
    expect(response.json().model).toBe("claude-sonnet-4-6");
  });

  it("rewrites model names in SSE message_start events", async () => {
    const upstream = Fastify({ logger: false });
    upstream.post("/v1/messages", async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8"
      });
      reply.raw.write("event: message_start\n");
      reply.raw.write(
        `data: ${JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_stream",
            type: "message",
            role: "assistant",
            model: body.model,
            content: []
          }
        })}\n\n`
      );
      reply.raw.write("event: message_stop\n");
      reply.raw.write(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      reply.raw.end();
    });
    await upstream.listen({ host: "127.0.0.1", port: 0 });
    const address = upstream.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const app = await buildServer(makeConfig(`http://127.0.0.1:${address.port}`));
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer local-secret",
        accept: "text/event-stream"
      },
      payload: {
        model: "claude-haiku-4-5",
        stream: true,
        max_tokens: 128,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    await app.close();
    await upstream.close();
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"model":"claude-haiku-4-5"');
    expect(response.body).not.toContain("deepseek-v4-pro");
  });
});
