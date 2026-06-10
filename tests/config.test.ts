import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/defaultConfig.js";

describe("default config", () => {
  it("is empty, requiring admin page setup", () => {
    expect(defaultConfig.server.host).toBe("127.0.0.1");
    expect(defaultConfig.server.port).toBe(8787);
    expect(Object.keys(defaultConfig.providers)).toHaveLength(0);
    expect(defaultConfig.routes).toHaveLength(0);
  });
});
