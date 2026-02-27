import { handleAlertsQuery } from "../../src/system_engine/runtime/api_handlers.js";
import { getQuery, json } from "./_utils.js";

export { handleAlertsQuery as handleAlerts };

export default async function handler(req: any, res: any) {
  try {
    if (req.method && req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }

    const result = await handleAlertsQuery(getQuery(req));
    return json(res, result.status, result.body);
  } catch (err) {
    return json(res, 200, {
      meta: {
        degraded: true,
        errorCode: "ERROR",
        errorMessage: err instanceof Error ? err.message : String(err),
        wallet: null
      },
      attention: {
        level: "none",
        triggers: [],
        reasons: ["ALERTS_DEGRADED_ERROR"]
      },
      systems: []
    });
  }
}
