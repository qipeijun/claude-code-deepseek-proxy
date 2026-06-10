import type { AppConfig } from "./types.js";

export const defaultConfig: AppConfig = {
  server: {
    host: "127.0.0.1",
    port: 8787,
    authTokenEnv: "LOCAL_PROXY_API_KEY"
  },
  providers: {
    deepseek: {
      type: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyEnv: "DEEPSEEK_API_KEY",
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
  ]
};
