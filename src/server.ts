import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { buildSummary, fetchWalletPositions } from "./index.js";
import { computeSolSystem } from "./sol_system.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const positionsCacheTtlMs = Math.max(0, Number(process.env.POSITIONS_CACHE_TTL_MS ?? 15000));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const positionsCache = new Map<string, { ts: number; payload: unknown }>();

app.use(express.json());
app.use(
  express.static(publicDir, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  })
);

function toNumberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function toNullableNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

app.get("/api/positions", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  const mode = String(req.query.mode ?? "summary").trim().toLowerCase();

  if (!wallet) {
    res.status(400).json({ error: "Missing query param: wallet" });
    return;
  }

  try {
    new PublicKey(wallet);
  } catch {
    res.status(400).json({ error: "Invalid Solana wallet address" });
    return;
  }

  const cacheKey = `${wallet}:${mode}`;
  const cached = positionsCache.get(cacheKey);
  const now = Date.now();
  if (positionsCacheTtlMs > 0 && cached && now - cached.ts <= positionsCacheTtlMs) {
    res.json(cached.payload);
    return;
  }

  try {
    const positions = await fetchWalletPositions(wallet);
    if (mode === "full") {
      positionsCache.set(cacheKey, { ts: now, payload: positions });
      res.json(positions);
      return;
    }
    const summary = buildSummary(positions) as {
      orcaWhirlpools?: {
        positions?: Array<{
          tokenA?: string | null;
          tokenB?: string | null;
          amountAEstUi?: number | null;
          amountBEstUi?: number | null;
          distanceToLowerPctFromCurrent?: number | null;
          distanceToUpperPctFromCurrent?: number | null;
          rangeLower?: number | null;
          rangeUpper?: number | null;
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

    const rangeState = (summary.orcaWhirlpools?.positions ?? []).reduce<{
      rangeBufferRatio: number | null;
      rangeLower: number | null;
      rangeUpper: number | null;
    }>(
      (state, p) => {
      const lower = normalizePct(p?.distanceToLowerPctFromCurrent);
      const upper = normalizePct(p?.distanceToUpperPctFromCurrent);
      const candidates = [lower, upper].filter((v) => Number.isFinite(v) && v >= 0);
        if (!candidates.length) return state;
      const next = Math.min(...candidates);
        if (state.rangeBufferRatio == null || next < state.rangeBufferRatio) {
          return {
            rangeBufferRatio: next,
            rangeLower: toNullableNumber(p?.rangeLower),
            rangeUpper: toNullableNumber(p?.rangeUpper)
          };
        }
        return state;
      },
      { rangeBufferRatio: null, rangeLower: null, rangeUpper: null }
    );

    const solSystem = computeSolSystem({
      solLong: (orcaSolAmount ?? 0) + (kaminoSolAmount ?? 0),
      solShort: jupiterSolShortSize ?? 0,
      markPrice: solMarkPrice > 0 ? solMarkPrice : 1,
      liqPrice: solLiqPrice ?? undefined,
      rangeBufferPct: rangeState.rangeBufferRatio ?? 0,
      rangeLower: rangeState.rangeLower ?? undefined,
      rangeUpper: rangeState.rangeUpper ?? undefined
    });

    const payload = { ...summary, solSystem };
    positionsCache.set(cacheKey, { ts: now, payload });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`dashboard server listening on http://localhost:${port}`);
});
