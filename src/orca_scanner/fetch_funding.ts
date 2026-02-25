import type { FundingProxyResult } from "./types.js";

const BORROW_RATE_PCT_PER_HOUR = 0.0004;
const HOURS_PER_YEAR = 24 * 365;

export function fixedBorrowRateFundingAprPct(hourlyBorrowRatePct = BORROW_RATE_PCT_PER_HOUR): number {
  return hourlyBorrowRatePct * HOURS_PER_YEAR;
}

export async function fetchSolFundingProxyFromJupiter(): Promise<FundingProxyResult> {
  const apr = fixedBorrowRateFundingAprPct();
  return {
    source: "fixed-borrow-rate",
    symbol: "SOL",
    fundingAprPct: Number(apr.toFixed(3)),
    rawRate: BORROW_RATE_PCT_PER_HOUR / 100,
    ratePeriod: "hour",
    asOf: new Date().toISOString(),
    note: `Derived from fixed borrow rate ${BORROW_RATE_PCT_PER_HOUR}%/hr (APR = rate * 24 * 365).`
  };
}
