import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCadenceHours } from "./operator_mode.js";
import { nx8SystemDefinition } from "./systems/nx8_system.js";
import { solSystemDefinition } from "./systems/sol_system.js";
import type { HedgedSystemDefinition, HedgedSystemSnapshot } from "./types.js";
import type { SystemSnapshot } from "../lib/scoring/systemScore.js";

const systems: HedgedSystemDefinition[] = [solSystemDefinition, nx8SystemDefinition];

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
        const nowMs = Date.now();
        const scoringSnapshot: SystemSnapshot = {
          systemId: system.id,
          asOfMs: nowMs,
          nowMs,
          dataQuality: { quality0to1: 0, missingSources: ["build_error"] },
          hedge: { hedgePercent: 0, driftFrac: 1 },
          liquidation: { liqBufferPercent: 0 },
          range: { hasRangeRisk: true, rangeBufferPercent: 0 },
          basis: { basisRiskEstimate0to1: 1 }
        };
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
          scoringSnapshot,
          systemScore: { score0to1: 0, score0to100: 0, label: "RED", reasons: ["DATA_MISSING"], components: { hedge: 0, liquidation: 0, range: 0, dataQuality: 0, basisRisk: 0 } },
          asOfMs: nowMs,
          nowMs,
          updatedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        } as HedgedSystemSnapshot;
      }
    })
  );

  const systemPaths: string[] = [];
  for (const snapshot of snapshots) {
    const filePath = path.join(outDir, `${snapshot.id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    systemPaths.push(filePath);
  }

  const indexPath = path.join(outRoot, "systems_index.json");
  const indexPayload = {
    updatedAt: new Date().toISOString(),
    monitorCadenceHours: cadence,
    systems: snapshots.map((s) => ({
      id: s.id,
      label: s.label,
      score: s.score,
      status: s.breakdown.status,
      systemScore: s.systemScore,
      components: s.systemScore.components,
      reasons: s.systemScore.reasons,
      asOfMs: s.asOfMs,
      nowMs: s.nowMs,
      netDelta: s.netDelta,
      leverage: s.leverage,
      liqBufferPct: s.liqBufferPct,
      riskFlags: s.riskFlags,
      priceInputs: s.priceInputs ?? {},
      updatedAt: s.updatedAt
    }))
  };
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

  return { indexPath, systemPaths, snapshots };
}
