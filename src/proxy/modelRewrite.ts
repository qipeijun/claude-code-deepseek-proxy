import { isObject } from "../util.js";

export function rewriteRequestModel<T extends { model?: unknown }>(body: T, upstreamModel: string): T & { model: string } {
  return {
    ...body,
    model: upstreamModel
  };
}

export function restoreResponseModel<T>(payload: T, externalModel: string): T {
  if (!isObject(payload)) {
    return payload;
  }

  const nextPayload: Record<string, unknown> = { ...payload };

  // 还原顶层 model 字段
  if (typeof payload.model === "string") {
    nextPayload.model = externalModel;
  }

  // 还原嵌套 message.model（SSE message_start 事件中包含）
  if (isObject(payload.message) && typeof payload.message.model === "string") {
    nextPayload.message = {
      ...payload.message,
      model: externalModel
    };
  }

  return nextPayload as T;
}

export function rewriteSseChunkText(text: string, externalModel: string): string {
  return text
    .split("\n\n")
    .map((event) => rewriteSseEvent(event, externalModel))
    .join("\n\n");
}

function rewriteSseEvent(event: string, externalModel: string): string {
  const lines = event.split("\n");

  return lines
    .map((line) => {
      if (!line.startsWith("data: ")) {
        return line;
      }

      const data = line.slice("data: ".length);
      if (data === "[DONE]" || data.trim() === "") {
        return line;
      }

      try {
        return `data: ${JSON.stringify(restoreResponseModel(JSON.parse(data), externalModel))}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}
