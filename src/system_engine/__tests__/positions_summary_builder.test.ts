import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeSolSystem } from "../../sol_system.js";
import {
  buildPositionsSummaryInputs,
  buildSolSystemInputsFromSummary,
  type PositionsPayloadLike
} from "../positions/build_summary.js";

function readJsonFixture<T>(name: string): T {
  const fixturePath = path.resolve(process.cwd(), "src/system_engine/__tests__/fixtures", name);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const next = (value as Record<string, unknown>)[key];
      if (next && typeof next === "object" && !Object.isFrozen(next)) deepFreeze(next);
    }
  }
  return value;
}

test("summary builder contract lock", () => {
  const payload = readJsonFixture<PositionsPayloadLike>("positions_full.fixture.json");
  const expected = readJsonFixture<ReturnType<typeof buildPositionsSummaryInputs>>("summary_inputs.expected.json");
  const payloadFrozen = deepFreeze(payload);
  const payloadBefore = JSON.parse(JSON.stringify(payloadFrozen));

  const actual = buildPositionsSummaryInputs(payloadFrozen);
  assert.deepEqual(actual, expected);
  assert.deepEqual(payloadFrozen, payloadBefore);
  assert.ok(actual.rangeBufferRatio != null && actual.rangeBufferRatio >= 0 && actual.rangeBufferRatio <= 1);
});

test("range buffer ratio is clamped to [0,1]", () => {
  const payload: PositionsPayloadLike = {
    orcaWhirlpools: {
      positions: [
        { distanceToLowerPctFromCurrent: 250, distanceToUpperPctFromCurrent: 260, rangeLower: 100, rangeUpper: 110 },
        { distanceToLowerPctFromCurrent: 120, distanceToUpperPctFromCurrent: 180, rangeLower: 90, rangeUpper: 120 }
      ]
    }
  };
  const summary = buildPositionsSummaryInputs(payload);
  assert.equal(summary.rangeBufferRatio, 1);
});

test("server and vercel entrypoints both use shared summary builder", () => {
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), "src/server.ts"), "utf8");
  const vercelSource = fs.readFileSync(path.resolve(process.cwd(), "vercel/api/positions.ts"), "utf8");

  for (const source of [serverSource, vercelSource]) {
    assert.ok(source.includes("buildPositionsSummaryInputs"));
    assert.ok(source.includes("buildSolSystemInputsFromSummary"));
    assert.ok(source.includes("computeSolSystem(buildSolSystemInputsFromSummary(summaryInputs))"));
    assert.ok(!source.includes("const orcaSolAmount ="));
    assert.ok(!source.includes("const kaminoSolAmount ="));
    assert.ok(!source.includes("const rangeState ="));
  }
});

test("solLong/solShort aggregation invariants", () => {
  const payload: PositionsPayloadLike = {
    jupiterPerps: {
      data: {
        raw: {
          elements: [
            {
              type: "leverage",
              data: {
                isolated: {
                  positions: [
                    { address: "So11111111111111111111111111111111111111112", side: "short", size: 1.2, markPrice: 145 },
                    { address: "So11111111111111111111111111111111111111112", side: "short", size: "0.3", markPrice: 145 },
                    { address: "So11111111111111111111111111111111111111112", side: "long", size: 9.99, markPrice: 145 }
                  ]
                }
              }
            }
          ]
        }
      }
    },
    orcaWhirlpools: {
      positions: [
        { tokenA: "SOL", amountAEstUi: 3, distanceToLowerPctFromCurrent: 0.1, distanceToUpperPctFromCurrent: 0.2, rangeLower: 100, rangeUpper: 200 },
        { tokenB: "SOL", amountBEstUi: 2, distanceToLowerPctFromCurrent: 0.3, distanceToUpperPctFromCurrent: 0.4, rangeLower: 95, rangeUpper: 210 },
        { tokenA: "USDC", amountAEstUi: 999 }
      ]
    },
    kaminoLiquidity: {
      strategyValuations: [
        { tokenASymbol: "SOL", tokenAAmountUiFarmsStaked: 4 },
        { tokenBSymbol: "SOL", tokenBAmountUi: 6 },
        { tokenASymbol: "USDC", tokenAAmountUiFarmsStaked: 1000 }
      ]
    }
  };

  const summary = buildPositionsSummaryInputs(payload);
  assert.ok(summary.solLong >= 0);
  assert.ok(summary.solShort >= 0);
  assert.equal(summary.solLong, 15);
  assert.equal(summary.solShort, 1.5);

  const solSystem = computeSolSystem(buildSolSystemInputsFromSummary(summary));
  assert.equal(solSystem.snapshot.exposures.totalLongSOL, 15);
  assert.equal(solSystem.snapshot.exposures.totalShortSOL, 1.5);
  assert.equal(solSystem.snapshot.exposures.hedgeRatio, 0.1);
});
