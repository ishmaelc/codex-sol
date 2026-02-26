import { buildSummary, fetchWalletPositions } from "../../src/index.js";
import { computeSolSystem } from "../../src/sol_system.js";
import { getQuery, json, requireWallet } from "./_utils.js";

function toNumberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const query = getQuery(req);
  const wallet = String(query.get("wallet") ?? "");
  const mode = String(query.get("mode") ?? "summary").trim().toLowerCase();

  const walletErr = requireWallet(wallet);
  if (walletErr) return json(res, 400, { error: walletErr });

  try {
    const positions = await fetchWalletPositions(wallet);
    if (mode === "full") return json(res, 200, positions);

    const summary = buildSummary(positions) as {
      orcaWhirlpools?: {
        positions?: Array<{
          tokenA?: string | null;
          tokenB?: string | null;
          amountAEstUi?: number | null;
          amountBEstUi?: number | null;
          distanceToLowerPctFromCurrent?: number | null;
          distanceToUpperPctFromCurrent?: number | null;
        }>;
      };
      kaminoLiquidity?: {
        strategyValuations?: Array<{
          tokenASymbol?: string | null;
          tokenBSymbol?: string | null;
          tokenAAmountUiFarmsStaked?: number | null;
          tokenBAmountUiFarmsStaked?: number | null;
          tokenAAmountUi?: number | null;
          tokenBAmountUi?: number | null;
        }>;
      };
    };

    const orcaSolAmount = (summary.orcaWhirlpools?.positions ?? []).reduce((acc, p) => {
      let next = acc;
      if (String(p?.tokenA ?? "").toUpperCase() === "SOL") next += toNumberOrZero(p?.amountAEstUi);
      if (String(p?.tokenB ?? "").toUpperCase() === "SOL") next += toNumberOrZero(p?.amountBEstUi);
      return next;
    }, 0);

    const kaminoSolAmount = (summary.kaminoLiquidity?.strategyValuations ?? []).reduce((acc, s) => {
      let next = acc;
      if (String(s?.tokenASymbol ?? "").toUpperCase() === "SOL") {
        next += toNumberOrZero(s?.tokenAAmountUiFarmsStaked ?? s?.tokenAAmountUi);
      }
      if (String(s?.tokenBSymbol ?? "").toUpperCase() === "SOL") {
        next += toNumberOrZero(s?.tokenBAmountUiFarmsStaked ?? s?.tokenBAmountUi);
      }
      return next;
    }, 0);

    const leveragePositions =
      (((positions.jupiterPerps.data as { raw?: { elements?: Array<{ type?: string; data?: { isolated?: { positions?: unknown[] } } }> } })
        ?.raw?.elements ?? [])
        .find((e) => e?.type === "leverage")
        ?.data?.isolated?.positions ?? []) as Array<{
        address?: string;
        side?: string;
        size?: number | string;
        markPrice?: number | string;
        liquidationPrice?: number | string;
      }>;

    const solPerpPositions = leveragePositions.filter(
      (p) => String(p?.address ?? "") === "So11111111111111111111111111111111111111112"
    );

    const jupiterSolShortSize = solPerpPositions.reduce((acc, p) => {
      const side = String(p?.side ?? "").toLowerCase();
      if (side !== "short") return acc;
      return acc + Math.abs(toNumberOrZero(p?.size));
    }, 0);

    const solMarkPrice = solPerpPositions.map((p) => Number(p?.markPrice)).find((v) => Number.isFinite(v)) ?? 0;
    const solLiqPrice = solPerpPositions.map((p) => Number(p?.liquidationPrice)).find((v) => Number.isFinite(v));

    const closestRangeBuffer = (summary.orcaWhirlpools?.positions ?? []).reduce<number | null>((min, p) => {
      const lower = normalizePct(p?.distanceToLowerPctFromCurrent);
      const upper = normalizePct(p?.distanceToUpperPctFromCurrent);
      const candidates = [lower, upper].filter((v) => Number.isFinite(v) && v >= 0);
      if (!candidates.length) return min;
      const next = Math.min(...candidates);
      return min == null ? next : Math.min(min, next);
    }, null);

    const solLong = (orcaSolAmount ?? 0) + (kaminoSolAmount ?? 0);

    const solShort = jupiterSolShortSize ?? 0;

    const solSystem = computeSolSystem({
      solLong,
      solShort,
      markPrice: solMarkPrice > 0 ? solMarkPrice : 1,
      liqPrice: solLiqPrice,
      rangeBufferPct: closestRangeBuffer ?? 0
    });

    return json(res, 200, {
      ...summary,
      solSystem
    });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
