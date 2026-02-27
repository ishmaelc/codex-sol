import test from "node:test";
import assert from "node:assert/strict";
import { rollupCapitalGuard, rollupHealth, rollupPortfolio } from "../portfolio/rollups.js";
import type { HealthResult } from "../health/compute_health.js";
import type { CapitalGuardResult } from "../capital_guard/compute_capital_guard.js";

type RollupSystemFixture = {
  id: string;
  health: HealthResult;
  capitalGuard: CapitalGuardResult;
};

test("health rollup uses worst-case precedence", () => {
  assert.deepEqual(
    rollupHealth([
      { id: "a", health: { overall: "strong", hedge: "strong", liquidation: "strong", range: "strong" } },
      { id: "b", health: { overall: "degraded", hedge: "degraded", liquidation: "acceptable", range: "acceptable" } }
    ]),
    { overall: "degraded" }
  );
  assert.deepEqual(
    rollupHealth([
      { id: "a", health: { overall: "acceptable", hedge: "acceptable", liquidation: "acceptable", range: "acceptable" } },
      { id: "b", health: { overall: "critical", hedge: "critical", liquidation: "acceptable", range: "degraded" } }
    ]),
    { overall: "critical" }
  );
});

test("capital guard rollup uses worst-case precedence", () => {
  assert.equal(
    rollupCapitalGuard([
      { id: "a", capitalGuard: { level: "none", triggers: [] } },
      { id: "b", capitalGuard: { level: "action", triggers: ["rebalance_required"] } }
    ]).level,
    "action"
  );
  assert.equal(
    rollupCapitalGuard([
      { id: "a", capitalGuard: { level: "warning", triggers: ["range_exit_risk"] } },
      { id: "b", capitalGuard: { level: "critical", triggers: ["capital_at_risk"] } }
    ]).level,
    "critical"
  );
});

test("capital guard rollup dedupes and sorts triggers deterministically", () => {
  const rollup = rollupCapitalGuard([
    { id: "z", capitalGuard: { level: "warning", triggers: ["range_exit_risk", "capital_at_risk"] } },
    { id: "a", capitalGuard: { level: "action", triggers: ["capital_at_risk", "rebalance_required"] } }
  ]);
  assert.deepEqual(rollup.triggers, ["capital_at_risk", "range_exit_risk", "rebalance_required"]);
});

test("portfolio rollups are deterministic and idempotent", () => {
  const systems: RollupSystemFixture[] = [
    { id: "sol_hedged", health: { overall: "degraded", hedge: "degraded", liquidation: "acceptable", range: "strong" }, capitalGuard: { level: "action", triggers: ["rebalance_required"] } },
    { id: "nx8_hedged", health: { overall: "critical", hedge: "critical", liquidation: "acceptable", range: "acceptable" }, capitalGuard: { level: "critical", triggers: ["capital_at_risk"] } }
  ];
  const first = rollupPortfolio(systems);
  const second = rollupPortfolio(systems);
  assert.deepEqual(first, second);
});

test("portfolio rollups do not mutate input", () => {
  const systems: RollupSystemFixture[] = [
    { id: "sol_hedged", health: { overall: "strong", hedge: "strong", liquidation: "strong", range: "strong" }, capitalGuard: { level: "none", triggers: [] } },
    { id: "nx8_hedged", health: { overall: "acceptable", hedge: "acceptable", liquidation: "acceptable", range: "acceptable" }, capitalGuard: { level: "warning", triggers: ["range_exit_risk"] } }
  ];
  const before = JSON.parse(JSON.stringify(systems));
  rollupPortfolio(systems);
  assert.deepEqual(systems, before);
});
