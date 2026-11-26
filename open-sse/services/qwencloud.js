// QwenCloud key routing. The registry entry (upstream) targets the Token Plan host,
// which only accepts subscription keys (sk-sp-). Pay-as-you-go / workspace keys
// (sk-, sk-ws-, …) are rejected there with 401 invalid_api_key but work on the
// regional Singapore host, which serves the same three lanes on the same paths:
//   /compatible-mode/v1/chat/completions, /compatible-mode/v1/responses,
//   /apps/anthropic/v1/messages
// So a non-plan key keeps every path and only swaps the host.

export const QWENCLOUD_TOKEN_PLAN_KEY_PREFIX = "sk-sp-";
export const QWENCLOUD_TOKEN_PLAN_HOST = "token-plan.maas.qwencloudapi.com";
export const QWENCLOUD_REGIONAL_HOST = "ap-southeast-1.maas.qwencloudapi.com";
export const QWENCLOUD_MODELS_PATH = "/compatible-mode/v1/models";

export function isQwenCloudTokenPlanKey(apiKey) {
  return typeof apiKey === "string" && apiKey.startsWith(QWENCLOUD_TOKEN_PLAN_KEY_PREFIX);
}

// Rewrite a Token Plan URL to the regional host for non-plan keys. Only the exact
// Token Plan host is rewritten; any other URL is returned untouched.
export function resolveQwenCloudUrl(url, apiKey) {
  if (typeof url !== "string" || !apiKey || isQwenCloudTokenPlanKey(apiKey)) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.host !== QWENCLOUD_TOKEN_PLAN_HOST) return url;
  parsed.host = QWENCLOUD_REGIONAL_HOST;
  return parsed.toString();
}

export function getQwenCloudModelsUrl(apiKey) {
  const host = isQwenCloudTokenPlanKey(apiKey) ? QWENCLOUD_TOKEN_PLAN_HOST : QWENCLOUD_REGIONAL_HOST;
  return `https://${host}${QWENCLOUD_MODELS_PATH}`;
}
