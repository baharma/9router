import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("QwenCloud SG (pay-as-you-go) provider", () => {
  const entry = REGISTRY.find((e) => e.id === "qwencloud-sg");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS["qwencloud-sg"]).toBeDefined();
    expect(PROVIDERS["qwencloud-sg"].format).toBe("openai");
  });

  it("targets the Singapore QwenCloud host in compatible mode", () => {
    expect(PROVIDERS["qwencloud-sg"].baseUrl).toBe(
      "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
    );
  });

  it("does not share a host with the Alibaba key types", () => {
    const hosts = ["alicode", "alicode-intl", "alims-intl", "alitp-intl", "qwencloud", "qwencloud-sg"]
      .map((id) => new URL(PROVIDERS[id].baseUrl).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("exposes the Singapore text models and skips Beijing-only ones", () => {
    const ids = (PROVIDER_MODELS["qwencloud-sg"] || []).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["qwen3.8-max", "qwen3.8-flash", "kimi-k3", "glm-5.3"]));
    expect(ids).not.toContain("glm-5");
    expect(ids).not.toContain("MiniMax-M2.5");
  });

  it("does not take over the upstream Token Plan id or aliases", () => {
    expect(PROVIDERS.qwencloud.baseUrl).toContain("token-plan.maas.qwencloudapi.com");
    expect(entry.alias).toBe("qwencloud-sg");
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
