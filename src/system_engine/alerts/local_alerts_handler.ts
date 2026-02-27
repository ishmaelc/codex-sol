import type { Request, Response } from "express";
import { getAlertsPayloadForRuntime } from "./get_alerts_payload.js";

export function createLocalAlertsHandler(deps: {
  getAlertsPayload: (args: { asOfTs: string; wallet?: string | null }) => Promise<unknown>;
} = {
  getAlertsPayload: getAlertsPayloadForRuntime
}) {
  return async (req: Request, res: Response) => {
    try {
      const wallet = String(req.query.wallet ?? "").trim() || null;
      const payload = await deps.getAlertsPayload({
        asOfTs: new Date().toISOString(),
        wallet
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}
