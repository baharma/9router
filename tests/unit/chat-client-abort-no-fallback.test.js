import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

import { handleChat } from "../../src/sse/handlers/chat.js";
import { handleChat } from "../../src/sse/handlers/chat.js";
import { CLIENT_ABORTED_MESSAGE, createErrorResult } from "open-sse/utils/error.js";

// 499 is fallback-eligible when an upstream edge proxy emits it (#5054), but chatCore also
// returns 499 when OUR client aborted: then no account may be locked or spent.
const chat = () => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProviderCredentials
    .mockResolvedValueOnce({ connectionId: "acc-1", connectionName: "one" })
    .mockResolvedValueOnce({ connectionId: "acc-2", connectionName: "two" })
    .mockResolvedValue(null);
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("client abort vs upstream 499", () => {
  it("does not lock the account or try another one when our client aborted", async () => {
    mocks.handleChatCore.mockResolvedValue(createErrorResult(499, CLIENT_ABORTED_MESSAGE));
    const response = await chat();
    expect(response.status).toBe(499);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
  });

  it("still falls back to the next account on an upstream proxy 499", async () => {
    mocks.handleChatCore
      .mockResolvedValueOnce(createErrorResult(499, "[499]: Client Closed Request (edge)"))
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });
    const response = await chat();
    expect(await response.text()).toBe("ok");
    expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
  });
});
