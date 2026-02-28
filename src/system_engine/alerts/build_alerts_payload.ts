type AnyObj = Record<string, unknown>;

type AlertsSystemInput = {
  id?: string;
  systemId?: string;
  label?: string;
  scoreObj?: AnyObj | null;
  health?: AnyObj | null;
  capitalGuard?: { level?: string | null; triggers?: string[] | null } | null;
  snapshot?: {
    pricesUsed?: unknown;
    exposures?: unknown;
    liquidation?: unknown;
    range?: unknown;
    dataFreshness?: unknown;
    debugMath?: unknown;
    reasons?: unknown;
        depositRecommendation?: unknown;
    [key: string]: unknown;
  } | null;
};

export type AlertsPayload = {
  asOfTs: string;
  wallet?: string | null;
  portfolio: {
    health: { overall: string };
    capitalGuard: { level: string; triggers: string[] };
  };
  systems: Array<{
    id: string;
    systemId: string;
    label: string;
    scoreObj: AnyObj | null;
    health: unknown;
    capitalGuard: unknown;
    snapshot: {
      pricesUsed?: unknown;
      exposures?: unknown;
      liquidation?: unknown;
      range?: unknown;
      dataFreshness?: unknown;
      debugMath?: unknown;
      reasons?: unknown;
        depositRecommendation?: unknown;
    };
  }>;
  attention: {
    level: "none" | "warning" | "action" | "critical";
    systemCount: number;
    systems: string[];
    triggers: string[];
  };
};

function normalizeAttentionLevel(level: string): "none" | "warning" | "action" | "critical" {
  if (level === "critical" || level === "action" || level === "warning") return level;
  return "none";
}

export function buildAlertsPayload(input: {
  asOfTs: string;
  wallet?: string | null;
  portfolioRollup: { healthRollup: AnyObj; capitalGuardRollup: AnyObj };
  systems: AlertsSystemInput[];
}): AlertsPayload {
  const sortedSystems = [...input.systems].sort((a, b) =>
    String(a.id ?? a.systemId ?? "").localeCompare(String(b.id ?? b.systemId ?? ""))
  );

  const systems = sortedSystems.map((system) => {
    const systemId = String(system.id ?? system.systemId ?? "");
    return {
      id: systemId,
      systemId,
      label: String(system.label ?? systemId),
      scoreObj: system.scoreObj ?? null,
      health: system.health ?? null,
      capitalGuard: system.capitalGuard ?? null,
      snapshot: {
        pricesUsed: system.snapshot?.pricesUsed,
        exposures: system.snapshot?.exposures,
        liquidation: system.snapshot?.liquidation,
        range: system.snapshot?.range,
        dataFreshness: system.snapshot?.dataFreshness,
        debugMath: system.snapshot?.debugMath,
        reasons: system.snapshot?.reasons,
        depositRecommendation: (system.snapshot as any)?.depositRecommendation ?? null
      }
    };
  });

  const attentionSystems = systems.filter((system) => {
    const guardLevel = String((system.capitalGuard as { level?: string } | null)?.level ?? "none");
    const healthOverall = String((system.health as { overall?: string } | null)?.overall ?? "strong");
    return guardLevel !== "none" || healthOverall !== "strong";
  });

  const attentionTriggerSet = new Set<string>();
  for (const system of attentionSystems) {
    const triggers = (system.capitalGuard as { triggers?: string[] } | null)?.triggers ?? [];
    for (const trigger of triggers) attentionTriggerSet.add(String(trigger));
  }

  return {
    asOfTs: input.asOfTs,
    wallet: input.wallet ?? null,
    portfolio: {
      health: {
        overall: String(input.portfolioRollup.healthRollup?.overall ?? "strong")
      },
      capitalGuard: {
        level: String(input.portfolioRollup.capitalGuardRollup?.level ?? "none"),
        triggers: Array.isArray(input.portfolioRollup.capitalGuardRollup?.triggers)
          ? [...(input.portfolioRollup.capitalGuardRollup?.triggers as string[])].sort((a, b) => a.localeCompare(b))
          : []
      }
    },
    systems,
    attention: {
      level: normalizeAttentionLevel(String(input.portfolioRollup.capitalGuardRollup?.level ?? "none")),
      systemCount: attentionSystems.length,
      systems: attentionSystems.map((system) => system.systemId).sort((a, b) => a.localeCompare(b)),
      triggers: [...attentionTriggerSet].sort((a, b) => a.localeCompare(b))
    }
  };
}
