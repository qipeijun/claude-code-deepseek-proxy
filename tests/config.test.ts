import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config loading", () => {
  const originalCwd = process.cwd();
  const originalProxyConfig = process.env.PROXY_CONFIG;
  let tempDir: string | undefined;

  afterEach(async () => {
    process.chdir(originalCwd);

    if (originalProxyConfig === undefined) {
      delete process.env.PROXY_CONFIG;
    } else {
      process.env.PROXY_CONFIG = originalProxyConfig;
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("uses built-in defaults when config.yaml is absent", async () => {
    delete process.env.PROXY_CONFIG;
    tempDir = await mkdtemp(join(tmpdir(), "claude-code-deepseek-proxy-"));
    process.chdir(tempDir);

    const config = await loadConfig();

    expect(config.providers.deepseek.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(config.routes.map((route) => route.upstreamModel)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek-v4-pro"
    ]);
  });
});
