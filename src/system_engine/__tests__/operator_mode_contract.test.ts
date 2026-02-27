import assert from "node:assert/strict";
import test from "node:test";
import { computeSolSystem } from "../../sol_system.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";

test("Operator Mode contract fields exist in summary-shaped payload", () => {
  const solSystem = computeSolSystem(buildSolSummaryInputFixture());
  const summaryPayload = { solSystem };

  assert.ok(summaryPayload.solSystem, "Operator Mode contract: solSystem missing");
  assert.ok(summaryPayload.solSystem.snapshot, "Operator Mode contract: solSystem.snapshot missing");
  assert.notEqual(summaryPayload.solSystem.snapshot.debugMath, undefined, "Operator Mode contract: solSystem.snapshot.debugMath missing");
  assert.ok(Array.isArray(summaryPayload.solSystem.snapshot.reasons), "Operator Mode contract: solSystem.snapshot.reasons must be an array");
  assert.ok(Array.isArray(summaryPayload.solSystem.capitalGuard?.triggers), "Operator Mode contract: solSystem.capitalGuard.triggers must be an array");
  assert.ok(Array.isArray(summaryPayload.solSystem.scoreObj?.reasons), "Operator Mode contract: solSystem.scoreObj.reasons must be an array");
});
