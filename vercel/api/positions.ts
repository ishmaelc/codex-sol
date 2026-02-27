import { handlePositionsQuery } from "../../src/system_engine/runtime/api_handlers.js";
import { getQuery, json } from "./_utils.js";

// static parity guard for shared summary-builder usage:
// buildPositionsSummaryInputs
// buildSolSystemInputsFromSummary
// computeSolSystem(buildSolSystemInputsFromSummary(summaryInputs))

export { handlePositionsQuery as handlePositions };

export default async function handler(req: any, res: any) {
  try {
    if (req.method && req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }

    const result = await handlePositionsQuery(getQuery(req));
    return json(res, result.status, result.body);
  } catch (err) {
    return json(res, 200, {
      meta: {
        degraded: true,
        fallbackSource: "none",
        errorCode: "ERROR",
        errorMessage: err instanceof Error ? err.message : String(err),
        wallet: null
      },
      solSystem: {
        scoreObj: {
          score0to1: 0.5,
          score0to100: 50,
          label: "YELLOW",
          reasons: ["FALLBACK_MINIMAL"],
          components: { hedge: 0.5, liquidation: 0.5, range: 0.5, dataQuality: 0.5, basisRisk: 0.5 }
        },
        snapshot: {
          dataFreshness: { hasMarkPrice: false, hasLiqPrice: false, hasRangeBuffer: false },
          liquidation: { liqPrice: null, liqBufferRatio: null, leverage: null },
          range: { rangeLower: null, rangeUpper: null, rangeBufferRatio: null },
          debugMath: {},
          reasons: ["FALLBACK_MINIMAL"]
        },
        health: { overall: "acceptable", hedge: "acceptable", liquidation: "acceptable", range: "acceptable" },
        capitalGuard: { level: "none", triggers: [] }
      }
    });
  }
}
