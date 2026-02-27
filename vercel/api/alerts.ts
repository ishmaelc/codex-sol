import { handleAlertsQuery } from "../../src/system_engine/runtime/api_handlers.js";
import { getAlertsPayloadForRuntime } from "../../src/system_engine/alerts/get_alerts_payload.js";
import { getQuery, json } from "./_utils.js";

export { handleAlertsQuery as handleAlerts };

export default async function handler(req: any, res: any) {
  try {
    if (req.method && req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }

    const host = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "").trim();
    const proto = String(req?.headers?.["x-forwarded-proto"] ?? "https").trim() || "https";
    const apiBaseUrl = host ? `${proto}://${host}` : null;

    const result = await handleAlertsQuery(getQuery(req), {
      getAlertsPayload: async (args) =>
        getAlertsPayloadForRuntime({
          ...args,
          apiBaseUrl
        })
    });
    if (result.status === 200) {
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    }
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
