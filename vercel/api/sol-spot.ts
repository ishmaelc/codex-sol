import { json } from "./_utils.js";

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = `${COINGECKO_URL}&t=${Date.now()}`;
    const upstream = await fetch(url, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache"
      }
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      return json(res, 502, { error: `upstream:${upstream.status}`, details: body.slice(0, 200) });
    }

    const payload = (await upstream.json()) as any;
    const price = Number(payload?.solana?.usd);
    if (!Number.isFinite(price) || price <= 0) {
      return json(res, 502, { error: "invalid upstream payload" });
    }

    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, {
      symbol: "SOL",
      priceUsd: price,
      source: "coingecko-proxy",
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
