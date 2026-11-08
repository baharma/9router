// Usage dashboard latency: per-request { ttft, total } is persisted on usageHistory.meta,
// rolled up into usageDaily, and surfaced per model / provider in getUsageStats for both
// the live-history periods (today/24h) and the daily-summary periods (7d/…).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  normalizeLatency,
  addLatencySample,
  mergeLatency,
  deriveLatency,
  formatDuration,
  formatSpeed,
} from "../../src/shared/utils/usageLatency.js";

describe("usageLatency helpers", () => {
  it("keeps TTFT only for streamed replies and drops invalid samples", () => {
    expect(normalizeLatency({ ttft: 400, total: 2000 }, true)).toEqual({ totalMs: 2000, ttftMs: 400 });
    // JSON replies report ttft === total — not a time-to-first-token
    expect(normalizeLatency({ ttft: 2000, total: 2000 }, false)).toEqual({ totalMs: 2000 });
    expect(normalizeLatency({ ttft: 5000, total: 2000 }, true)).toEqual({ totalMs: 2000 });
    expect(normalizeLatency({ total: 0 })).toBeNull();
    expect(normalizeLatency(null)).toBeNull();
  });

  it("aggregates samples and derives averages, speed and slowest", () => {
    const b = {};
    addLatencySample(b, { totalMs: 2000, ttftMs: 500 }, 300); // 300 tok over 1.5s
    addLatencySample(b, { totalMs: 4000 }, 100);              // JSON: 100 tok over 4s
    addLatencySample(b, { totalMs: 900, ttftMs: 800 }, 5);     // too short for speed
    const d = deriveLatency(b);
    expect(d.avgDurationMs).toBeCloseTo((2000 + 4000 + 900) / 3);
    expect(d.avgTtftMs).toBe((500 + 800) / 2);
    expect(d.tokensPerSec).toBeCloseTo(400 / 5.5);
    expect(d.maxDurationMs).toBe(4000);
  });

  it("merges buckets and reports nothing when unmeasured", () => {
    const a = {}; const b = {};
    addLatencySample(a, { totalMs: 1000, ttftMs: 200 }, 50);
    addLatencySample(b, { totalMs: 3000, ttftMs: 600 }, 50);
    mergeLatency(a, b);
    mergeLatency(a, { requests: 3 }); // legacy bucket with no latency
    expect(deriveLatency(a)).toMatchObject({ avgDurationMs: 2000, avgTtftMs: 400, maxDurationMs: 3000 });
    expect(deriveLatency({ requests: 4 })).toEqual({ avgDurationMs: null, avgTtftMs: null, tokensPerSec: null, maxDurationMs: null });
  });

  it("formats durations and speeds", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(3240)).toBe("3.2s");
    expect(formatDuration(14700)).toBe("15s");
    expect(formatDuration(65000)).toBe("1m 05s");
    expect(formatDuration(null)).toBe("—");
    expect(formatSpeed(133.4)).toBe("133 tok/s");
    expect(formatSpeed(4.25)).toBe("4.3 tok/s");
    expect(formatSpeed(null)).toBe("—");
  });
});

describe("usage latency persistence (saveRequestUsage → getUsageStats)", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-latency-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();

    const base = { provider: "qwencloud", connectionId: "c-qc", endpoint: "/v1/chat/completions", status: "ok" };
    await db.saveRequestUsage({ ...base, model: "qwen3.7-plus", tokens: { prompt_tokens: 100, completion_tokens: 900 }, latency: { totalMs: 16000, ttftMs: 600 } });
    await db.saveRequestUsage({ ...base, model: "qwen3.7-plus", tokens: { prompt_tokens: 100, completion_tokens: 80 }, latency: { totalMs: 2500, ttftMs: 1200 } });
    await db.saveRequestUsage({ ...base, model: "qwen3.8-flash", tokens: { prompt_tokens: 100, completion_tokens: 130 }, latency: { totalMs: 1700, ttftMs: 700 } });
    // Recorded without latency (e.g. before this feature / embeddings)
    await db.saveRequestUsage({ ...base, model: "qwen3.8-flash", tokens: { prompt_tokens: 50, completion_tokens: 0 } });
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  for (const period of ["today", "7d"]) {
    it(`aggregates latency per model and provider (${period})`, async () => {
      const stats = await db.getUsageStats(period);
      const plus = deriveLatency(stats.byModel["qwen3.7-plus (qwencloud)"]);
      expect(plus.avgDurationMs).toBe((16000 + 2500) / 2);
      expect(plus.avgTtftMs).toBe((600 + 1200) / 2);
      expect(plus.maxDurationMs).toBe(16000);
      expect(plus.tokensPerSec).toBeCloseTo((900 + 80) / ((15400 + 1300) / 1000));

      const flash = stats.byModel["qwen3.8-flash (qwencloud)"];
      expect(flash.requests).toBe(2);
      expect(flash.durationCount).toBe(1); // the latency-less row is not averaged in
      expect(deriveLatency(flash).avgDurationMs).toBe(1700);

      expect(stats.byProvider.qwencloud.durationCount).toBe(3);
      expect(deriveLatency(stats.byProvider.qwencloud).maxDurationMs).toBe(16000);
    });
  }

  it("exposes per-request duration in recent requests (REST and live ring)", async () => {
    const stats = await db.getUsageStats("today");
    const plus = stats.recentRequests.find((r) => r.model === "qwen3.7-plus" && r.completionTokens === 900);
    expect(plus).toMatchObject({ durationMs: 16000, ttftMs: 600 });

    const live = await db.getActiveRequests();
    const flash = live.recentRequests.find((r) => r.model === "qwen3.8-flash" && r.completionTokens === 130);
    expect(flash).toMatchObject({ durationMs: 1700, ttftMs: 700 });
  });
});
