import type { CapitalGuardResult } from "../capital_guard/compute_capital_guard.js";
import type { HealthResult } from "../health/compute_health.js";

export type PortfolioHealthRollup = {
  overall: HealthResult["overall"];
};

export type PortfolioCapitalGuardRollup = {
  level: CapitalGuardResult["level"];
  triggers: string[];
};

type RollupSystemLike = {
  id?: string;
  health?: HealthResult | null;
  capitalGuard?: CapitalGuardResult | null;
};

const HEALTH_RANK: Record<HealthResult["overall"], number> = {
  strong: 0,
  acceptable: 1,
  degraded: 2,
  critical: 3
};

const GUARD_RANK: Record<CapitalGuardResult["level"], number> = {
  none: 0,
  warning: 1,
  action: 2,
  critical: 3
};

function sortSystems(systems: RollupSystemLike[]): RollupSystemLike[] {
  return [...systems].sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

export function rollupHealth(systems: RollupSystemLike[]): PortfolioHealthRollup {
  const sorted = sortSystems(systems);
  const overall = sorted.reduce<HealthResult["overall"]>((worst, system) => {
    const current = system.health?.overall ?? "strong";
    return HEALTH_RANK[current] > HEALTH_RANK[worst] ? current : worst;
  }, "strong");
  return { overall };
}

export function rollupCapitalGuard(systems: RollupSystemLike[]): PortfolioCapitalGuardRollup {
  const sorted = sortSystems(systems);
  const level = sorted.reduce<CapitalGuardResult["level"]>((worst, system) => {
    const current = system.capitalGuard?.level ?? "none";
    return GUARD_RANK[current] > GUARD_RANK[worst] ? current : worst;
  }, "none");
  const triggerSet = new Set<string>();
  for (const system of sorted) {
    const triggers = Array.isArray(system.capitalGuard?.triggers) ? system.capitalGuard?.triggers ?? [] : [];
    for (const trigger of triggers) triggerSet.add(String(trigger));
  }
  return {
    level,
    triggers: [...triggerSet].sort((a, b) => a.localeCompare(b))
  };
}

export function rollupPortfolio(systems: RollupSystemLike[]): {
  health: PortfolioHealthRollup;
  capitalGuard: PortfolioCapitalGuardRollup;
} {
  return {
    health: rollupHealth(systems),
    capitalGuard: rollupCapitalGuard(systems)
  };
}
