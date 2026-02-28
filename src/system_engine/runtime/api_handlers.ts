import { buildSummary, fetchWalletPositions } from "../../index.js";
import { computeSolSystem } from "../../sol_system.js";
import { PublicKey } from "@solana/web3.js";
import { getAlertsPayloadForRuntime } from "../alerts/get_alerts_payload.js";
import { buildPositionsSummaryInputs, buildSolSystemInputsFromSummary } from "../positions/build_summary.js";
import { getCachedRegimeState, getCachedSystemsIndex } from "./read_public_json.js";
import { withTimeout } from "./with_timeout.js";

export type ApiResult = { status: number; body: unknown };

const DEFAULT_POSITIONS_TIMEOUT_MS = Number(process.env.POSITIONS_TIMEOUT_MS ?? 7000);
const DEFAULT_ALERTS_TIMEOUT_MS = Number(process.env.ALERTS_TIMEOUT_MS ?? 8000);

function timeoutMsOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeAttentionLevel(level: unknown): "none" | "warning" | "action" | "critical" {
  const normalized = String(level ?? "none");
  if (normalized === "critical" || normalized === "action" || normalized === "warning") return normalized;
  return "none";
}

function validateWallet(wallet: string): string | null {
  const trimmed = String(wallet ?? "").trim();
  if (!trimmed) return "Missing query param: wallet";
  try {
    new PublicKey(trimmed);
    return null;
  } catch {
    return "Invalid Solana wallet address";
  }
}

function minimalFallbackSolSystem(reasons: string[]) {
  const scoreObj = {
    score0to1: 0.5,
    score0to100: 50,
    label: "YELLOW",
    reasons,
    components: {
      hedge: 0.5,
      liquidation: 0.5,
      range: 0.5,
      dataQuality: 0.5,
      basisRisk: 0.5
    }
  };

  return {
    solLong: 0,
    solShort: 0,
    netSol: 0,
    hedgeCoveragePct: 0,
    liqBufferPct: 0,
    rangeBufferPct: 0,
    healthScore: 50,
    action: "Fallback cached summary",
    score: scoreObj,
    scoreObj,
    health: { overall: "acceptable", hedge: "acceptable", liquidation: "acceptable", range: "acceptable" },
    capitalGuard: { level: "none", triggers: [] },
    snapshot: {
      systemId: "SOL_HEDGED_YIELD",
      asOfTs: null,
      pricesUsed: { sol: null },
      dataFreshness: { hasMarkPrice: false, hasLiqPrice: false, hasRangeBuffer: false },
      exposures: { totalLongSOL: 0, totalShortSOL: 0, netSOLDelta: 0, hedgeRatio: 0 },
      liquidation: { liqPrice: null, liqBufferRatio: null, leverage: null },
      range: { rangeLower: null, rangeUpper: null, rangeBufferRatio: null },
      basisRisk: { isProxyHedge: false, basisPenalty: 0, reasonTag: null },
      debugMath: {},
      reasons
    }
  };
}

function cachedSolSystemFallback(metaReasons: string[]) {
  const cachedIndex = getCachedSystemsIndex();
  const systems = Array.isArray(cachedIndex?.systems) ? cachedIndex.systems : [];
  const cachedSol = systems.find((system: any) => String(system?.id ?? "").toLowerCase().includes("sol"));
  if (!cachedSol) return minimalFallbackSolSystem(metaReasons);

  const minimal = minimalFallbackSolSystem(metaReasons);
  const scoreObj = cachedSol?.scoreObj ?? minimal.scoreObj;
  const snapshot = cachedSol?.snapshot ?? minimal.snapshot;
  const health = cachedSol?.health ?? minimal.health;
  const capitalGuard = cachedSol?.capitalGuard ?? minimal.capitalGuard;
  return {
    solLong: Number(cachedSol?.totalLong ?? 0),
    solShort: Number(cachedSol?.totalShort ?? 0),
    netSol: Number(cachedSol?.netDelta ?? 0),
    hedgeCoveragePct: Number(snapshot?.exposures?.hedgeRatio ?? cachedSol?.hedgeCoveragePct ?? 0),
    liqBufferPct: Number(cachedSol?.liqBufferPct ?? snapshot?.liquidation?.liqBufferRatio ?? 0),
    rangeBufferPct: Number(snapshot?.range?.rangeBufferRatio ?? 0),
    healthScore: Number(scoreObj?.score0to100 ?? 50),
    action: "Fallback cached systems index",
    score: scoreObj,
    scoreObj,
    health,
    capitalGuard,
    snapshot: {
      ...snapshot,
      reasons: Array.isArray(snapshot?.reasons) ? [...snapshot.reasons, ...metaReasons] : [...metaReasons]
    }
  };
}

function positionsFallback(wallet: string, errorCode: "TIMEOUT" | "ERROR", errorMessage: string) {
  const reasons = ["FALLBACK_CACHED_INDEX", "WALLET_LIVE_FETCH_FAILED", errorCode];
  const regime = getCachedRegimeState();
  const cachedIndex = getCachedSystemsIndex();
  return {
    meta: {
      degraded: true,
      fallbackSource: "systems_index",
      errorCode,
      errorMessage,
      wallet,
      reasons
    },
    regime: regime ?? null,
    portfolio: cachedIndex
      ? {
          healthRollup: cachedIndex.healthRollup ?? null,
          capitalGuardRollup: cachedIndex.capitalGuardRollup ?? null
        }
      : null,
    solSystem: cachedSolSystemFallback(reasons)
  };
}

function degradedAlertsPayload(wallet: string, errorCode: "TIMEOUT" | "ERROR", errorMessage: string) {
  return {
    meta: {
      degraded: true,
      errorCode,
      errorMessage,
      wallet,
      reasons: [`ALERTS_DEGRADED_${errorCode}`, "NO_LIVE_ALERTS_AVAILABLE"]
    },
    portfolio: {
      health: { overall: "strong" },
      capitalGuard: { level: "none", triggers: [] }
    },
    systems: [],
    attention: {
      level: normalizeAttentionLevel("none"),
      systemCount: 0,
      systems: [],
      triggers: [],
      reasons: [`ALERTS_DEGRADED_${errorCode}`, "NO_LIVE_ALERTS_AVAILABLE"]
    }
  };
}

export async function handlePositionsQuery(
  query: URLSearchParams,
  deps: {
    fetchWalletPositionsFn?: typeof fetchWalletPositions;
    buildSummaryFn?: typeof buildSummary;
    computeSolSystemFn?: typeof computeSolSystem;
    buildPositionsSummaryInputsFn?: typeof buildPositionsSummaryInputs;
    buildSolSystemInputsFromSummaryFn?: typeof buildSolSystemInputsFromSummary;
    timeoutMs?: number;
  } = {}
): Promise<ApiResult> {
  const wallet = String(query.get("wallet") ?? "");
  const mode = String(query.get("mode") ?? "summary").trim().toLowerCase();
  const debug = String(query.get("debug") ?? "").trim() === "1";

  if (!wallet.trim()) {
    return { status: 400, body: { error: "MISSING_WALLET", hint: "?wallet=<pubkey>" } };
  }

  const walletErr = validateWallet(wallet);
  if (walletErr) {
    return { status: 400, body: { error: "INVALID_WALLET", message: walletErr } };
  }

  const fetchWalletPositionsFn = deps.fetchWalletPositionsFn ?? fetchWalletPositions;
  const buildSummaryFn = deps.buildSummaryFn ?? buildSummary;
  const computeSolSystemFn = deps.computeSolSystemFn ?? computeSolSystem;
  const buildPositionsSummaryInputsFn = deps.buildPositionsSummaryInputsFn ?? buildPositionsSummaryInputs;
  const buildSolSystemInputsFromSummaryFn = deps.buildSolSystemInputsFromSummaryFn ?? buildSolSystemInputsFromSummary;
  const timeoutMs = timeoutMsOrDefault(Number(deps.timeoutMs), DEFAULT_POSITIONS_TIMEOUT_MS);

  if (mode === "full") {
    try {
      const positions = await withTimeout(fetchWalletPositionsFn(wallet), timeoutMs, "positions_full");
      return { status: 200, body: positions };
    } catch (err) {
      return {
        status: 200,
        body: {
          meta: {
            degraded: true,
            fallbackSource: "none",
            errorCode: String(sanitizeErr(err)).includes("TIMEOUT") ? "TIMEOUT" : "ERROR",
            errorMessage: sanitizeErr(err),
            wallet
          },
          error: "FULL_FETCH_FAILED"
        }
      };
    }
  }

  try {
    const positions = await withTimeout(fetchWalletPositionsFn(wallet), timeoutMs, "positions_summary");
    const summary = buildSummaryFn(positions);
    const summaryInputs = buildPositionsSummaryInputsFn(
      {
        ...summary,
        jupiterPerps: positions.jupiterPerps
      },
      { debug: mode === "summary" && debug }
    );
    const solSystem = computeSolSystemFn(buildSolSystemInputsFromSummaryFn(summaryInputs));
    return { status: 200, body: { ...summary, solSystem } };
  } catch (err) {
    const errorMessage = sanitizeErr(err);
    const errorCode: "TIMEOUT" | "ERROR" = errorMessage.includes("TIMEOUT") ? "TIMEOUT" : "ERROR";
    console.log(`[positions_api] degraded ${errorCode}`);
    return { status: 200, body: positionsFallback(wallet, errorCode, errorMessage) };
  }
}

export async function handleAlertsQuery(
  query: URLSearchParams,
  deps: {
    getAlertsPayload?: typeof getAlertsPayloadForRuntime;
    timeoutMs?: number;
    nowIso?: () => string;
  } = {}
): Promise<ApiResult> {
  const wallet = String(query.get("wallet") ?? "").trim();
  if (!wallet) {
    return { status: 400, body: { error: "MISSING_WALLET", hint: "?wallet=<pubkey>" } };
  }

  const getAlertsPayload = deps.getAlertsPayload ?? getAlertsPayloadForRuntime;
  const timeoutMs = timeoutMsOrDefault(Number(deps.timeoutMs), DEFAULT_ALERTS_TIMEOUT_MS);
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  try {
    const payload = await withTimeout(
      getAlertsPayload({
        asOfTs: nowIso(),
        wallet
      }),
      timeoutMs,
      "alerts_payload"
    );
    return { status: 200, body: payload };
  } catch (err) {
    const errorMessage = sanitizeErr(err);
    const errorCode: "TIMEOUT" | "ERROR" = errorMessage.includes("TIMEOUT") ? "TIMEOUT" : "ERROR";
    console.log(`[alerts_api] degraded ${errorCode}`);
    return { status: 200, body: degradedAlertsPayload(wallet, errorCode, errorMessage) };
  }
}
