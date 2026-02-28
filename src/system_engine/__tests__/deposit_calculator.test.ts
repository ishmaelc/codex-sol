import { strict as assert } from "assert";
import { Decimal } from "decimal.js";
import { calculateDeposit } from "../positions/deposit_calculator.js";

const test = {
  "deposit_calculator: SOL-USDC 15% of $10k capital": () => {
    const calc = calculateDeposit({
      totalCapitalUsd: new Decimal("10000"),
      allocationPct: 0.15,
      depositRatio: {
        tokenARatioUSD: 0.45, // 45% SOL
        tokenBRatioUSD: 0.55, // 55% USDC
        tokenASymbol: "SOL",
        tokenBSymbol: "USDC",
        riskAssetRatioUSD: 0.45, // 45% risk exposure
        riskAssetLabel: "SOL"
      },
      hedgeSizePerTopk: new Decimal("950"), // $950 hedge per $10k
      solSpotUsd: 200,
      shortAssetSpotUsd: 200, // SOL
      shortAssetSymbol: "SOL",
      rangePreset: "Conservative"
    });

    // Allocated: $10k * 15% = $1,500
    // Token A (SOL): $1,500 * 45% = $675 → 675/200 = 3.375 SOL
    // Token B (USDC): $1,500 * 55% = $825 → 825 USDC
    // Hedge: $950 * ($1,500/$10,000) = $142.50 → 142.50/200 = 0.7125 SOL

    assert.strictEqual(calc.tokenAQty.toNumber().toFixed(6), "3.375000", "Token A qty");
    assert.strictEqual(calc.tokenBQty.toNumber().toFixed(6), "825.000000", "Token B qty");
    assert.strictEqual(calc.hedgeShortQty.toNumber().toFixed(6), "0.712500", "Hedge short qty");
    assert.strictEqual(calc.rangePreset, "Conservative");
    assert.strictEqual(calc.riskCapitalPct, 0.45);
  },

  "deposit_calculator: NX8 (higher BTC price) 20% allocation": () => {
    const calc = calculateDeposit({
      totalCapitalUsd: new Decimal("50000"),
      allocationPct: 0.20,
      depositRatio: {
        tokenARatioUSD: 0.40, // 40% NX8
        tokenBRatioUSD: 0.60, // 60% USDC
        tokenASymbol: "NX8",
        tokenBSymbol: "USDC",
        riskAssetRatioUSD: 0.40,
        riskAssetLabel: "NX8"
      },
      hedgeSizePerTopk: new Decimal("950"),
      solSpotUsd: 250, // Higher SOL price doesn't matter for NX8 hedge
      shortAssetSpotUsd: 45000, // BTC price
      shortAssetSymbol: "BTC",
      rangePreset: "Base"
    });

    // Allocated: $50k * 20% = $10,000
    // Token A (NX8): $10k * 40% = $4,000
    // Token B (USDC): $10k * 60% = $6,000
    // Hedge: $950 * ($10,000/$10,000) = $950 → 950/45000 = 0.0211 BTC

    assert.strictEqual(calc.tokenAUsd.toNumber(), 4000, "Token A USD");
    assert.strictEqual(calc.tokenBUsd.toNumber(), 6000, "Token B USD");
    assert(calc.hedgeShortQty.toNumber().toFixed(6) === "0.021111", "Hedge BTC qty ~0.0211");
    assert.strictEqual(calc.rangePreset, "Base");
  },

  "deposit_calculator: Rounding down for precision": () => {
    const calc = calculateDeposit({
      totalCapitalUsd: new Decimal("7777"),
      allocationPct: 0.33,
      depositRatio: {
        tokenARatioUSD: 0.333333, // repeating decimal
        tokenBRatioUSD: 0.666667,
        tokenASymbol: "SOL",
        tokenBSymbol: "USDC",
        riskAssetRatioUSD: 0.333333,
        riskAssetLabel: "SOL"
      },
      hedgeSizePerTopk: new Decimal("950"),
      solSpotUsd: 199.99,
      shortAssetSpotUsd: 199.99,
      shortAssetSymbol: "SOL",
      rangePreset: "Aggressive"
    });

    // Verify rounding down (no precision creep)
    const sum = calc.tokenAQty.plus(calc.tokenBQty);
    assert(
      sum.lessThanOrEqualTo(new Decimal("7777").times(new Decimal("0.33"))),
      "Sum should not exceed allocated amount"
    );
  }
};

export default test;
