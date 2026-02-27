import { buildAlertsPayload, type AlertsPayload } from "./build_alerts_payload.js";
import { getCachedSystemsIndex } from "../runtime/read_public_json.js";

export async function getAlertsPayloadForRuntime(args: {
  asOfTs: string;
  wallet?: string | null;
}): Promise<AlertsPayload> {
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
