/**
 * Rebalance Triggers Module
 * 
 * Detects when a system needs rebalancing based on:
 * - Delta drift (notional exposure beyond safe range)
 * - Liquidation buffer erosion (liq buffer < minimum)
 * - Range edge breach (price within N% of range boundary)
 */

export interface RebalanceTrigger {
  type: "delta_drift" | "liq_buffer_low" | "range_breach" | "none";
  severity: "warning" | "critical";
  message: string;
  rebalanceAction?: string; // e.g., "Short 200 SOL" or "Add collateral"
}

export interface RebalanceThresholds {
  deltaPercentTolerance: number; // e.g., 0.01 for ±1%
  liquidationBufferMinPct: number; // e.g., 0.20 for 20%
  rangeEdgeBreachDistancePct: number; // e.g., 0.02 for 2%
}

export const DEFAULT_REBALANCE_THRESHOLDS: RebalanceThresholds = {
  deltaPercentTolerance: 0.01, // 1% of notional
  liquidationBufferMinPct: 0.20, // 20% minimum
  rangeEdgeBreachDistancePct: 0.02 // 2% from edge
};

/**
 * Check if a system snapshot triggers any rebalance conditions.
 * 
 * @param snapshot System snapshot with exposures, liquidation, range data
 * @param thresholds Rebalance thresholds (uses defaults if not provided)
 * @returns RebalanceTrigger object (type='none' if no trigger)
 */
export function checkRebalanceTriggers(
  snapshot: {
    symbol?: string;
    exposures?: {
      netDelta?: number;
      netSOLDelta?: number;
      totalLongNotional?: number;
      totalLongSOL?: number;
    };
    liquidation?: {
      liqBufferRatio?: number | null;
    };
    range?: {
      rangeLower?: number | null;
      rangeUpper?: number | null;
      rangeBufferRatio?: number | null;
      currentPrice?: number;
    };
    pricesUsed?: {
      sol?: number;
    };
  },
  thresholds: Partial<RebalanceThresholds> = {}
): RebalanceTrigger {
  const t = { ...DEFAULT_REBALANCE_THRESHOLDS, ...thresholds };
  const symbol = String(snapshot.symbol ?? "SYSTEM").toUpperCase();
  const exposures = snapshot.exposures ?? {};
  const liq = snapshot.liquidation ?? {};
  const range = snapshot.range ?? {};
  
  // --- Check 1: Delta Drift ---
  const netDelta = typeof exposures.netDelta === "number" 
    ? exposures.netDelta 
    : typeof exposures.netSOLDelta === "number"
      ? exposures.netSOLDelta
      : null;

  const totalLong = typeof exposures.totalLongNotional === "number"
    ? exposures.totalLongNotional
    : typeof exposures.totalLongSOL === "number"
      ? exposures.totalLongSOL
      : null;

  if (netDelta != null && totalLong != null && totalLong > 0) {
    const netDeltaPct = Math.abs(netDelta) / totalLong;
    if (netDeltaPct > t.deltaPercentTolerance) {
      const severity = netDeltaPct > t.deltaPercentTolerance * 2 ? "critical" : "warning";
      const shortAmount = (netDelta > 0 ? netDelta : Math.abs(netDelta)) * 0.5; // Rebalance halfway
      return {
        type: "delta_drift",
        severity,
        message: `Net delta ${(netDeltaPct * 100).toFixed(1)}% (safe: ±${(t.deltaPercentTolerance * 100).toFixed(1)}%)`,
        rebalanceAction: `${symbol}: ${netDelta > 0 ? "Short" : "Long"} ${Math.abs(shortAmount).toFixed(0)} more to rebalance`
      };
    }
  }

  // --- Check 2: Liquidation Buffer ---
  if (
    liq.liqBufferRatio != null &&
    typeof liq.liqBufferRatio === "number" &&
    liq.liqBufferRatio < t.liquidationBufferMinPct
  ) {
    return {
      type: "liq_buffer_low",
      severity: "critical",
      message: `Liquidation buffer ${(liq.liqBufferRatio * 100).toFixed(1)}% (minimum: ${(t.liquidationBufferMinPct * 100).toFixed(0)}%)`,
      rebalanceAction: `${symbol}: Reduce leverage or increase collateral immediately`
    };
  }

  // --- Check 3: Range Edge Breach ---
  if (
    range.rangeLower != null &&
    range.rangeUpper != null &&
    range.currentPrice != null &&
    typeof range.currentPrice === "number"
  ) {
    const current = range.currentPrice;
    const lower = range.rangeLower;
    const upper = range.rangeUpper;
    const range_ = upper - lower;
    const distFromLower = current - lower;
    const distFromUpper = upper - current;
    
    const pctFromLower = distFromLower / range_;
    const pctFromUpper = distFromUpper / range_;

    if (pctFromLower < t.rangeEdgeBreachDistancePct) {
      return {
        type: "range_breach",
        severity: "warning",
        message: `Price ${current.toFixed(0)} is ${(pctFromLower * 100).toFixed(1)}% from lower bound (${lower.toFixed(0)})`,
        rebalanceAction: `${symbol}: Price approaching lower range bound. Prepare to rebalance to new range`
      };
    }

    if (pctFromUpper < t.rangeEdgeBreachDistancePct) {
      return {
        type: "range_breach",
        severity: "warning",
        message: `Price ${current.toFixed(0)} is ${(pctFromUpper * 100).toFixed(1)}% from upper bound (${upper.toFixed(0)})`,
        rebalanceAction: `${symbol}: Price approaching upper range bound. Prepare to rebalance to new range`
      };
    }
  }

  // No triggers
  return {
    type: "none",
    severity: "warning",
    message: ""
  };
}
