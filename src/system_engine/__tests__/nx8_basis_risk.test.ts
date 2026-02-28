import { strict as assert } from "assert";
import { computeNx8BasisRisk, rankHedgeAlternatives, recommendPrimaryHedge } from "../sol/basis_risk.js";

const test = {
  "nx8_basis_risk: BTC basis risk score": () => {
    const btcRisk = computeNx8BasisRisk("BTC");

    assert.strictEqual(btcRisk.asset, "BTC");
    assert.strictEqual(btcRisk.correlation30d, 0.87, "BTC correlation to NX8");
    assert(btcRisk.effectivenessScore > 70, "BTC should score > 70 (Good)");
    assert.strictEqual(btcRisk.penalty, 0.02, "BTC penalty should be minimal (0.02)");
    assert.strictEqual(btcRisk.label, "Good", "BTC should be rated 'Good'");
  },

  "nx8_basis_risk: SOL basis risk score": () => {
    const solRisk = computeNx8BasisRisk("SOL");

    assert.strictEqual(solRisk.asset, "SOL");
    assert.strictEqual(solRisk.correlation30d, 0.65, "SOL correlation to NX8");
    assert(solRisk.effectivenessScore < btcScore().effectivenessScore, "SOL < BTC effectiveness");
    assert.strictEqual(solRisk.penalty, 0.08, "SOL penalty (0.08)");
    assert.strictEqual(solRisk.label, "Acceptable", "SOL should be rated 'Acceptable'");
  },

  "nx8_basis_risk: ETH basis risk score": () => {
    const ethRisk = computeNx8BasisRisk("ETH");

    assert.strictEqual(ethRisk.asset, "ETH");
    assert.strictEqual(ethRisk.correlation30d, 0.72, "ETH correlation to NX8");
    assert(ethRisk.effectivenessScore > 65, "ETH should score > 65");
    assert(ethRisk.penalty <= 0.08, "ETH penalty should be <= 0.08");
  },

  "nx8_basis_risk: BTC is primary hedge (user preference)": () => {
    const primary = recommendPrimaryHedge();
    assert.strictEqual(primary, "BTC", "Primary hedge should be BTC");
  },

  "nx8_basis_risk: Hedge alternatives ranked by effectiveness": () => {
    const ranked = rankHedgeAlternatives();

    assert.strictEqual(ranked.length, 3, "Should return 3 assets");
    assert.strictEqual(ranked[0].asset, "BTC", "BTC should be ranked first");
    assert(ranked[0].effectivenessScore > ranked[1].effectivenessScore, "Ranking should be descending");
  },

  "nx8_basis_risk: Unknown asset falls back gracefully": () => {
    const unknownRisk = computeNx8BasisRisk("XYZ");

    assert.strictEqual(unknownRisk.asset, "XYZ");
    assert.strictEqual(unknownRisk.correlation30d, 0.5, "Unknown asset default correlation");
    assert(unknownRisk.penalty === 0.15, "Unknown asset penalty (0.15)");
    assert.strictEqual(unknownRisk.label, "Low", "Unknown asset should be rated 'Low'");
  },

  "nx8_basis_risk: Relative volatility calculation": () => {
    const btcRisk = computeNx8BasisRisk("BTC");

    const expectedRel = 0.72 / 0.65;
    assert.strictEqual(btcRisk.relativeVol.toFixed(4), expectedRel.toFixed(4), "Relative vol = vol_asset / vol_nx8");
  }
};

function btcScore() {
  return computeNx8BasisRisk("BTC");
}

export default test;
