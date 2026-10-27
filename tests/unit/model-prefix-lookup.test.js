import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNodes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => ({
  getProviderNodes: mockNodes,
  getModelAliases: vi.fn(async () => ({})),
  getComboByName: vi.fn(async () => null),
}));

const { getModelInfo } = await import("../../src/sse/services/model.js");

describe("custom provider prefix lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodes.mockResolvedValue([]);
  });

  it("resolves a custom prefix with one node read", async () => {
    mockNodes.mockResolvedValue([
      { id: "custom-1", type: "anthropic-compatible", prefix: "mine" },
    ]);

    expect(await getModelInfo("mine/claude-3")).toEqual({ provider: "custom-1", model: "claude-3" });
    expect(mockNodes).toHaveBeenCalledTimes(1);
  });

  it("preserves provider type priority when prefixes collide", async () => {
    mockNodes.mockResolvedValue([
      { id: "embedding", type: "custom-embedding", prefix: "mine" },
      { id: "anthropic", type: "anthropic-compatible", prefix: "mine" },
      { id: "openai", type: "openai-compatible", prefix: "mine" },
    ]);

    expect(await getModelInfo("mine/model")).toEqual({ provider: "openai", model: "model" });
    expect(mockNodes).toHaveBeenCalledTimes(1);
  });

  it("keeps built-in provider prefixes reserved", async () => {
    mockNodes.mockResolvedValue([
      { id: "custom-1", type: "openai-compatible", prefix: "openai" },
    ]);

    expect(await getModelInfo("openai/gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(mockNodes).not.toHaveBeenCalled();
  });
});
