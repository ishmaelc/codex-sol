export type MonitorCadenceHours = 24 | 48;

export type OperatorMode = {
  name: "DAILY" | "EVERY_48H";
  monitorCadenceHours: MonitorCadenceHours;
  deltaTolerance: number;
  minLiqBufferPct: number;
  presetBias: "BASE" | "CONSERVATIVE";
  warnEdgePct: number;
  actEdgePct: number;
  scoreWeightsOverride?: {
    delta: number;
    hedge: number;
    range: number;
    stability: number;
  };
};

export function normalizeCadenceHours(monitorCadenceHours: number | null | undefined): MonitorCadenceHours {
  return Number(monitorCadenceHours) === 48 ? 48 : 24;
}

export function getOperatorMode(monitorCadenceHours: number | null | undefined): OperatorMode {
  const cadence = normalizeCadenceHours(monitorCadenceHours);
  if (cadence === 48) {
    return {
      name: "EVERY_48H",
      monitorCadenceHours: 48,
      deltaTolerance: 0.15,
      minLiqBufferPct: 0.2,
      presetBias: "CONSERVATIVE",
      warnEdgePct: 0.35,
      actEdgePct: 0.18
    };
  }

  return {
    name: "DAILY",
    monitorCadenceHours: 24,
    deltaTolerance: 0.3,
    minLiqBufferPct: 0.12,
    presetBias: "BASE",
    warnEdgePct: 0.25,
    actEdgePct: 0.1
  };
}
