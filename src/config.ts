import { ProxyError } from "./errors.js";
import type { AppConfig, ResolvedProvider } from "./types.js";

export function resolveProvider(config: AppConfig, name: string): ResolvedProvider {
  const provider = config.providers[name];
  if (!provider) {
    throw new ProxyError(500, "api_error", `Provider "${name}" is not configured`);
  }

  const baseUrl = provider.baseUrl ?? readRequiredEnv(provider.baseUrlEnv, `provider "${name}" baseUrlEnv`);
  const apiKey = provider.apiKey ?? readRequiredEnv(provider.apiKeyEnv, `provider "${name}" apiKeyEnv`);

  return {
    ...provider,
    name,
    baseUrl: trimTrailingSlash(baseUrl),
    apiKey
  };
}

export function readRequiredEnv(name: string | undefined, label: string): string {
  if (!name) {
    throw new ProxyError(500, "api_error", `Missing ${label}`);
  }

  const value = process.env[name];
  if (!value) {
    throw new ProxyError(500, "api_error", `Environment variable ${name} is required for ${label}`);
  }

  return value;
}

export function readEnv(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return value?.trim() || undefined;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
