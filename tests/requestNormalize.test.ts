import { describe, expect, it } from "vitest";
import { normalizeUpstreamBody } from "../src/proxy/requestNormalize.js";

describe("normalizeUpstreamBody", () => {
  it("思考关闭时删除 thinking 和 reasoning_effort（子代理场景）", () => {
    const result = normalizeUpstreamBody({
      model: "claude-sonnet-4-6",
      thinking: { type: "disabled" },
      reasoning_effort: "medium",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result).not.toHaveProperty("thinking");
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.messages).toBeDefined(); // 其他字段保留
  });

  it("思考开启时原样保留（主代理场景）", () => {
    const input = {
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 16000 },
      reasoning_effort: "high"
    };

    expect(normalizeUpstreamBody(input)).toEqual(input);
  });

  it("没有 thinking 字段时原样返回", () => {
    const input = { model: "claude-sonnet-4-6" };
    expect(normalizeUpstreamBody(input)).toBe(input); // 引用相同，没拷贝
  });
});
