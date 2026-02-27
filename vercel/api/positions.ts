import { buildSummary, fetchWalletPositions } from "../../src/index.js";
import { computeSolSystem } from "../../src/sol_system.js";
import { buildPositionsSummaryInputs, buildSolSystemInputsFromSummary } from "../../src/system_engine/positions/build_summary.js";
import { getQuery, json, requireWallet } from "./_utils.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const query = getQuery(req);
  const wallet = String(query.get("wallet") ?? "");
  const mode = String(query.get("mode") ?? "summary").trim().toLowerCase();

  const walletErr = requireWallet(wallet);
  if (walletErr) return json(res, 400, { error: walletErr });

  try {
    const positions = await fetchWalletPositions(wallet);
    if (mode === "full") return json(res, 200, positions);

    const summary = buildSummary(positions);
    const summaryInputs = buildPositionsSummaryInputs({
      ...summary,
      jupiterPerps: positions.jupiterPerps
    });
    const solSystem = computeSolSystem(buildSolSystemInputsFromSummary(summaryInputs));

    return json(res, 200, {
      ...summary,
      solSystem
    });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
