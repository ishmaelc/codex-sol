export type SummaryInputs = {
  solLong: number;
  solShort: number;
  markPrice: number | null;
  liqPrice: number | null;
  rangeLower: number | null;
  rangeUpper: number | null;
  rangeBufferRatio: number | null;
  reasons: string[];
};

export type SolSystemInput = {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
  rangeLower?: number;
  rangeUpper?: number;
  reasons?: string[];
};

export type PositionsPayloadLike = {
  jupiterPerps?: {
    data?: unknown;
  };
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
  reasons?: string[];
};

function toNumberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePctToRatio(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const ratio = Math.abs(n) > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, ratio));
}

function toLeveragePositions(payload: PositionsPayloadLike): Array<{
  address?: string;
  side?: string;
  size?: number | string;
  markPrice?: number | string;
  liquidationPrice?: number | string;
}> {
  const raw = ((payload.jupiterPerps?.data as { raw?: unknown } | undefined)?.raw ?? {}) as {
    elements?: Array<{
      type?: string;
      data?: {
        isolated?: {
          positions?: unknown[];
        };
      };
    }>;
  };
  const leverage = (raw?.elements ?? []).find((e) => e?.type === "leverage");
  return (leverage?.data?.isolated?.positions ?? []) as Array<{
    address?: string;
    side?: string;
    size?: number | string;
    markPrice?: number | string;
    liquidationPrice?: number | string;
  }>;
}

export function buildPositionsSummaryInputs(fullPayload: PositionsPayloadLike): SummaryInputs {
  const orcaPositions = fullPayload.orcaWhirlpools?.positions ?? [];
  const strategyVals = fullPayload.kaminoLiquidity?.strategyValuations ?? [];

  const orcaSolAmount = orcaPositions.reduce((acc, p) => {
    let next = acc;
    if (String(p?.tokenA ?? "").toUpperCase() === "SOL") next += toNumberOrZero(p?.amountAEstUi);
    if (String(p?.tokenB ?? "").toUpperCase() === "SOL") next += toNumberOrZero(p?.amountBEstUi);
    return next;
  }, 0);

  const kaminoSolAmount = strategyVals.reduce((acc, s) => {
    let next = acc;
    if (String(s?.tokenASymbol ?? "").toUpperCase() === "SOL") {
      next += toNumberOrZero(s?.tokenAAmountUiFarmsStaked ?? s?.tokenAAmountUi);
    }
    if (String(s?.tokenBSymbol ?? "").toUpperCase() === "SOL") {
      next += toNumberOrZero(s?.tokenBAmountUiFarmsStaked ?? s?.tokenBAmountUi);
    }
    return next;
  }, 0);

  const leveragePositions = toLeveragePositions(fullPayload);
  const solPerpPositions = leveragePositions.filter(
    (p) => String(p?.address ?? "") === "So11111111111111111111111111111111111111112"
  );

  const solShort = solPerpPositions.reduce((acc, p) => {
    const side = String(p?.side ?? "").toLowerCase();
    if (side !== "short") return acc;
    return acc + Math.abs(toNumberOrZero(p?.size));
  }, 0);

  const markPriceRaw = solPerpPositions.map((p) => Number(p?.markPrice)).find((v) => Number.isFinite(v));
  const liqPriceRaw = solPerpPositions.map((p) => Number(p?.liquidationPrice)).find((v) => Number.isFinite(v));
  const markPrice = markPriceRaw != null && markPriceRaw > 0 ? markPriceRaw : null;
  const liqPrice = liqPriceRaw != null && liqPriceRaw > 0 ? liqPriceRaw : null;

  const rangeState = orcaPositions.reduce<{
    rangeBufferRatio: number | null;
    rangeLower: number | null;
    rangeUpper: number | null;
  }>(
    (state, p) => {
      const lower = normalizePctToRatio(p?.distanceToLowerPctFromCurrent);
      const upper = normalizePctToRatio(p?.distanceToUpperPctFromCurrent);
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

  return {
    solLong: orcaSolAmount + kaminoSolAmount,
    solShort,
    markPrice,
    liqPrice,
    rangeLower: rangeState.rangeLower,
    rangeUpper: rangeState.rangeUpper,
    rangeBufferRatio: rangeState.rangeBufferRatio,
    reasons: Array.isArray(fullPayload.reasons) ? [...fullPayload.reasons] : []
  };
}

export function buildSolSystemInputsFromSummary(summary: SummaryInputs): SolSystemInput {
  return {
    solLong: summary.solLong,
    solShort: summary.solShort,
    markPrice: summary.markPrice != null && summary.markPrice > 0 ? summary.markPrice : 1,
    liqPrice: summary.liqPrice ?? undefined,
    rangeBufferPct: summary.rangeBufferRatio ?? 0,
    rangeLower: summary.rangeLower ?? undefined,
    rangeUpper: summary.rangeUpper ?? undefined,
    reasons: summary.reasons
  };
}
