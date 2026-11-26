import { describe, expect, it } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  getQwenCloudModelsUrl,
  isQwenCloudTokenPlanKey,
  resolveQwenCloudUrl,
} from "../../open-sse/services/qwencloud.js";

const PLAN_KEY = "sk-sp-test";
const PAYG_KEYS = ["sk-ws-test", "sk-test"];

const urlFor = (sourceFormat, apiKey) => {
  const credentials = { apiKey, authType: "apikey", runtimeTransport: resolveTransport("qwencloud", sourceFormat) };
  return getExecutor("qwencloud").buildUrl("qwen4-max", true, 0, credentials);
};

describe("QwenCloud key routing", () => {
  it("recognizes Token Plan keys by prefix", () => {
    expect(isQwenCloudTokenPlanKey(PLAN_KEY)).toBe(true);
    for (const k of PAYG_KEYS) expect(isQwenCloudTokenPlanKey(k)).toBe(false);
    expect(isQwenCloudTokenPlanKey(undefined)).toBe(false);
  });

  it.each([
    [FORMATS.OPENAI, "/compatible-mode/v1/chat/completions"],
    [FORMATS.CLAUDE, "/apps/anthropic/v1/messages"],
    [FORMATS.OPENAI_RESPONSES, "/compatible-mode/v1/responses"],
  ])("keeps %s plan-key requests on token-plan", (format, path) => {
    expect(urlFor(format, PLAN_KEY)).toBe(`https://token-plan.maas.qwencloudapi.com${path}`);
  });

  it.each([
    [FORMATS.OPENAI, "/compatible-mode/v1/chat/completions"],
    [FORMATS.CLAUDE, "/apps/anthropic/v1/messages"],
    [FORMATS.OPENAI_RESPONSES, "/compatible-mode/v1/responses"],
  ])("sends %s pay-as-you-go keys to the Singapore host on the same path", (format, path) => {
    for (const k of PAYG_KEYS) {
      expect(urlFor(format, k)).toBe(`https://ap-southeast-1.maas.qwencloudapi.com${path}`);
    }
  });

  it("falls back to the registry baseUrl when no runtime transport matches", () => {
    const credentials = { apiKey: "sk-ws-test", authType: "apikey" };
    expect(getExecutor("qwencloud").buildUrl("qwen4-max", true, 0, credentials))
      .toBe("https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions");
  });

  it("only rewrites the exact Token Plan host", () => {
    expect(resolveQwenCloudUrl("https://example.com/compatible-mode/v1/chat/completions", "sk-ws-test"))
      .toBe("https://example.com/compatible-mode/v1/chat/completions");
    expect(resolveQwenCloudUrl("https://token-plan.maas.qwencloudapi.com.evil.test/x", "sk-ws-test"))
      .toBe("https://token-plan.maas.qwencloudapi.com.evil.test/x");
  });

  it("picks the models probe host from the key", () => {
    expect(getQwenCloudModelsUrl(PLAN_KEY)).toBe("https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/models");
    expect(getQwenCloudModelsUrl("sk-ws-test")).toBe("https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/models");
  });
});
