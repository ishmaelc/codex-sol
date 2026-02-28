import { Decimal } from "decimal.js";

export interface DepositCalculation {
  tokenAQty: Decimal; // e.g., 7.5 SOL
  tokenBQty: Decimal; // e.g., 1500 USDC
  tokenAUsd: Decimal;
  tokenBUsd: Decimal;
  hedgeShortQty: Decimal; // e.g., 3.75 SOL (for SOL-USDC) or BTC equiv (for NX8)
  hedgeUsd: Decimal;
  rangePreset: string; // "Conservative" | "Base" | "Aggressive"
  riskCapitalPct: number; // % of capital exposed to market risk
  riskAssetLabel: string; // "SOL" | "SOL+MSOL" etc
}

export interface DepositRatioResult {
  tokenARatioUSD: number;
  tokenBRatioUSD: number;
  tokenASymbol: string;
  tokenBSymbol: string;
  riskAssetRatioUSD: number;
  riskAssetLabel: string;
}

/**
 * Convert an allocation percentage + total capital into actual deposit amounts and corresponding short size.
 * 
 * @param totalCapitalUsd Total available capital (in USD)
 * @param allocationPct Allocation to this pool (0-1, e.g., 0.15 for 15%)
 * @param depositRatio Token ratio from computeDepositRatioUSD() or similar
 * @param hedgeSizePerTopk Hedge sizing (e.g., from applyHedgePlans: hedgeUSD per $10k)
 * @param solSpotUsd Current SOL spot price in USD
 * @param shortAssetSpotUsd Spot price of short asset (SOL for SOL-USDC, BTC for NX8)
 * @param shortAssetSymbol Symbol of asset being shorted
 * @param rangePreset Name of range preset used
 * 
 * @returns DepositCalculation with exact token quantities and hedge size
 */
export function calculateDeposit(args: {
  totalCapitalUsd: Decimal | number;
  allocationPct: number; // 0-1
  depositRatio: DepositRatioResult;
  hedgeSizePerTopk: Decimal | number; // e.g., Decimal('950') for $950 per $10k
  solSpotUsd: number;
  shortAssetSpotUsd: number;
  shortAssetSymbol: string; // "SOL" | "BTC" etc
  rangePreset: string;
}): DepositCalculation {
  const total = new Decimal(args.totalCapitalUsd);
  const allocated = total.times(new Decimal(args.allocationPct));
  
  // Calculate actual token quantities
  const tokenAUsd = allocated.times(new Decimal(args.depositRatio.tokenARatioUSD));
  const tokenBUsd = allocated.times(new Decimal(args.depositRatio.tokenBRatioUSD));
  
  // Convert USD to token quantities
  const tokenAQty = tokenAUsd.dividedBy(new Decimal(args.solSpotUsd));
  const tokenBQty = tokenBUsd.dividedBy(new Decimal(1)); // Assume stable = 1 USD; will be adjusted if needed
  
  // Calculate hedge size: scale hedgeSizePerTopk to actual allocated amount
  const hedgeSizePerTop = new Decimal(args.hedgeSizePerTopk);
  const scaleFactor = allocated.dividedBy(new Decimal(10000));
  const hedgeUsd = hedgeSizePerTop.times(scaleFactor);
  const hedgeShortQty = hedgeUsd.dividedBy(new Decimal(args.shortAssetSpotUsd));
  
  return {
      tokenAQty: tokenAQty.toDecimalPlaces(6),
      tokenBQty: tokenBQty.toDecimalPlaces(6),
    tokenAUsd,
    tokenBUsd,
      hedgeShortQty: hedgeShortQty.toDecimalPlaces(6),
    hedgeUsd,
    rangePreset: args.rangePreset,
    riskCapitalPct: args.depositRatio.riskAssetRatioUSD,
    riskAssetLabel: args.depositRatio.riskAssetLabel
  };
}
