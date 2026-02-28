/**
 * Basis Risk Calculator
 * 
 * Computes how effective an alternative asset is as a hedge against NX8.
 * Focus: BTC is the primary hedge; can add SOL/ETH later.
 * 
 * Basis risk = risk that hedge asset diverges from underlying (NX8 in this case)
 */

export interface BasisRiskScore {
  asset: string; // "BTC", "SOL", "ETH"
  correlation30d: number; // 0-1, how correlated to NX8
  volatilityNx8: number; // % annual vol
  volatilityAsset: number; // % annual vol
  relativeVol: number; // volatilityAsset / volatilityNx8
  effectivenessScore: number; // 0-100, higher = better hedge
  penalty: number; // 0-0.20 penalty for scoring (lower correlation = higher penalty)
  label: string; // "Excellent" | "Good" | "Acceptable" | "Low" | "Poor"
}

/**
 * Calculate basis risk for a given hedge asset vs NX8.
 * 
 * Simplified version: uses hard-coded correlation estimates for known assets.
 * In production, this would fetch 30d price history and compute actual correlation.
 * 
 * @param assetSymbol Asset to evaluate as hedge ("BTC", "SOL", "ETH")
 * @returns BasisRiskScore
 */
export function computeNx8BasisRisk(assetSymbol: string): BasisRiskScore {
  const asset = String(assetSymbol ?? "").toUpperCase().trim();

  // Hard-coded correlations for NX8 (based on historical market data patterns)
  // These would be replaced with live correlation calculation in production
  const estimates: Record<
    string,
    { correlation: number; volAsset: number; volNx8: number }
  > = {
    BTC: { correlation: 0.87, volAsset: 0.72, volNx8: 0.65 }, // Strong hedge
    SOL: { correlation: 0.65, volAsset: 0.78, volNx8: 0.65 }, // Moderate, higher vol
    ETH: { correlation: 0.72, volAsset: 0.70, volNx8: 0.65 } // Good, similar vol
  };

  const estimate = estimates[asset] || { correlation: 0.5, volAsset: 0.8, volNx8: 0.65 };
  const { correlation, volAsset, volNx8 } = estimate;

  // Effectiveness score: high correlation + relative vol close to 1.0 = better hedge
  // Formula: (correlation * 100) - abs(relVol - 1.0) * 20
  const relativeVol = volAsset / volNx8;
  const volPenalty = Math.abs(relativeVol - 1.0) * 20;
  const effectivenessScore = Math.max(0, Math.min(100, correlation * 100 - volPenalty));

  // Penalty for scoring (how much to reduce health score)
  // correlation >= 0.80 → penalty = 0.02 (minimal)
  // correlation 0.60-0.79 → penalty = 0.08 (moderate)
  // correlation < 0.60 → penalty = 0.15 (high)
  let penalty: number;
  if (correlation >= 0.80) {
    penalty = 0.02;
  } else if (correlation >= 0.60) {
    penalty = 0.08;
  } else if (correlation >= 0.50) {
    penalty = 0.15;
  } else {
    penalty = 0.20;
  }

  // Label based on effectiveness
  let label: string;
  if (effectivenessScore >= 80) {
    label = "Excellent";
  } else if (effectivenessScore >= 70) {
    label = "Good";
  } else if (effectivenessScore >= 60) {
    label = "Acceptable";
  } else if (effectivenessScore >= 50) {
    label = "Low";
  } else {
    label = "Poor";
  }

  return {
    asset,
    correlation30d: correlation,
    volatilityNx8: volNx8,
    volatilityAsset: volAsset,
    relativeVol,
    effectivenessScore,
    penalty,
    label
  };
}

/**
 * Recommend a primary hedge asset (BTC preferred per user preference).
 */
export function recommendPrimaryHedge(): string {
  // For now, always BTC as primary per user's stated preference
  return "BTC";
}

/**
 * Return all available hedge alternatives ranked by effectiveness.
 */
export function rankHedgeAlternatives(): BasisRiskScore[] {
  const assets = ["BTC", "SOL", "ETH"];
  return assets.map((asset) => computeNx8BasisRisk(asset)).sort((a, b) => b.effectivenessScore - a.effectivenessScore);
}
