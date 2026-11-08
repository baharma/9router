// Per-request latency rollups for the Usage dashboard. Pure functions shared by
// the usage repo (recording + aggregation) and the dashboard (derived averages).
//
// A usage bucket (byModel / byProvider / … entry, daily or live) carries raw sums
// so buckets can be merged across days and grouped in the UI:
//   durationCount, durationSumMs, durationMaxMs — whole request, start → last byte
//   ttftCount, ttftSumMs                       — streamed requests only
//   speedTokens, speedMs                       — output tokens over generation time

// Same noise floors as the "fastest" combo strategy (open-sse/services/modelSpeed.js):
// very short replies or timing windows give meaningless tokens/s.
const SPEED_MIN_TOKENS = 20;
const SPEED_MIN_MS = 300;

const isPositive = (n) => Number.isFinite(n) && n > 0;

/**
 * Normalize a handler latency ({ ttft, total } in ms from request start) for storage.
 * TTFT is only kept for streamed replies: on JSON replies the handlers report
 * ttft === total, which is not a time-to-first-token.
 * @returns {{ totalMs: number, ttftMs?: number } | null}
 */
export function normalizeLatency(latency, stream = false) {
  const totalMs = Math.round(Number(latency?.total));
  if (!isPositive(totalMs)) return null;
  const out = { totalMs };
  const ttftMs = Math.round(Number(latency?.ttft));
  if (stream && isPositive(ttftMs) && ttftMs <= totalMs) out.ttftMs = ttftMs;
  return out;
}

/** Add one request's latency sample to a bucket (mutates target). */
export function addLatencySample(target, latency, outputTokens = 0) {
  if (!target || !latency || !isPositive(latency.totalMs)) return;
  target.durationCount = (target.durationCount || 0) + 1;
  target.durationSumMs = (target.durationSumMs || 0) + latency.totalMs;
  target.durationMaxMs = Math.max(target.durationMaxMs || 0, latency.totalMs);
  if (isPositive(latency.ttftMs)) {
    target.ttftCount = (target.ttftCount || 0) + 1;
    target.ttftSumMs = (target.ttftSumMs || 0) + latency.ttftMs;
  }
  // Streams are timed from the first token (pure generation speed); JSON replies
  // over the whole request, matching modelSpeed.js.
  const genMs = isPositive(latency.ttftMs) ? latency.totalMs - latency.ttftMs : latency.totalMs;
  if (outputTokens >= SPEED_MIN_TOKENS && genMs >= SPEED_MIN_MS) {
    target.speedTokens = (target.speedTokens || 0) + outputTokens;
    target.speedMs = (target.speedMs || 0) + genMs;
  }
}

/** Merge another bucket's latency sums into target (mutates target). */
export function mergeLatency(target, src) {
  if (!target || !src || !src.durationCount) return;
  target.durationCount = (target.durationCount || 0) + src.durationCount;
  target.durationSumMs = (target.durationSumMs || 0) + (src.durationSumMs || 0);
  target.durationMaxMs = Math.max(target.durationMaxMs || 0, src.durationMaxMs || 0);
  if (src.ttftCount) {
    target.ttftCount = (target.ttftCount || 0) + src.ttftCount;
    target.ttftSumMs = (target.ttftSumMs || 0) + (src.ttftSumMs || 0);
  }
  if (src.speedMs) {
    target.speedTokens = (target.speedTokens || 0) + (src.speedTokens || 0);
    target.speedMs = (target.speedMs || 0) + src.speedMs;
  }
}

/**
 * Derived, display-ready values. Fields are null when nothing was measured
 * (e.g. usage recorded before latency tracking existed).
 */
export function deriveLatency(bucket) {
  const b = bucket || {};
  return {
    avgDurationMs: b.durationCount ? b.durationSumMs / b.durationCount : null,
    avgTtftMs: b.ttftCount ? b.ttftSumMs / b.ttftCount : null,
    tokensPerSec: b.speedMs ? b.speedTokens / (b.speedMs / 1000) : null,
    maxDurationMs: b.durationCount ? b.durationMaxMs || null : null,
  };
}

/** "850ms", "3.2s", "1m 05s" */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatSpeed(tps) {
  if (!Number.isFinite(tps) || tps <= 0) return "—";
  return `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s`;
}
