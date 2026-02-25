import fs from "node:fs/promises";
import path from "node:path";
import type {
  AlertsOutput,
  PerformanceLedgerSnapshot,
  PerformanceSummaryOutput,
  PoolRankingOutput,
  RegimeLabel,
  RegimeState,
  ShortlistOutput
} from "./types.js";

const LEDGER_PATH = path.resolve(process.cwd(), "data/performance_ledger.jsonl");
const SUMMARY_PATH = path.resolve(process.cwd(), "public/data/orca/performance.json");

async function ensureLedgerFile() {
  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  try {
    await fs.access(LEDGER_PATH);
  } catch {
    await fs.writeFile(LEDGER_PATH, "", "utf8");
  }
}

export function buildPerformanceSnapshot(args: {
  regime: RegimeState;
  shortlist: ShortlistOutput;
  rankings: PoolRankingOutput;
  alerts: AlertsOutput;
}): PerformanceLedgerSnapshot {
  const rows = new Map((args.rankings.topPoolsOverall ?? args.rankings.pools).map((p) => [p.poolAddress, p]));
  return {
    ts: new Date().toISOString(),
    regime: args.regime.regime,
    regimeScore: args.regime.score,
    fundingAprPct: args.regime.metrics.fundingAprPct,
    shortlistCount: args.shortlist.selected.length,
    shortlistedPools: args.shortlist.selected.map((s) => {
      const r = rows.get(s.poolAddress);
      return {
        poolAddress: s.poolAddress,
        pool: s.pool,
        type: s.type,
        score: s.score,
        feeAprPct: s.feeAprPct,
        volumeTvl: r?.volumeTvl ?? null
      };
    }),
    alertsCount: args.alerts.alerts.length
  };
}

export async function appendPerformanceSnapshot(snapshot: PerformanceLedgerSnapshot): Promise<string> {
  await ensureLedgerFile();
  await fs.appendFile(LEDGER_PATH, `${JSON.stringify(snapshot)}\n`, "utf8");
  return LEDGER_PATH;
}

export async function readPerformanceLedger(): Promise<PerformanceLedgerSnapshot[]> {
  await ensureLedgerFile();
  const raw = await fs.readFile(LEDGER_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PerformanceLedgerSnapshot;
      } catch {
        return null;
      }
    })
    .filter((x): x is PerformanceLedgerSnapshot => Boolean(x));
}

export async function writePerformanceSummary(lookbackDays = 7): Promise<{ path: string; output: PerformanceSummaryOutput }> {
  const all = await readPerformanceLedger();
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const snapshots = all.filter((s) => {
    const t = Date.parse(s.ts);
    return Number.isFinite(t) && t >= cutoff;
  });
  const regimeCounts: Record<RegimeLabel, number> = { LOW: 0, MODERATE: 0, HIGH: 0 };
  for (const s of snapshots) regimeCounts[s.regime] += 1;
  const fundingVals = snapshots.map((s) => s.fundingAprPct).filter((x): x is number => x != null && Number.isFinite(x));
  const avgFundingAprPct =
    fundingVals.length > 0 ? Number((fundingVals.reduce((a, b) => a + b, 0) / fundingVals.length).toFixed(3)) : null;

  const output: PerformanceSummaryOutput = {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    snapshots,
    summary: {
      snapshotCount: snapshots.length,
      avgFundingAprPct,
      regimeCounts,
      latestSnapshotTs: snapshots.at(-1)?.ts
    },
    notes: ["Performance summary is a rolling snapshot ledger summary, not realized PnL."]
  };

  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true });
  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return { path: SUMMARY_PATH, output };
}

export async function ensurePerformanceArtifacts(): Promise<void> {
  await ensureLedgerFile();
  await writePerformanceSummary();
}

export { LEDGER_PATH };
