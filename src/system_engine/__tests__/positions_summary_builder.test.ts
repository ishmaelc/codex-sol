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

test("debug mode does not change summary builder output", () => {
  const payload = readJsonFixture<PositionsPayloadLike>("positions_full.fixture.json");
  const normal = buildPositionsSummaryInputs(payload, { debug: false });
  const debug = buildPositionsSummaryInputs(payload, { debug: true });
  assert.deepEqual(debug, normal);
});

test("range buffer ratio is clamped to [0,1]", () => {
  const payload: PositionsPayloadLike = {
    jupiterPerps: {
      data: {
        raw: {
          elements: [
            {
              type: "leverage",
              data: {
                isolated: {
                  positions: [{ address: "So11111111111111111111111111111111111111112", side: "short", size: 1, markPrice: 150 }]
                }
              }
            }
          ]
        }
      }
    },
    orcaWhirlpools: {
      positions: [
        { distanceToLowerPctFromCurrent: 250, distanceToUpperPctFromCurrent: 260, rangeLower: 100, rangeUpper: 110 },
        { distanceToLowerPctFromCurrent: 120, distanceToUpperPctFromCurrent: 180, rangeLower: 90, rangeUpper: 120 }
      ]
    }
  };
  const summary = buildPositionsSummaryInputs(payload);
  assert.ok(summary.rangeBufferRatio != null);
  assert.ok(summary.rangeBufferRatio != null && summary.rangeBufferRatio >= 0 && summary.rangeBufferRatio <= 1);
});

test("in-range position with negative distance field yields positive price-based range buffer", () => {
  const payload: PositionsPayloadLike = {
    jupiterPerps: {
      data: {
        raw: {
          elements: [
            {
              type: "leverage",
              data: {
                isolated: {
                  positions: [{ address: "So11111111111111111111111111111111111111112", side: "short", size: 1, markPrice: 150 }]
                }
              }
            }
          ]
        }
      }
    },
    orcaWhirlpools: {
      positions: [
        {
          rangeLower: 120,
          rangeUpper: 180,
          distanceToLowerPctFromCurrent: -25,
          distanceToUpperPctFromCurrent: 20
        }
      ]
    }
  };

  const summary = buildPositionsSummaryInputs(payload);
  const width = 180 - 120;
  const dLower = 150 - 120;
  const dUpper = 180 - 150;
  const expected = Math.min(dLower, dUpper) / width;

  assert.ok(summary.rangeBufferRatio != null && summary.rangeBufferRatio > 0);
  assert.ok(summary.rangeBufferRatio != null && Math.abs(summary.rangeBufferRatio - expected) <= 1e-12);
});

function mkRangePayload(markPrice: number, rangeLower: number, rangeUpper: number): PositionsPayloadLike {
  return {
    jupiterPerps: {
      data: {
        raw: {
          elements: [
            {
              type: "leverage",
              data: {
                isolated: {
                  positions: [{ address: "So11111111111111111111111111111111111111112", side: "short", size: 1, markPrice }]
                }
              }
            }
          ]
        }
      }
    },
    orcaWhirlpools: {
      positions: [
        {
          rangeLower,
          rangeUpper,
          distanceToLowerPctFromCurrent: -12.3,
          distanceToUpperPctFromCurrent: 15.7
        }
      ]
    }
  };
}

test("in-range invariant implies positive range buffer ratio", () => {
  const markPrice = 86.5;
  const lower = 70.7;
  const upper = 93.75;
  const summary = buildPositionsSummaryInputs(mkRangePayload(markPrice, lower, upper));
  const expected = Math.min(markPrice - lower, upper - markPrice) / (upper - lower);
  assert.ok(summary.rangeBufferRatio != null && summary.rangeBufferRatio > 0);
  assert.ok(summary.rangeBufferRatio != null && Math.abs(summary.rangeBufferRatio - expected) <= 1e-12);
});

test("at-lower-edge implies zero range buffer ratio", () => {
  const lower = 70.7;
  const upper = 93.75;
  const summary = buildPositionsSummaryInputs(mkRangePayload(lower, lower, upper));
  assert.equal(summary.rangeBufferRatio, 0);
});

test("at-upper-edge implies zero range buffer ratio", () => {
  const lower = 70.7;
  const upper = 93.75;
  const summary = buildPositionsSummaryInputs(mkRangePayload(upper, lower, upper));
  assert.equal(summary.rangeBufferRatio, 0);
});

test("reversed bounds are normalized deterministically", () => {
  const markPrice = 86.5;
  const lower = 70.7;
  const upper = 93.75;
  const summary = buildPositionsSummaryInputs(mkRangePayload(markPrice, upper, lower));
  const expected = Math.min(markPrice - lower, upper - markPrice) / (upper - lower);
  assert.equal(summary.rangeLower, lower);
  assert.equal(summary.rangeUpper, upper);
  assert.ok(summary.rangeBufferRatio != null && Math.abs(summary.rangeBufferRatio - expected) <= 1e-12);
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
