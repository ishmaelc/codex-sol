import type { CanonicalSystemSnapshot } from "../portfolio/types.js";

function clampRatio01(value: number | null): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function toFiniteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeSnapshot(snapshot: CanonicalSystemSnapshot): CanonicalSystemSnapshot {
  const mark = toFiniteOrNull(snapshot.pricesUsed.mark);
  const liqPriceRaw = toFiniteOrNull(snapshot.liquidation.liqPrice);
  const liqPrice = liqPriceRaw != null && liqPriceRaw > 0 ? liqPriceRaw : null;
  const rangeLower = toFiniteOrNull(snapshot.range.rangeLower);
  const rangeUpper = toFiniteOrNull(snapshot.range.rangeUpper);
  const hasBounds = rangeLower != null && rangeUpper != null;
  const rangeBufferRatio = hasBounds ? clampRatio01(snapshot.range.rangeBufferRatio) : null;
  const liqBufferRatio = clampRatio01(snapshot.liquidation.liqBufferRatio);
  const hedgeRatio = clampRatio01(snapshot.exposures.hedgeRatio) ?? 0;
  const leverage = toFiniteOrNull(snapshot.liquidation.leverage);

  return {
    ...snapshot,
    pricesUsed: {
      ...snapshot.pricesUsed,
      mark
    },
    dataFreshness: {
      ...snapshot.dataFreshness,
      hasMarkPrice: mark != null,
      hasLiqPrice: liqPrice != null,
      hasRangeBuffer: rangeBufferRatio != null
    },
    exposures: {
      ...snapshot.exposures,
      hedgeRatio
    },
    liquidation: {
      ...snapshot.liquidation,
      liqPrice,
      liqBufferRatio: liqPrice == null ? null : liqBufferRatio,
      leverage: liqPrice == null ? null : leverage
    },
    range: {
      ...snapshot.range,
      rangeBufferRatio
    },
    debugMath: {
      ...snapshot.debugMath,
      liqBufferRatio: liqPrice == null ? null : clampRatio01(snapshot.debugMath.liqBufferRatio),
      rangeBufferRatio
    }
  };
}
