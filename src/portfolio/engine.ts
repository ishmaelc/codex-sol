import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCadenceHours } from "./operator_mode.js";
import { nx8SystemDefinition } from "./systems/nx8_system.js";
import { solSystemDefinition } from "./systems/sol_system.js";
import type { HedgedSystemDefinition, HedgedSystemSnapshot } from "./types.js";
import { scoreFromPortfolioScore } from "../system_engine/score_adapter.js";
import { normalizeSnapshot } from "../system_engine/invariants.js";

const systems: HedgedSystemDefinition[] = [solSystemDefinition, nx8SystemDefinition];

export function buildPortfolioIndexSystemEntry(s: HedgedSystemSnapshot): {
  id: string;
  label: string;
  score: number;
  status: HedgedSystemSnapshot["breakdown"]["status"];
  netDelta: number;
  leverage: number | null;
  liqBufferPct: number | null;
  riskFlags: HedgedSystemSnapshot["riskFlags"];
  updatedAt: string;
  scoreObj: ReturnType<typeof scoreFromPortfolioScore>;
  snapshot: HedgedSystemSnapshot["canonicalSnapshot"] | null;
} {
  const normalizedSnapshot = s.canonicalSnapshot ? normalizeSnapshot(s.canonicalSnapshot) : null;
  const computedScore = scoreFromPortfolioScore({
    portfolioScore: s.breakdown,
    reasons: normalizedSnapshot?.reasons ?? s.riskFlags,
    basisRisk: normalizedSnapshot?.basisRisk,
    dataFreshness: normalizedSnapshot?.dataFreshness ?? {
      hasMarkPrice: s.leverage != null,
      hasLiqPrice: s.liqBufferPct != null,
      hasRangeBuffer: true
    }
  });
  const scoreObj = s.canonicalScore ?? computedScore;
  return {
    id: s.id,
    label: s.label,
    score: s.score,
    status: s.breakdown.status,
    netDelta: s.netDelta,
    leverage: s.leverage,
    liqBufferPct: s.liqBufferPct,
    riskFlags: s.riskFlags,
    updatedAt: s.updatedAt,
    scoreObj,
    snapshot: normalizedSnapshot
  };
}

export async function runPortfolioEngine(opts: {
  monitorCadenceHours?: number;
  outputBaseDir?: string;
} = {}): Promise<{
  indexPath: string;
  systemPaths: string[];
  snapshots: HedgedSystemSnapshot[];
}> {
  const cadence = normalizeCadenceHours(opts.monitorCadenceHours);
  const outRoot = opts.outputBaseDir
    ? path.resolve(process.cwd(), opts.outputBaseDir)
    : path.resolve(process.cwd(), `public/data/portfolio/cadence_${cadence}`);
  const outDir = path.join(outRoot, "systems");
  await fs.mkdir(outDir, { recursive: true });

  const snapshots = await Promise.all(
    systems.map(async (system) => {
      try {
        return await system.buildSnapshot({ monitorCadenceHours: cadence });
      } catch (err) {
        return {
          id: system.id,
          label: system.label,
          netDelta: 0,
          totalLong: 0,
          totalShort: 0,
          leverage: null,
          liqBufferPct: null,
          score: 0,
          breakdown: { delta: 0, hedge: 0, range: 0, stability: 0, weighted: 0, status: "red" as const },
          riskFlags: ["MISSING_DATA" as const],
          updatedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        } as HedgedSystemSnapshot;
      }
    })
  );

  const systemPaths: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.canonicalSnapshot) {
      snapshot.canonicalSnapshot = normalizeSnapshot(snapshot.canonicalSnapshot);
    }
    const filePath = path.join(outDir, `${snapshot.id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    systemPaths.push(filePath);
  }

  const indexPath = path.join(outRoot, "systems_index.json");
  const indexPayload = {
    updatedAt: new Date().toISOString(),
    monitorCadenceHours: cadence,
    systems: snapshots.map((s) => buildPortfolioIndexSystemEntry(s))
  };
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

  return { indexPath, systemPaths, snapshots };
}
