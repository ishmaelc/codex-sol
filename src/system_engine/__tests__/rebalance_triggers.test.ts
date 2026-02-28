import { strict as assert } from "assert";
import { checkRebalanceTriggers, DEFAULT_REBALANCE_THRESHOLDS } from "../alerts/rebalance_triggers.js";

const test = {
  "rebalance_triggers: No trigger when delta within tolerance": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      exposures: {
        netSOLDelta: 300, // 300 / 30,000 = 1% drift
        totalLongSOL: 30000
      }
    });

    assert.strictEqual(result.type, "none", "Should have no trigger");
    assert.strictEqual(result.message, "");
  },

  "rebalance_triggers: Warning when delta at 1.5% (above 1% threshold)": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      exposures: {
        netSOLDelta: 450, // 450 / 30,000 = 1.5% drift
        totalLongSOL: 30000
      }
    });

    assert.strictEqual(result.type, "delta_drift", "Should trigger delta_drift");
    assert.strictEqual(result.severity, "warning", "Severity should be warning (< 2% threshold)");
    assert(result.message.includes("1.5"), "Message should mention 1.5%");
    assert(result.rebalanceAction?.includes("Short"), "Should suggest shorting");
  },

  "rebalance_triggers: Critical when delta at 2.5% (above 2% critical threshold)": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      exposures: {
        netSOLDelta: 750, // 750 / 30,000 = 2.5% drift
        totalLongSOL: 30000
      }
    });

    assert.strictEqual(result.type, "delta_drift", "Should trigger delta_drift");
    assert.strictEqual(result.severity, "critical", "Severity should be critical (>= 2% threshold)");
    assert(result.message.includes("2.5"), "Message should mention 2.5%");
  },

  "rebalance_triggers: Critical when liquidation buffer below 20%": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      liquidation: {
        liqBufferRatio: 0.15 // 15%, below 20% threshold
      }
    });

    assert.strictEqual(result.type, "liq_buffer_low", "Should trigger liq_buffer_low");
    assert.strictEqual(result.severity, "critical");
    assert(result.message.includes("15"), "Should mention 15% buffer");
    assert(result.rebalanceAction?.includes("collateral"), "Should suggest adding collateral");
  },

  "rebalance_triggers: No trigger when liquidation buffer at 20% (threshold boundary)": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      liquidation: {
        liqBufferRatio: 0.20 // Exactly at threshold
      }
    });

    assert.strictEqual(result.type, "none", "Should not trigger at threshold boundary");
  },

  "rebalance_triggers: Warning when price within 2% of lower range edge": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      range: {
        rangeLower: 190,
        rangeUpper: 210,
        currentPrice: 191.9 // 1.9 / 20 = 9.5% from lower (< 2% threshold? No, 9.5% > 2%)
      }
    });

    // Actually 1.9 / 20 = 0.095 = 9.5%, which is > 2%, so no trigger
    assert.strictEqual(result.type, "none", "9.5% from edge should not trigger");
  },

  "rebalance_triggers: Warning when price within 2% of lower range edge (actual trigger)": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      range: {
        rangeLower: 190,
        rangeUpper: 210,
        currentPrice: 190.4 // 0.4 / 20 = 2% from lower edge (at threshold or just under)
      }
    });

    // 0.4 / 20 = 0.02 = 2%, at threshold should trigger
    assert.strictEqual(result.type, "range_breach", "Should trigger range_breach at 2%");
    assert(result.message.includes("lower"), "Should mention lower bound");
  },

  "rebalance_triggers: Warning when price within 2% of upper range edge": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      range: {
        rangeLower: 190,
        rangeUpper: 210,
        currentPrice: 209.6 // 0.4 / 20 = 2% from upper edge
      }
    });

    assert.strictEqual(result.type, "range_breach", "Should trigger range_breach");
    assert(result.message.includes("upper"), "Should mention upper bound");
  },

  "rebalance_triggers: Uses custom thresholds": () => {
    const result = checkRebalanceTriggers(
      {
        symbol: "NX8",
        exposures: {
          netDelta: 100, // 100 / 10,000 = 1% drift
          totalLongNotional: 10000
        }
      },
      {
        deltaPercentTolerance: 0.005 // 0.5% tolerance (stricter)
      }
    );

    assert.strictEqual(result.type, "delta_drift", "Should trigger with stricter threshold");
    assert(result.message.includes("1.0"), "Should show 1.0% drift");
  },

  "rebalance_triggers: Handles missing data gracefully": () => {
    const result = checkRebalanceTriggers({
      symbol: "SOL",
      // No exposures, liquidation, or range data
    });

    assert.strictEqual(result.type, "none", "Should not crash on missing data");
  }
};

export default test;
