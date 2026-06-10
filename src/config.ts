import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { defaultConfig } from "./defaultConfig.js";
import { ProxyError } from "./errors.js";
import { appConfigSchema, type AppConfig, type ResolvedProvider } from "./types.js";

const defaultConfigPath = "config.yaml";

export async function loadConfig(path?: string): Promise<AppConfig> {
  const resolvedPath = path ?? process.env.PROXY_CONFIG ?? defaultConfigPath;
  const canUseBuiltInDefault = !path && !process.env.PROXY_CONFIG && resolvedPath === defaultConfigPath;
  let raw: string;

  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error) {
    if (canUseBuiltInDefault && isFileNotFound(error)) {
      return defaultConfig;
    }

    throw new ProxyError(
      500,
      "api_error",
      `Cannot read config file at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = appConfigSchema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new ProxyError(500, "api_error", `Invalid config: ${parsed.error.message}`);
  }

  validateProviderReferences(parsed.data);
  return parsed.data;
}

export function resolveProvider(config: AppConfig, name: string): ResolvedProvider {
  const provider = config.providers[name];
  if (!provider) {
    throw new ProxyError(500, "api_error", `Provider "${name}" is not configured`);
  }

  const baseUrl = provider.baseUrl ?? readRequiredEnv(provider.baseUrlEnv, `provider "${name}" baseUrlEnv`);
  const apiKey = readRequiredEnv(provider.apiKeyEnv, `provider "${name}" apiKeyEnv`);

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

function validateProviderReferences(config: AppConfig): void {
  for (const route of config.routes) {
    assertProviderExists(config, route.provider);
    for (const fallback of route.fallback) {
      assertProviderExists(config, fallback.provider);
    }
  }
}

function assertProviderExists(config: AppConfig, providerName: string): void {
  if (!config.providers[providerName]) {
    throw new ProxyError(500, "api_error", `Route references unknown provider "${providerName}"`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
