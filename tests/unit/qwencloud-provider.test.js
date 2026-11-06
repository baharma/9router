import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("QwenCloud provider", () => {
  const entry = REGISTRY.find((e) => e.id === "qwencloud");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS.qwencloud).toBeDefined();
    expect(PROVIDERS.qwencloud.format).toBe("openai");
  });

  it("targets the Singapore QwenCloud host in compatible mode", () => {
    expect(PROVIDERS.qwencloud.baseUrl).toBe(
      "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
    );
  });

  it("does not share a host with the Alibaba key types", () => {
    const hosts = ["alicode", "alicode-intl", "alims-intl", "alitp-intl", "qwencloud"]
      .map((id) => new URL(PROVIDERS[id].baseUrl).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("exposes the Singapore text models and skips Beijing-only ones", () => {
    const ids = (PROVIDER_MODELS.qwencloud || []).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["qwen3.8-max", "qwen3.8-flash", "kimi-k3", "glm-5.3"]));
    expect(ids).not.toContain("glm-5");
    expect(ids).not.toContain("MiniMax-M2.5");
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
