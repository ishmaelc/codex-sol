import fs from "node:fs/promises";
import path from "node:path";
import type {
  AllocationOutput,
  AlertsOutput,
  PerformanceSummaryOutput,
  PlansOutput,
  PoolRankingOutput,
  RegimeState,
  ShortlistOutput
} from "./types.js";

export async function writeOrcaOutputs(args: {
  regimeState: RegimeState;
  poolRankings: PoolRankingOutput;
  shortlist?: ShortlistOutput;
  plans?: PlansOutput;
  allocation?: AllocationOutput;
  alerts?: AlertsOutput;
  performance?: PerformanceSummaryOutput;
}): Promise<{ regimePath: string; rankingsPath: string }> {
  const outDir = path.resolve(process.cwd(), "public/data/orca");
  await fs.mkdir(outDir, { recursive: true });

  const regimePath = path.join(outDir, "regime_state.json");
  const rankingsPath = path.join(outDir, "pool_rankings.json");
  const shortlistPath = path.join(outDir, "shortlist.json");
  const plansPath = path.join(outDir, "plans.json");
  const alertsPath = path.join(outDir, "alerts.json");
  const performancePath = path.join(outDir, "performance.json");
  const allocationPath = path.join(outDir, "allocation.json");

  await fs.writeFile(regimePath, `${JSON.stringify(args.regimeState, null, 2)}\n`, "utf8");
  await fs.writeFile(rankingsPath, `${JSON.stringify(args.poolRankings, null, 2)}\n`, "utf8");
  if (args.shortlist) await fs.writeFile(shortlistPath, `${JSON.stringify(args.shortlist, null, 2)}\n`, "utf8");
  if (args.plans) await fs.writeFile(plansPath, `${JSON.stringify(args.plans, null, 2)}\n`, "utf8");
  if (args.allocation) await fs.writeFile(allocationPath, `${JSON.stringify(args.allocation, null, 2)}\n`, "utf8");
  if (args.alerts) await fs.writeFile(alertsPath, `${JSON.stringify(args.alerts, null, 2)}\n`, "utf8");
  if (args.performance) await fs.writeFile(performancePath, `${JSON.stringify(args.performance, null, 2)}\n`, "utf8");

  return { regimePath, rankingsPath };
}
