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

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
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

export function buildPositionsSummaryInputs(
  fullPayload: PositionsPayloadLike,
  options: { debug?: boolean } = {}
): SummaryInputs {
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

  const markPriceIdx = solPerpPositions.findIndex((p) => Number.isFinite(Number(p?.markPrice)));
  const markPriceRaw = markPriceIdx >= 0 ? Number(solPerpPositions[markPriceIdx]?.markPrice) : null;
  const liqPriceRaw = solPerpPositions.map((p) => Number(p?.liquidationPrice)).find((v) => Number.isFinite(v));
  const markPrice = markPriceRaw != null && markPriceRaw > 0 ? markPriceRaw : null;
  const liqPrice = liqPriceRaw != null && liqPriceRaw > 0 ? liqPriceRaw : null;

  const rangeState = orcaPositions.reduce<{
    rangeBufferRatio: number | null;
    rangeLower: number | null;
    rangeUpper: number | null;
    sourceIndex: number | null;
    width: number | null;
    dLower: number | null;
    dUpper: number | null;
    closestEdge: number | null;
    rawRatio: number | null;
  }>(
    (state, p, idx) => {
      if (markPrice == null) return state;
      const lowerRaw = toNullableNumber(p?.rangeLower);
      const upperRaw = toNullableNumber(p?.rangeUpper);
      if (lowerRaw == null || upperRaw == null) return state;
      const rangeLower = Math.min(lowerRaw, upperRaw);
      const rangeUpper = Math.max(lowerRaw, upperRaw);
      const width = rangeUpper - rangeLower;
      if (!Number.isFinite(width) || width <= 0) return state;
      const dLower = markPrice - rangeLower;
      const dUpper = rangeUpper - markPrice;
      const closestEdge = Math.min(dLower, dUpper);
      const rawRatio = closestEdge / width;
      const next = clamp01(rawRatio);
      if (state.rangeBufferRatio == null || next < state.rangeBufferRatio) {
        return {
          rangeBufferRatio: next,
          rangeLower,
          rangeUpper,
          sourceIndex: idx,
          width,
          dLower,
          dUpper,
          closestEdge,
          rawRatio
        };
      }
      return state;
    },
    { rangeBufferRatio: null, rangeLower: null, rangeUpper: null, sourceIndex: null, width: null, dLower: null, dUpper: null, closestEdge: null, rawRatio: null }
  );

  if (options.debug) {
    console.log(JSON.stringify({
      tag: "RANGE_DEBUG",
      markPrice,
      rangeLower: rangeState.rangeLower,
      rangeUpper: rangeState.rangeUpper,
      width: rangeState.width,
      dLower: rangeState.dLower,
      dUpper: rangeState.dUpper,
      closestEdge: rangeState.closestEdge,
      rawRatio: rangeState.rawRatio,
      clampedRatio: rangeState.rangeBufferRatio,
      source: {
        markSource: markPriceIdx >= 0 ? `jupiterPerps.leverage.positions[${markPriceIdx}].markPrice` : null,
        rangeSource: rangeState.sourceIndex != null ? `orcaWhirlpools.positions[${rangeState.sourceIndex}]` : null,
        formula: "clamp01(min(mark-rangeLower, rangeUpper-mark)/(rangeUpper-rangeLower))"
      }
    }));
  }

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
