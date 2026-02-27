import { getQuery, json } from "./_utils.js";
import { getAlertsPayloadForRuntime } from "../../src/system_engine/alerts/get_alerts_payload.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const query = getQuery(req);
    const wallet = query.get("wallet");
    const payload = await getAlertsPayloadForRuntime({
      asOfTs: new Date().toISOString(),
      wallet
    });
    return json(res, 200, payload);
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
