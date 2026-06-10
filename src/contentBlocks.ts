import { ProxyError } from "./errors.js";
import type { ContentBlockType, ResolvedProvider } from "./types.js";

type Message = {
  content?: unknown;
};

type AnthropicRequest = {
  system?: unknown;
  messages?: Message[];
  [key: string]: unknown;
};

const knownBlockTypes = new Set<ContentBlockType>([
  "text",
  "tool_use",
  "tool_result",
  "thinking",
  "image",
  "document",
  "mcp_tool_use",
  "mcp_tool_result"
]);

export function assertSupportedContentBlocks(body: AnthropicRequest, provider: ResolvedProvider): void {
  const allowed = new Set(provider.capabilities.contentBlocks);
  const found = collectContentBlockTypes(body);
  const unsupported = found.filter((type) => knownBlockTypes.has(type as ContentBlockType) && !allowed.has(type as ContentBlockType));

  if (unsupported.length > 0) {
    throw new ProxyError(
      400,
      "invalid_request_error",
      `Provider "${provider.name}" does not support content block type(s): ${[...new Set(unsupported)].join(", ")}`
    );
  }
}

function collectContentBlockTypes(body: AnthropicRequest): string[] {
  const result: string[] = [];
  collectFromContent(body.system, result);

  for (const message of body.messages ?? []) {
    collectFromContent(message.content, result);
  }

  return result;
}

function collectFromContent(content: unknown, result: string[]): void {
  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    if (isObject(block) && typeof block.type === "string") {
      result.push(block.type);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
