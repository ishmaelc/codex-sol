import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildSolSystemSnapshot } from "../../portfolio/systems/sol_system.js";

// Helper to write minimal orca files so that buildSolSystemSnapshot can run
async function writeOrcaFiles(overrides: Partial<Record<string, unknown>> = {}) {
  const base = path.resolve(process.cwd(), "public/data/orca");
  await fs.mkdir(base, { recursive: true });
  const plans = {
    plans: [
      {
        type: "SOL-STABLE",
        spotPrice: 100,
        hedge: {
          recommendedShortSolPer10kUsd: 5
        },
        presets: [{ label: "Base", lowerPrice: 90, upperPrice: 110, halfWidthPct: 0.1 }]
      }
    ]
  };
  const shortlist = { selected: [{ type: "SOL-STABLE", pool: "SOL/USDC" }] };
  const rankings = { topPoolsOverall: [{ pool: "SOL/USDC", spotPrice: 100 }] };
  const regime = { regime: "MODERATE", confidence: 0.5 };
  await Promise.all([
    fs.writeFile(path.join(base, "plans.json"), JSON.stringify(plans)),
    fs.writeFile(path.join(base, "shortlist.json"), JSON.stringify(shortlist)),
    fs.writeFile(path.join(base, "pool_rankings.json"), JSON.stringify(rankings)),
    fs.writeFile(path.join(base, "regime_state.json"), JSON.stringify(regime))
  ]);
}

// wipe orca files (optional cleanup)
async function cleanupOrcaFiles() {
  const base = path.resolve(process.cwd(), "public/data/orca");
  try {
    await fs.rm(base, { recursive: true, force: true });
  } catch {}
}

test("sol system snapshot includes accurate deposit recommendation", async () => {
  // ensure minimal orca data present
  await writeOrcaFiles();

  const snap = await buildSolSystemSnapshot({ wallet: undefined });
  assert.ok(snap.depositRecommendation, "should have depositRecommendation when shortlist.toks present");

  const dr = snap.depositRecommendation!;
  // default deployUsd is 10000 and spotPrice=100, so deposit should be 50 SOL + 5000 USDC
  assert.equal(dr.tokenASymbol, "SOL");
  assert.equal(dr.tokenBSymbol, "USDC");
  assert.equal(dr.tokenAQty, 50);
  assert.equal(dr.tokenBQty, 5000);
  // hedge quantity derived from solPer10k 5 SOL => hedgeUsdPerTopk=500 USD => short qty 5 SOL
  assert.equal(dr.hedgeShortQty, 5);

  // cleanup to avoid side effects on other tests
  await cleanupOrcaFiles();
});

// when no shortlist selected, depositRecommendation should be absent
test("sol snapshot has no depositRecommendation if shortlist empty", async () => {
  await writeOrcaFiles();
  // overwrite shortlist with empty
  const base = path.resolve(process.cwd(), "public/data/orca");
  await fs.writeFile(path.join(base, "shortlist.json"), JSON.stringify({ selected: [] }));

  const snap = await buildSolSystemSnapshot({ wallet: undefined });
  assert.equal(snap.depositRecommendation, null);

  await cleanupOrcaFiles();
});
