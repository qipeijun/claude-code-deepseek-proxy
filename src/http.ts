import { request } from "undici";
import { ProxyError } from "./errors.js";
import type { ResolvedRouteTarget } from "./types.js";

export type UpstreamResponse = Awaited<ReturnType<typeof request>>;

export async function callAnthropicUpstream(
  target: ResolvedRouteTarget,
  path: string,
  body: unknown,
  headers: Record<string, string | undefined>
): Promise<UpstreamResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), target.providerConfig.timeoutMs);

  try {
    return await request(`${target.providerConfig.baseUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
      headers: buildUpstreamHeaders(target, headers)
    });
  } catch (error) {
    throw new ProxyError(
      502,
      "api_error",
      `Upstream "${target.provider}" request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildUpstreamHeaders(target: ResolvedRouteTarget, headers: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {
    "content-type": "application/json",
    accept: headers.accept ?? "application/json",
    "x-api-key": target.providerConfig.apiKey,
    authorization: `Bearer ${target.providerConfig.apiKey}`
  };

  if (headers["anthropic-version"]) {
    result["anthropic-version"] = headers["anthropic-version"];
  }

  if (headers["anthropic-beta"]) {
    result["anthropic-beta"] = headers["anthropic-beta"];
  }

  return result;
}
