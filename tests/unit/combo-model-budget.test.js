// Combo per-member response budget (COMBO_MODEL_TIMEOUT_MS / comboStrategies[name].modelTimeoutMs):
// a member that has not started answering within the budget is abandoned for the next one,
// while a slow-but-alive member (reasoning frames) is kept.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { handleComboChat, resolveModelBudgetMs } = await import("../../open-sse/services/combo.js");
const { inspectSSELine, peekStreamForContent } = await import("../../open-sse/services/emptyFailover.js");
const { createAttemptBudget } = await import("../../open-sse/handlers/chatCore.js");
const { COMBO_MODEL_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");

const enc = new TextEncoder();
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const ROLE_EMPTY = `data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":""},"finish_reason":null}]}\n\n`;
const REASONING = `data: {"choices":[{"index":0,"delta":{"content":"","reasoning_content":"User says halo"},"finish_reason":null}]}\n\n`;
const CONTENT = `data: {"choices":[{"index":0,"delta":{"content":"Halo!"},"finish_reason":null}]}\n\n`;
const STOP = `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`;

// SSE stream: each step is [delayMs, frame]; a null frame keeps the stream open forever.
function sseStream(steps) {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= steps.length) { controller.close(); return; }
      const [delay, frame] = steps[i++];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (frame === null) return new Promise(() => {}); // hang
      controller.enqueue(enc.encode(frame));
    },
  });
}
const sseResponse = (steps) => new Response(sseStream(steps), { headers: { "content-type": "text/event-stream" } });
const readAll = async (res) => res.text();

describe("resolveModelBudgetMs", () => {
  it("defaults when unset / blank / garbage", () => {
    for (const v of [undefined, null, "", "abc", -5]) expect(resolveModelBudgetMs(v)).toBe(COMBO_MODEL_TIMEOUT_MS);
  });
  it("accepts numbers >= 0 (0 disables)", () => {
    expect(resolveModelBudgetMs(0)).toBe(0);
    expect(resolveModelBudgetMs(2500)).toBe(2500);
    expect(resolveModelBudgetMs("7000")).toBe(7000);
  });
  it("ships a 10s default", () => expect(COMBO_MODEL_TIMEOUT_MS).toBe(10_000));
});

describe("inspectSSELine alive", () => {
  it("role + empty strings is not alive", () => expect(inspectSSELine(ROLE_EMPTY.trim()).alive).toBe(false));
  it("reasoning is alive (but not content)", () => {
    expect(inspectSSELine(REASONING.trim())).toMatchObject({ alive: true, content: false });
  });
  it("finish_reason / usage are alive", () => {
    expect(inspectSSELine(STOP.trim()).alive).toBe(true);
    expect(inspectSSELine(`data: {"choices":[],"usage":{"total_tokens":3}}`).alive).toBe(true);
  });
  it("claude ping is not alive; message_start is", () => {
    expect(inspectSSELine(`data: {"type":"ping"}`).alive).toBe(false);
    expect(inspectSSELine(`data: {"type":"message_start","message":{}}`).alive).toBe(true);
  });
  it("comments / keep-alives / [DONE] are not alive", () => {
    expect(inspectSSELine(": OPENROUTER PROCESSING").alive).toBe(false);
    expect(inspectSSELine("data: [DONE]").alive).toBe(false);
  });
});

describe("peekStreamForContent aliveDeadlineMs", () => {
  it("returns stalled when no live frame arrives in time", async () => {
    const t0 = Date.now();
    const p = await peekStreamForContent(sseStream([[0, ": keep-alive\n\n"], [0, ROLE_EMPTY], [0, null]]), { aliveDeadlineMs: 60 });
    expect(p.outcome).toBe("stalled");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a live (reasoning) stream outlives the alive deadline and reaches content", async () => {
    const p = await peekStreamForContent(sseStream([[0, REASONING], [120, CONTENT], [0, STOP]]), { aliveDeadlineMs: 40 });
    expect(p.outcome).toBe("content");
  });

  it("no alive deadline → old behaviour (waits for content)", async () => {
    const p = await peekStreamForContent(sseStream([[80, CONTENT]]));
    expect(p.outcome).toBe("content");
  });
});

describe("handleComboChat response budget", () => {
  const body = { messages: [{ role: "user", content: "halo" }] };

  it("gives every member but the last a deadline", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limited" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limited" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "ok" } }] }));
    const t0 = Date.now();
    await handleComboChat({ body, models: ["a/1", "b/2", "c/3"], handleSingleModel, log, comboName: "budget-1", comboStrategy: "fallback", modelTimeoutMs: 5000 });
    const [[, , first], [, , second], third] = handleSingleModel.mock.calls;
    expect(first.deadlineAt).toBeGreaterThanOrEqual(t0 + 5000);
    expect(second.deadlineAt).toBeGreaterThanOrEqual(first.deadlineAt);
    expect(third).toHaveLength(2); // last member: no budget
  });

  it("modelTimeoutMs 0 disables the budget", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limited" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "ok" } }] }));
    await handleComboChat({ body, models: ["a/1", "b/2"], handleSingleModel, log, comboName: "budget-0", comboStrategy: "fallback", modelTimeoutMs: 0 });
    expect(handleSingleModel.mock.calls[0]).toHaveLength(2);
  });

  it("abandons a member whose stream opens but never sends a live frame", async () => {
    const good = sseResponse([[0, CONTENT], [0, STOP]]);
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(sseResponse([[0, ROLE_EMPTY], [0, null]]))
      .mockResolvedValueOnce(good);
    const t0 = Date.now();
    const res = await handleComboChat({ body, models: ["hung/1", "ok/2"], handleSingleModel, log, comboName: "budget-stall", comboStrategy: "fallback", modelTimeoutMs: 80 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(await readAll(res)).toContain("Halo!");
  });

  it("keeps a slow thinker that is streaming reasoning", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(sseResponse([[0, REASONING], [150, CONTENT], [0, STOP]]))
      .mockResolvedValueOnce(sseResponse([[0, CONTENT]]));
    const res = await handleComboChat({ body, models: ["thinker/1", "other/2"], handleSingleModel, log, comboName: "budget-think", comboStrategy: "fallback", modelTimeoutMs: 50 });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(await readAll(res)).toContain("Halo!");
  });

  it("does not wait out a transient-error cooldown while budgeted", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "overloaded" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "ok" } }] }));
    const t0 = Date.now();
    await handleComboChat({ body, models: ["busy/1", "ok/2"], handleSingleModel, log, comboName: "budget-503", comboStrategy: "fallback", modelTimeoutMs: 5000 });
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("createAttemptBudget", () => {
  it("passthrough without a deadline", async () => {
    const parent = new AbortController().signal;
    const b = createAttemptBudget(null, parent);
    expect(b.signal).toBe(parent);
    await expect(b.run(async () => 42)).resolves.toBe(42);
    expect(b.timedOut).toBe(false);
  });

  it("aborts the signal and rejects at the deadline (executor honours the signal)", async () => {
    const b = createAttemptBudget(Date.now() + 40, undefined);
    const t0 = Date.now();
    await expect(b.run(() => new Promise((_, reject) => b.signal.addEventListener("abort", () => reject(b.signal.reason))))).rejects.toThrow(/budget/);
    expect(b.timedOut).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("rejects at the deadline even if the executor ignores its signal, and cancels the late body", async () => {
    const cancel = vi.fn(async () => {});
    const b = createAttemptBudget(Date.now() + 30, undefined);
    const late = new Promise((r) => setTimeout(() => r({ response: { body: { cancel } } }), 80));
    await expect(b.run(() => late)).rejects.toThrow(/budget/);
    await late;
    await new Promise((r) => setTimeout(r, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("resolves normally when the executor answers in time", async () => {
    const b = createAttemptBudget(Date.now() + 1000, undefined);
    await expect(b.run(async () => "ok")).resolves.toBe("ok");
    expect(b.timedOut).toBe(false);
    expect(b.signal.aborted).toBe(false);
  });

  it("follows the parent (client) signal without flagging a timeout", async () => {
    const parent = new AbortController();
    const b = createAttemptBudget(Date.now() + 1000, parent.signal);
    parent.abort();
    expect(b.signal.aborted).toBe(true);
    expect(b.timedOut).toBe(false);
  });
});
