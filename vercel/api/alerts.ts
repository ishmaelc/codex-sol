import { handleAlertsQuery } from "../../src/system_engine/runtime/api_handlers.js";
import { getQuery, json } from "./_utils.js";

export { handleAlertsQuery as handleAlerts };

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const result = await handleAlertsQuery(getQuery(req));
  return json(res, result.status, result.body);
}
