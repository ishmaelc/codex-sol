import assert from "node:assert/strict";
import test from "node:test";
import { computeSolSystem } from "../../sol_system.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";

test("scoreObj must mirror score; divergence is a bug", () => {
  const solSystem = computeSolSystem(buildSolSummaryInputFixture());

  assert.ok(solSystem.scoreObj, "scoreObj must mirror score; divergence is a bug.");
  assert.ok(solSystem.score, "scoreObj must mirror score; divergence is a bug.");
  assert.equal(solSystem.scoreObj.score0to1, solSystem.score.score0to1, "scoreObj must mirror score; divergence is a bug.");
  assert.equal(solSystem.scoreObj.score0to100, solSystem.score.score0to100, "scoreObj must mirror score; divergence is a bug.");
  assert.equal(solSystem.scoreObj.label, solSystem.score.label, "scoreObj must mirror score; divergence is a bug.");
  assert.deepEqual(solSystem.scoreObj.reasons, solSystem.score.reasons, "scoreObj must mirror score; divergence is a bug.");
  assert.deepEqual(solSystem.scoreObj.components, solSystem.score.components, "scoreObj must mirror score; divergence is a bug.");
  assert.equal(solSystem.scoreObj, solSystem.score, "scoreObj must mirror score; divergence is a bug.");
});
