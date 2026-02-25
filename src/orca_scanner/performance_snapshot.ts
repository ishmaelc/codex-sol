import { buildAlerts } from "./monitor.js";
import { readPerformanceLedger, appendPerformanceSnapshot, buildPerformanceSnapshot, writePerformanceSummary } from "./performance.js";
import type { AlertsOutput, PlansOutput, PoolRankingOutput, RegimeState, ShortlistOutput } from "./types.js";
import fs from "node:fs/promises";
import path from "node:path";

async function readJson<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as T;
}

async function main() {
  const base = path.resolve(process.cwd(), "public/data/orca");
  const regime = await readJson<RegimeState>(path.join(base, "regime_state.json"));
  const rankings = await readJson<PoolRankingOutput>(path.join(base, "pool_rankings.json"));
  const shortlist = await readJson<ShortlistOutput>(path.join(base, "shortlist.json"));
  let alerts: AlertsOutput;
  try {
    alerts = await readJson<AlertsOutput>(path.join(base, "alerts.json"));
  } catch {
    // Fallback if alerts not generated yet.
    const plans = await readJson<PlansOutput>(path.join(base, "plans.json"));
    alerts = buildAlerts({ regime, rankings, shortlist, plans });
  }

  const snapshot = buildPerformanceSnapshot({ regime, rankings, shortlist, alerts });
  const ledgerPath = await appendPerformanceSnapshot(snapshot);
  const summary = await writePerformanceSummary(7);
  const ledgerCount = (await readPerformanceLedger()).length;

  console.log(`[orca] appended performance snapshot -> ${ledgerPath}`);
  console.log(`[orca] ledger snapshots: ${ledgerCount}`);
  console.log(`[orca] wrote performance summary -> ${summary.path}`);
}

main().catch((err) => {
  console.error("[orca] performance snapshot failed:", err);
  process.exitCode = 1;
});
