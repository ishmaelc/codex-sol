import { getAlertsPayloadForRuntime } from "./get_alerts_payload.js";

type AlertsRequestLike = {
  query?: {
    wallet?: unknown;
  };
};

type AlertsResponseLike = {
  json: (payload: unknown) => unknown;
  status: (code: number) => { json: (payload: unknown) => unknown };
};

export function createLocalAlertsHandler(deps: {
  getAlertsPayload: (args: { asOfTs: string; wallet?: string | null }) => Promise<unknown>;
} = {
  getAlertsPayload: getAlertsPayloadForRuntime
}) {
  return async (req: AlertsRequestLike, res: AlertsResponseLike) => {
    try {
      const wallet = String(req.query?.wallet ?? "").trim() || null;
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
