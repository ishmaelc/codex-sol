import { buildPortfolioIndexSystemEntry, runPortfolioEngine } from "../../portfolio/engine.js";
import { rollupPortfolio } from "../portfolio/rollups.js";
import { buildAlertsPayload, type AlertsPayload } from "./build_alerts_payload.js";

export async function getAlertsPayloadForRuntime(args: {
  asOfTs: string;
  wallet?: string | null;
}): Promise<AlertsPayload> {
  const { snapshots } = await runPortfolioEngine({ monitorCadenceHours: 24, outputBaseDir: "public/data/portfolio" });
  const systems = snapshots.map((snapshot) => buildPortfolioIndexSystemEntry(snapshot));
  const portfolioRollup = rollupPortfolio(
    systems.map((system) => ({
      id: system.id,
      health: system.health,
      capitalGuard: system.capitalGuard
    }))
  );
  return buildAlertsPayload({
    asOfTs: args.asOfTs,
    wallet: args.wallet ?? null,
    portfolioRollup: {
      healthRollup: portfolioRollup.health,
      capitalGuardRollup: portfolioRollup.capitalGuard
    },
    systems
  });
}
