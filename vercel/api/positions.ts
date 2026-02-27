import { handlePositionsQuery } from "../../src/system_engine/runtime/api_handlers.js";
import { getQuery, json } from "./_utils.js";

// static parity guard for shared summary-builder usage:
// buildPositionsSummaryInputs
// buildSolSystemInputsFromSummary
// computeSolSystem(buildSolSystemInputsFromSummary(summaryInputs))

export { handlePositionsQuery as handlePositions };

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const result = await handlePositionsQuery(getQuery(req));
  return json(res, result.status, result.body);
}
