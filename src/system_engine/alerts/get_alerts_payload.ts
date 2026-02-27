import { buildAlertsPayload, type AlertsPayload } from "./build_alerts_payload.js";
import { getCachedSystemsIndex } from "../runtime/read_public_json.js";
import { buildSolSystemSnapshot } from "../../portfolio/systems/sol_system.js";
import { buildNx8SystemSnapshot } from "../../portfolio/systems/nx8_system.js";
import { buildPortfolioIndexSystemEntry } from "../../portfolio/engine.js";
import { rollupPortfolio } from "../portfolio/rollups.js";

export async function getAlertsPayloadForRuntime(args: {
  asOfTs: string;
  wallet?: string | null;
  apiBaseUrl?: string | null;
}): Promise<AlertsPayload> {
  if (args.wallet) {
    try {
      const [solSnapshot, nx8Snapshot] = await Promise.all([
        buildSolSystemSnapshot({ wallet: args.wallet, apiBaseUrl: args.apiBaseUrl ?? undefined }),
        buildNx8SystemSnapshot({ wallet: args.wallet, apiBaseUrl: args.apiBaseUrl ?? undefined })
      ]);
      const liveSystems = [solSnapshot, nx8Snapshot].map((snapshot) => buildPortfolioIndexSystemEntry(snapshot));
      const alertsSystems = liveSystems.map((system) => ({
        id: system.id,
        label: system.label,
        scoreObj: system.scoreObj as unknown as Record<string, unknown>,
        health: system.health,
        capitalGuard: system.capitalGuard,
        snapshot: system.snapshot
      }));
      const rollups = rollupPortfolio(
        liveSystems.map((system) => ({
          id: system.id,
          health: system.health,
          capitalGuard: system.capitalGuard
        }))
      );
      return buildAlertsPayload({
        asOfTs: args.asOfTs,
        wallet: args.wallet,
        portfolioRollup: {
          healthRollup: rollups.health,
          capitalGuardRollup: rollups.capitalGuard
        },
        systems: alertsSystems
      });
    } catch {
      // Fall through to cached systems index payload.
    }
  }

  const cached = getCachedSystemsIndex();
  const systems = Array.isArray(cached?.systems) ? cached.systems : [];
  return buildAlertsPayload({
    asOfTs: args.asOfTs,
    wallet: args.wallet ?? null,
    portfolioRollup: {
      healthRollup: cached?.healthRollup ?? { overall: "strong" },
      capitalGuardRollup: cached?.capitalGuardRollup ?? { level: "none", triggers: [] }
    },
    systems
  });
}
