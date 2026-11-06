// QwenCloud — pay-as-you-go keys from home.qwencloud.com on <region>.maas.qwencloudapi.com.
// Separate key type from the four Alibaba providers (alicode, alicode-intl,
// alims-intl, alitp-intl): those hosts sit on aliyuncs.com and keys are not
// interchangeable. Keys are region-specific; this entry targets Singapore.
// The same host also serves an Anthropic surface at /apps/anthropic/v1/messages
// (x-api-key or Bearer), but it has no model-list route, so OpenAI-compatible
// mode is the transport here. GLM-5 and MiniMax-M2.5 are Beijing-only and are
// therefore not listed.
export default {
  id: "qwencloud",
  priority: 11,
  alias: "qwencloud",
  display: {
    name: "QwenCloud",
    icon: "cloud",
    color: "#615CED",
    textIcon: "QC",
    website: "https://www.qwencloud.com/models?region=ap-southeast-1",
    notice: {
      apiKeyUrl: "https://home.qwencloud.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  models: [
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
};
