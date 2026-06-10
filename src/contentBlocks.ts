import type { ResolvedProvider } from "./types.js";
import { isObject } from "./util.js";

/** 过滤后被追加到消息中的提示文本 */
const FILTER_NOTE =
  "[注：原始消息包含图片等当前模型不支持的内容类型，相关部分已被过滤移除。如需处理图片请使用支持多模态的模型。]";

/**
 * 过滤请求中上游 provider 不支持的内容块类型。
 * 不对入参产生副作用——返回新的 body 副本，原 body 保持不变。
 * - system 中的不支持块会被移除
 * - 每条消息中不支持的块会被移除，并追加一条提示文本
 * 返回被过滤的类型列表（去重）和处理后的 body。
 */
export function filterUnsupportedContentBlocks(
  body: Record<string, unknown>,
  provider: ResolvedProvider
): { filtered: string[]; body: Record<string, unknown> } {
  const allowed = new Set<string>(provider.capabilities.contentBlocks);
  const filtered = new Set<string>();

  // 对嵌套结构做拷贝，避免修改原始 body（fallback 重试依赖原始数据）
  const working: Record<string, unknown> = {
    ...body,
    system: Array.isArray(body.system) ? [...body.system] : body.system,
    messages: Array.isArray(body.messages)
      ? body.messages.map((msg) => (isObject(msg) ? { ...msg, content: Array.isArray((msg as Record<string, unknown>).content) ? [...((msg as Record<string, unknown>).content as unknown[])] : (msg as Record<string, unknown>).content } : msg))
      : body.messages
  };

  // 过滤 system 中的内容块
  filterArrayField(working, "system", allowed, filtered);

  // 过滤每条消息的 content
  const messages = working.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!isObject(msg) || !Array.isArray(msg.content)) continue;
      const before = msg.content.length;
      msg.content = msg.content.filter((block: unknown) => {
        if (isObject(block) && typeof block.type === "string" && !allowed.has(block.type)) {
          filtered.add(block.type);
          return false;
        }
        return true;
      });

      // 有内容被过滤，追加提示让上游模型感知
      if ((msg.content as unknown[]).length < before) {
        (msg.content as unknown[]).push({ type: "text", text: FILTER_NOTE });
      }
    }
  }

  return { filtered: [...filtered], body: working };
}

function filterArrayField(
  container: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
  filtered: Set<string>
): void {
  const arr = container[key];
  if (!Array.isArray(arr)) return;

  const result = arr.filter((block: unknown) => {
    if (isObject(block) && typeof block.type === "string" && !allowed.has(block.type)) {
      filtered.add(block.type);
      return false;
    }
    return true;
  });

  // 过滤后为空数组时删除该字段，避免上游 API 收到空数组报错
  if (result.length === 0) {
    delete container[key];
  } else {
    container[key] = result;
  }
}
