import test from "node:test";
import assert from "node:assert/strict";
import { buildAlertsPayload } from "../alerts/build_alerts_payload.js";

test("alerts payload systems are deterministically ordered by systemId", () => {
  const payload = buildAlertsPayload({
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "critical" },
      capitalGuardRollup: { level: "critical", triggers: ["capital_at_risk"] }
    },
    systems: [
      { id: "z_system", health: { overall: "strong" }, capitalGuard: { level: "none", triggers: [] }, snapshot: {} },
      { id: "a_system", health: { overall: "degraded" }, capitalGuard: { level: "action", triggers: ["rebalance_required"] }, snapshot: {} }
    ]
  });
  assert.deepEqual(payload.systems.map((s) => s.systemId), ["a_system", "z_system"]);
});

test("alerts payload trigger union is deduped and lexicographically sorted", () => {
  const payload = buildAlertsPayload({
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "critical" },
      capitalGuardRollup: { level: "critical", triggers: ["z_trigger", "a_trigger"] }
    },
    systems: [
      { id: "a", health: { overall: "degraded" }, capitalGuard: { level: "action", triggers: ["x", "a"] }, snapshot: {} },
      { id: "b", health: { overall: "strong" }, capitalGuard: { level: "warning", triggers: ["a", "m"] }, snapshot: {} }
    ]
  });
  assert.deepEqual(payload.attention.triggers, ["a", "m", "x"]);
});

test("alerts payload attention filters by guard or non-strong health", () => {
  const payload = buildAlertsPayload({
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "warning" },
      capitalGuardRollup: { level: "warning", triggers: [] }
    },
    systems: [
      { id: "a", health: { overall: "strong" }, capitalGuard: { level: "none", triggers: [] }, snapshot: {} },
      { id: "b", health: { overall: "acceptable" }, capitalGuard: { level: "none", triggers: [] }, snapshot: {} },
      { id: "c", health: { overall: "strong" }, capitalGuard: { level: "action", triggers: ["rebalance_required"] }, snapshot: {} }
    ]
  });
  assert.equal(payload.attention.systemCount, 2);
  assert.deepEqual(payload.attention.systems, ["b", "c"]);
});

test("alerts payload does not mutate inputs", () => {
  const input = {
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "critical" },
      capitalGuardRollup: { level: "critical", triggers: ["capital_at_risk"] }
    },
    systems: [
      {
        id: "a",
        health: { overall: "critical" },
        capitalGuard: { level: "critical", triggers: ["capital_at_risk"] },
        snapshot: { range: { rangeBufferRatio: 0.2 } }
      }
    ]
  };
  const before = JSON.parse(JSON.stringify(input));
  buildAlertsPayload(input);
  assert.deepEqual(input, before);
});

test("alerts payload passes snapshot canonical values without recomputation", () => {
  const inputRatio = 0.1793;
  const payload = buildAlertsPayload({
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "acceptable" },
      capitalGuardRollup: { level: "none", triggers: [] }
    },
    systems: [
      {
        id: "sol_hedged",
        health: { overall: "acceptable" },
        capitalGuard: { level: "none", triggers: [] },
        snapshot: { range: { rangeBufferRatio: inputRatio } }
      }
    ]
  });
  const outRatio = (payload.systems[0]?.snapshot.range as { rangeBufferRatio?: number } | undefined)?.rangeBufferRatio;
  assert.equal(outRatio, inputRatio);
});

// ensure deposit recommendations are carried through to alerts payload
test("alerts payload includes depositRecommendation when present", () => {
  const deposit = { tokenAQty: 1, tokenBQty: 2, tokenAUsd: 100, tokenBUsd: 200, hedgeShortQty: 0.5, hedgeUsd: 50, rangePreset: "Base", riskCapitalPct: 0.5, riskAssetLabel: "SOL", tokenASymbol: "SOL", tokenBSymbol: "USDC" };
  const payload = buildAlertsPayload({
    asOfTs: "2026-02-27T00:00:00.000Z",
    portfolioRollup: {
      healthRollup: { overall: "strong" },
      capitalGuardRollup: { level: "none", triggers: [] }
    },
    systems: [
      {
        id: "sol_hedged",
        health: { overall: "strong" },
        capitalGuard: { level: "none", triggers: [] },
        snapshot: { depositRecommendation: deposit }
      }
    ]
  });
  assert.deepEqual(payload.systems[0]?.snapshot.depositRecommendation, deposit);
});
