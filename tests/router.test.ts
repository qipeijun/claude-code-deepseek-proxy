import { describe, expect, it, beforeEach } from "vitest";
import { matchRoute } from "../src/proxy/router.js";
import { makeConfig } from "./helpers.js";

describe("model routing", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    process.env.MAPPER_API_KEY = "mapper-key";
  });

  it.each(["claude-sonnet-4-6", "claude-opus-4-1", "claude-haiku-4-5"])(
    "routes %s to deepseek-v4-pro",
    (model) => {
      const route = matchRoute(makeConfig("http://127.0.0.1:9999"), model);

      expect(route.primary.provider).toBe("deepseek");
      expect(route.primary.upstreamModel).toBe("deepseek-v4-pro");
    }
  );

  it("prefers exact routes over prefix routes", () => {
    const config = makeConfig("http://127.0.0.1:9999", {
      routes: [
        {
          match: { prefix: "claude-sonnet" },
          provider: "deepseek",
          upstreamModel: "deepseek-v4-pro",
          fallback: []
        },
        {
          match: { exact: "claude-sonnet-debug" },
          provider: "mapper",
          upstreamModel: "claude-sonnet-4-6",
          fallback: []
        }
      ]
    });

    expect(matchRoute(config, "claude-sonnet-debug").primary.provider).toBe("mapper");
  });
});
