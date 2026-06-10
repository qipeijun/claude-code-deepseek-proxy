import { isObject } from "../util.js";

/**
 * 请求体规范化：处理上游 API 与 Claude API 的校验差异。
 *
 * 规则：thinking.type === "disabled" 时，删除 thinking 和 reasoning_effort
 * ——DeepSeek 不允许关闭思考的同时设置 reasoning_effort，而 Claude Code 子代理
 * 请求可能同时携带这两个字段，导致上游返回 400。
 *
 * 主代理的扩展思考（type === "enabled"）不受影响。
 */
export function normalizeUpstreamBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(body.thinking) || body.thinking.type !== "disabled") {
    return body;
  }

  const cleaned = { ...body };
  delete cleaned.thinking;
  delete (cleaned as Record<string, unknown>)["reasoning_effort"];
  return cleaned;
}
