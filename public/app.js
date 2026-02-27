const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const operatorModeToggle = document.getElementById("operatorModeToggle");
const statusEl = document.getElementById("status");
const tabPortfolioMain = document.getElementById("tabPortfolioMain");
const tabOrcaMain = document.getElementById("tabOrcaMain");
const tabOperatorMain = document.getElementById("tabOperatorMain");
const tabWalletMain = document.getElementById("tabWalletMain");
const tabPortfolioSection = document.getElementById("tab-portfolio");
const tabOrcaSection = document.getElementById("tab-orca");
const tabOperatorSection = document.getElementById("tab-operator");
const tabWalletSection = document.getElementById("tab-wallet");
const refreshOrcaBtn = document.getElementById("refreshOrcaBtn");
const orcaSummaryStatus = document.getElementById("orcaSummaryStatus");
const orcaFullTableDetails = document.getElementById("orcaFullTableDetails");
const refreshWalletBtn = document.getElementById("refreshWalletBtn");
const walletSummaryStatus = document.getElementById("walletSummaryStatus");
const walletTokensSummary = document.getElementById("walletTokensSummary");
const walletPositionsSummary = document.getElementById("walletPositionsSummary");
const walletRewardsSummary = document.getElementById("walletRewardsSummary");
const walletHeadlinesWrap = document.getElementById("walletHeadlinesWrap");
const orcaSnapshotWrap = document.getElementById("orcaSnapshotWrap");
const attentionStripWrap = document.getElementById("attentionStripWrap");
const systemConsolesWrap = document.getElementById("systemConsolesWrap");
const orcaTableWrap = document.getElementById("orcaTableWrap");
const operatorPanelWrap = document.getElementById("operatorPanelWrap");
const summaryCards = document.getElementById("summaryCards");
const walletTokensWrap = document.getElementById("walletTokensWrap");
const rewardsTableWrap = document.getElementById("rewardsTableWrap");
const dataStatusPill = document.getElementById("dataStatusPill");
const degradedBanner = document.getElementById("degradedBanner");
const walletTokensDetails = document.getElementById("walletTokensDetails");
const walletPositionsDetails = document.getElementById("walletPositionsDetails");
const walletRewardsDetails = document.getElementById("walletRewardsDetails");

const OPERATOR_MODE_KEY = "operatorModeEnabled";
const MAIN_TAB_KEY = "mainDashboardTab";
const ORCA_FULL_TABLE_OPEN_KEY = "orcaFullTableOpen";
const ORCA_REGIME_URL = "/data/orca/regime_state.json";
const ORCA_POOLS_URL = "/data/orca/pool_rankings.json";

const DEFAULT_WALLET = "4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr";
walletInput.value = DEFAULT_WALLET;

let latestWallet = "";
let latestPortfolioSystems = null;
let operatorModeEnabled = false;
let currentMainTab = "portfolio";
let latestOrcaData = null;
let walletDataLoaded = false;
let selectedOperatorSystemId = "sol_hedged";
const state = {
  alerts: { data: null, fetchedAt: null, status: "idle", error: null },
  positionsSummary: { data: null, fetchedAt: null, status: "idle", error: null }
};

function loadOperatorModeState() {
  try {
    return localStorage.getItem(OPERATOR_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOperatorModeState(enabled) {
  try {
    localStorage.setItem(OPERATOR_MODE_KEY, enabled ? "1" : "0");
  } catch {}
}

function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", Boolean(hidden));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loadMainTabState() {
  try {
    const fromHash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
    if (fromHash === "portfolio" || fromHash === "orca" || fromHash === "operator" || fromHash === "wallet") return fromHash;
    const stored = String(localStorage.getItem(MAIN_TAB_KEY) || "").toLowerCase();
    if (stored === "portfolio" || stored === "orca" || stored === "operator" || stored === "wallet") return stored;
  } catch {}
  return "portfolio";
}

function persistMainTabState(tab) {
  try {
    localStorage.setItem(MAIN_TAB_KEY, tab);
  } catch {}
}

function loadOrcaFullTableState() {
  try {
    return localStorage.getItem(ORCA_FULL_TABLE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOrcaFullTableState(open) {
  try {
    localStorage.setItem(ORCA_FULL_TABLE_OPEN_KEY, open ? "1" : "0");
  } catch {}
}

function fmtUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
}

function fmtTokenAmount(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value));
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return `${Number(value).toFixed(2)}%`;
}

function fmtSignedUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${fmtUsd(n)}`;
}

function fmtDateTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "n/a";
  return new Date(n).toLocaleString();
}

function shortPk(pk) {
  if (!pk || typeof pk !== "string") return "n/a";
  if (pk.length < 12) return pk;
  return `${pk.slice(0, 6)}...${pk.slice(-6)}`;
}

function deriveLendPairLabel(ob) {
  const rows = Array.isArray(ob?.reserveApyBreakdown) ? ob.reserveApyBreakdown : [];
  const supply = rows.find((r) => String(r?.side) === "supply" && r?.symbol)?.symbol ?? null;
  const borrow = rows.find((r) => String(r?.side) === "borrow" && r?.symbol)?.symbol ?? null;
  if (supply && borrow) return `${supply}/${borrow}`;
  if (supply) return `${supply}/-`;
  if (borrow) return `-/${borrow}`;
  return String(ob?.market ?? "Unknown Pair");
}

function setMainTab(tab, options = {}) {
  const next = tab === "orca" || tab === "operator" || tab === "wallet" ? tab : "portfolio";
  currentMainTab = next;
  setHidden(tabPortfolioSection, next !== "portfolio");
  setHidden(tabOrcaSection, next !== "orca");
  setHidden(tabOperatorSection, next !== "operator");
  setHidden(tabWalletSection, next !== "wallet");
  tabPortfolioMain?.classList.toggle("is-active", next === "portfolio");
  tabOrcaMain?.classList.toggle("is-active", next === "orca");
  tabOperatorMain?.classList.toggle("is-active", next === "operator");
  tabWalletMain?.classList.toggle("is-active", next === "wallet");
  if (!options.skipHash) window.location.hash = `#${next}`;
  persistMainTabState(next);
  if ((next === "portfolio" || next === "orca") && !latestOrcaData) void ensureOrcaDataLoaded();
  if (next === "operator") renderOperatorPanel();
  if (next === "wallet") void ensureWalletDataLoaded();
}

async function loadOrcaData(options = {}) {
  const cacheBust = options.cacheBust ? `?t=${Date.now()}` : "";
  const [regimeRes, poolsRes] = await Promise.all([
    fetch(`${ORCA_REGIME_URL}${cacheBust}`),
    fetch(`${ORCA_POOLS_URL}${cacheBust}`)
  ]);
  if (!regimeRes.ok) throw new Error(`regime_state.json HTTP ${regimeRes.status}`);
  if (!poolsRes.ok) throw new Error(`pool_rankings.json HTTP ${poolsRes.status}`);
  return {
    regime: await regimeRes.json(),
    pools: await poolsRes.json()
  };
}

async function ensureOrcaDataLoaded(options = {}) {
  if (!orcaSummaryStatus) return;
  if (latestOrcaData && !options.force) {
    renderOrcaSurfaces();
    return;
  }
  orcaSummaryStatus.textContent = "Loading Orca data...";
  try {
    latestOrcaData = await loadOrcaData({ cacheBust: options.cacheBust });
    orcaSummaryStatus.textContent = `Orca data updated ${new Date().toLocaleTimeString()}`;
    renderOrcaSurfaces();
  } catch (err) {
    orcaSummaryStatus.textContent = err instanceof Error ? err.message : String(err);
  }
}

// ORCA_SNAPSHOT_START
function renderOrcaSnapshotCard() {
  if (!orcaSnapshotWrap) return;
  const regime = latestOrcaData?.regime ?? null;
  const poolRowsRaw = Array.isArray(latestOrcaData?.pools?.topPoolsOverall)
    ? latestOrcaData.pools.topPoolsOverall
    : Array.isArray(latestOrcaData?.pools?.pools)
      ? latestOrcaData.pools.pools
      : [];
  const poolRows = poolRowsRaw.filter((row) => row?.type !== "STABLE-STABLE");
  const topRows = poolRows.slice(0, 3);
  if (!regime) {
    orcaSnapshotWrap.innerHTML = `
      <div class="section-head"><h2>Orca Snapshot</h2></div>
      <div class="rewards-empty">Orca snapshot unavailable.</div>
    `;
    return;
  }
  orcaSnapshotWrap.innerHTML = `
    <div class="section-head">
      <h2>Orca Snapshot</h2>
      <button type="button" id="openOrcaTabBtn">Open Orca tab</button>
    </div>
    <div class="table-note">Regime ${escapeHtml(String(regime.regime ?? "n/a"))} | Confidence ${Number.isFinite(Number(regime.confidence)) ? `${(Number(regime.confidence) * 100).toFixed(0)}%` : "n/a"}</div>
    ${
      topRows.length
        ? `<table class="summary-table" style="margin-top:10px;">
            <thead><tr><th>Rank</th><th>Pool</th><th>Score</th></tr></thead>
            <tbody>
              ${topRows
                .map(
                  (row) => `<tr>
                    <td>${row.rank ?? ""}</td>
                    <td>${escapeHtml(String(row.pool ?? ""))}</td>
                    <td>${Number.isFinite(Number(row.score)) ? Number(row.score).toFixed(2) : "n/a"}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : `<div class="rewards-empty">No ranked pools.</div>`
    }
  `;
  const openOrcaTabBtn = document.getElementById("openOrcaTabBtn");
  openOrcaTabBtn?.addEventListener("click", () => setMainTab("orca"));
}
// ORCA_SNAPSHOT_END

function renderOrcaTable() {
  if (!orcaTableWrap) return;
  const poolRowsRaw = Array.isArray(latestOrcaData?.pools?.topPoolsOverall)
    ? latestOrcaData.pools.topPoolsOverall
    : Array.isArray(latestOrcaData?.pools?.pools)
      ? latestOrcaData.pools.pools
      : [];
  const poolRows = poolRowsRaw.filter((row) => row?.type !== "STABLE-STABLE");
  if (!poolRows.length) {
    orcaTableWrap.innerHTML = `<div class="rewards-empty">No pool rankings available.</div>`;
    return;
  }
  orcaTableWrap.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Rank</th><th>Pool</th><th>Type</th><th>TVL</th><th>Volume24h</th><th>Fee APR</th><th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${poolRows
          .map(
            (row) => `<tr>
              <td>${row.rank ?? ""}</td>
              <td>${escapeHtml(String(row.pool ?? ""))}</td>
              <td>${escapeHtml(String(row.type ?? ""))}</td>
              <td>${fmtUsd(row.tvlUsd)}</td>
              <td>${fmtUsd(row.volume24hUsd)}</td>
              <td>${fmtPct(row.feeAprPct)}</td>
              <td>${Number.isFinite(Number(row.score)) ? Number(row.score).toFixed(2) : "n/a"}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOrcaSurfaces() {
  renderOrcaSnapshotCard();
  renderOrcaTable();
}

// ATTENTION_STRIP_START
function systemShortLabel(system) {
  const raw = String(system?.label ?? system?.id ?? system?.systemId ?? "");
  if (!raw) return "UNKNOWN";
  const first = raw.split(/[\s_]/)[0].toUpperCase();
  return first || raw.toUpperCase();
}

function systemAlertLevel(system) {
  const guard = String(system?.capitalGuard?.level ?? "none").toLowerCase();
  if (guard !== "none") return guard;
  return String(system?.health?.overall ?? "none").toLowerCase();
}

function renderAttentionStrip() {
  if (!attentionStripWrap) return;
  const attention = state.alerts.data?.attention ?? null;
  const alertsMeta = state.alerts.data?.meta ?? null;
  const alertsDegraded = Boolean(alertsMeta?.degraded);
  const alertsErrorCode = String(alertsMeta?.errorCode ?? "ERROR");
  const level = String(attention?.level ?? "none").toUpperCase();
  const triggers = Array.isArray(attention?.triggers) ? attention.triggers.slice(0, 3) : [];
  const systems = getAlertsSystems();

  const driverSystems = systems
    .filter((system) => String(system?.capitalGuard?.level ?? "none").toLowerCase() !== "none");
  const fallbackDrivers = systems
    .filter((system) => String(system?.health?.overall ?? "").toLowerCase() === "critical");
  const drivers = (driverSystems.length ? driverSystems : fallbackDrivers).slice(0, 2);

  const driverChips = drivers.length
    ? drivers.map((system) => {
        const label = systemShortLabel(system);
        const alertLevel = systemAlertLevel(system);
        const modifier = alertLevel === "critical" ? "chip-critical" : alertLevel === "warning" ? "chip-warning" : "";
        const levelTag = alertLevel !== "none" ? ` · ${alertLevel.toUpperCase()}` : "";
        return `<span class="chip${modifier ? ` ${modifier}` : ""}">${escapeHtml(label)}${escapeHtml(levelTag)}</span>`;
      }).join("")
    : `<span class="table-note">—</span>`;

  const body = triggers.length
    ? triggers.map((trigger) => `<span class="chip">${escapeHtml(String(trigger))}</span>`).join("")
    : `<span class="table-note">No active alerts</span>`;

  attentionStripWrap.innerHTML = `
    <div class="section-head">
      <h2>Portfolio Alerts</h2>
      <button type="button" id="attentionOpenOperatorBtn">Open Operator</button>
    </div>
    <div class="table-note">Level: ${escapeHtml(level)}</div>
    ${alertsDegraded ? `<div class="table-note">Alerts degraded (${escapeHtml(alertsErrorCode)}): showing fallback state.</div>` : ""}
    <div class="toggle-row" style="gap:6px;margin-top:4px;align-items:center;">
      <span class="table-note" style="margin:0;">Driver:</span>
      ${driverChips}
    </div>
    <div class="toggle-row" style="margin-top:8px;">${body}</div>
  `;
  document.getElementById("attentionOpenOperatorBtn")?.addEventListener("click", () => {
    setMainTab("operator");
  });
}
// ATTENTION_STRIP_END

function getAlertsSystems() {
  return Array.isArray(state.alerts.data?.systems) ? state.alerts.data.systems : [];
}

function findAlertSystem(systemId) {
  const systems = getAlertsSystems();
  return systems.find((system) => String(system?.id ?? system?.systemId ?? "").toLowerCase() === systemId) ?? null;
}

function resolveSystemKinds() {
  const systems = getAlertsSystems();
  const withIds = systems.map((system) => ({
    system,
    id: String(system?.id ?? system?.systemId ?? "").toLowerCase()
  }));
  const sol = withIds.find((entry) => entry.id.includes("sol") && !entry.id.includes("nx8")) ?? null;
  const nx8 = withIds.find((entry) => entry.id.includes("nx8")) ?? null;
  return {
    solId: sol?.id ?? "sol_hedged",
    nx8Id: nx8?.id ?? "nx8_hedged",
    solSystem: sol?.system ?? null,
    nx8System: nx8?.system ?? null
  };
}

function chooseDefaultOperatorSystemId() {
  const systems = getAlertsSystems();
  if (!systems.length) return "sol_hedged";
  const attentionLevel = String(state.alerts.data?.attention?.level ?? "none").toLowerCase();
  if (attentionLevel !== "none") {
    const attentionSystem = systems.find((system) => String(system?.capitalGuard?.level ?? "none").toLowerCase() !== "none");
    if (attentionSystem) return String(attentionSystem?.id ?? attentionSystem?.systemId ?? "sol_hedged").toLowerCase();
  }
  const kinds = resolveSystemKinds();
  if (kinds.solSystem) return kinds.solId;
  return String(systems[0]?.id ?? systems[0]?.systemId ?? "sol_hedged").toLowerCase();
}

function computeWalletHeadlineValues(summary) {
  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];
  const solPriceFromStrategies = strategyValuations
    .map((s) => {
      if (s?.tokenASymbol === "SOL") return Number(s?.tokenAPriceUsd);
      if (s?.tokenBSymbol === "SOL") return Number(s?.tokenBPriceUsd);
      return NaN;
    })
    .find((v) => Number.isFinite(v));

  const walletTokens = summary?.spot?.tokens ?? [];
  const knownSolSpotUsd = Number.isFinite(solPriceFromStrategies) ? Number(summary?.spot?.nativeSol || 0) * solPriceFromStrategies : NaN;
  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);
  const lendTokenPricesByMint = new Map((summary?.kaminoLend?.tokenPrices?.byMint ?? []).map((r) => [String(r.mint), Number(r.priceUsd)]));
  const lendTokenPricesBySymbol = new Map(
    (summary?.kaminoLend?.tokenPrices?.bySymbol ?? []).map((r) => [String(r.symbol ?? "").toUpperCase(), Number(r.priceUsd)])
  );
  const strategyTokenPrice = (symbol, mint) => {
    for (const s of strategyValuations) {
      if (symbol === s?.tokenASymbol || mint === s?.tokenAMint) return Number(s?.tokenAPriceUsd) || null;
      if (symbol === s?.tokenBSymbol || mint === s?.tokenBMint) return Number(s?.tokenBPriceUsd) || null;
    }
    return null;
  };
  const tokenPriceUsd = (symbol, mint) => {
    if (symbol === "SOL" || mint === "So11111111111111111111111111111111111111112") return Number.isFinite(solPriceFromStrategies) ? solPriceFromStrategies : null;
    if (stableSymbols.has(symbol)) return 1;
    const byMint = lendTokenPricesByMint.get(String(mint ?? ""));
    if (Number.isFinite(byMint) && byMint > 0) return byMint;
    const bySymbol = lendTokenPricesBySymbol.get(String(symbol ?? "").toUpperCase());
    if (Number.isFinite(bySymbol) && bySymbol > 0) return bySymbol;
    return strategyTokenPrice(symbol, mint);
  };
  const knownSplSpotUsd = walletTokens.reduce((acc, t) => {
    const px = tokenPriceUsd(t.symbol, t.mint);
    return acc + (px == null ? 0 : Number(t.amountUi || 0) * px);
  }, 0);
  const walletSpotKnownUsd = (Number.isFinite(knownSolSpotUsd) ? knownSolSpotUsd : 0) + knownSplSpotUsd;
  const perpsValueUsd = Number(summary?.jupiterPerps?.summary?.valueUsd ?? NaN);
  const lendValueUsd = Number(summary?.kaminoLend?.netValueUsd ?? NaN);
  const liqFarmsValueUsd = Number(summary?.kaminoLiquidity?.valueUsdFarmsStaked ?? NaN);
  const orcaWhirlpoolsValueUsd = Number(summary?.kaminoLiquidity?.orcaWhirlpoolsValueUsd ?? summary?.orcaWhirlpools?.valueUsd ?? NaN);
  const liqPlusOrcaValueUsd = Number.isFinite(Number(summary?.kaminoLiquidity?.valueUsdFarmsStakedWithOrca))
    ? Number(summary.kaminoLiquidity.valueUsdFarmsStakedWithOrca)
    : liqFarmsValueUsd + orcaWhirlpoolsValueUsd;
  const positionsTotalUsd = perpsValueUsd + lendValueUsd + liqPlusOrcaValueUsd;
  const claimableValueUsd = Number(summary?.kaminoLiquidity?.rewards?.claimableValueUsd ?? NaN);

  return {
    totalWalletValueUsd: Number.isFinite(walletSpotKnownUsd) && Number.isFinite(positionsTotalUsd) ? walletSpotKnownUsd + positionsTotalUsd : null,
    totalClaimableRewardsUsd: Number.isFinite(claimableValueUsd) ? claimableValueUsd : null
  };
}

function renderWalletHeadlines() {
  if (!walletHeadlinesWrap) return;
  const summary = state.positionsSummary.data;
  const isLoading = state.positionsSummary.status === "loading";
  const values = summary ? computeWalletHeadlineValues(summary) : { totalWalletValueUsd: null, totalClaimableRewardsUsd: null };
  const totalWallet = isLoading ? "Loading..." : values.totalWalletValueUsd == null ? "—" : fmtUsd(values.totalWalletValueUsd);
  const claimable = isLoading ? "Loading..." : values.totalClaimableRewardsUsd == null ? "—" : fmtUsd(values.totalClaimableRewardsUsd);
  walletHeadlinesWrap.innerHTML = `
    <div class="section-head">
      <h2>Wallet Snapshot</h2>
      <span class="section-subtle">Inventory snapshot</span>
    </div>
    <div class="headlines-grid">
      <div class="headline-stat"><div class="label">Total Wallet Value</div><div class="value">${escapeHtml(totalWallet)}</div></div>
      <div class="headline-stat"><div class="label">Total Claimable Rewards</div><div class="value">${escapeHtml(claimable)}</div></div>
    </div>
  `;
}

// SYSTEM_CONSOLES_TABLE_START
function renderSystemConsoles() {
  if (!systemConsolesWrap) return;
  const kinds = resolveSystemKinds();
  const systems = [
    { id: kinds.solId, label: "SOL", system: kinds.solSystem },
    { id: kinds.nx8Id, label: "NX8", system: kinds.nx8System }
  ];
  const alertsUnavailable = getAlertsSystems().length === 0;
  const alertsMeta = state.alerts.data?.meta ?? null;
  const alertsDegraded = Boolean(alertsMeta?.degraded);
  const alertsErrorCode = String(alertsMeta?.errorCode ?? "ERROR");
  const dash = "—";
  const rendered = systems.map(({ system, label }) => {
    if (!system) {
      return {
        label,
        scoreChip: dash,
        managedBadge: "",
        netDelta: dash,
        hedge: dash,
        liq: dash,
        range: label === "NX8" ? "Managed" : dash,
        basisRisk: dash,
        action: "No action",
        dataFlags: dash
      };
    }
    const scoreObj = system?.scoreObj ?? {};
    const snapshot = system?.snapshot ?? {};
    const exposures = snapshot?.exposures ?? {};
    const liq = snapshot?.liquidation ?? {};
    const range = snapshot?.range ?? {};
    const freshness = snapshot?.dataFreshness ?? {};
    const scoreReasons = Array.isArray(scoreObj?.reasons) ? scoreObj.reasons : [];
    const snapshotReasons = Array.isArray(snapshot?.reasons) ? snapshot.reasons : [];
    const reasons = scoreReasons.length ? scoreReasons : snapshotReasons;
    const missingReasons = reasons
      .map((reason) => String(reason))
      .filter((reason) => reason.startsWith("MISSING_") && reason !== "MISSING_DATA");
    const guardTriggers = Array.isArray(system?.capitalGuard?.triggers) ? system.capitalGuard.triggers : [];
    const systemIdUpper = String(system?.id ?? system?.systemId ?? "").toUpperCase();
    const isNx8 = systemIdUpper.includes("NX8");
    const hasMark = freshness?.hasMarkPrice === true;
    const hasLiq = freshness?.hasLiqPrice === true && liq?.liqBufferRatio != null;
    const hasRange = freshness?.hasRangeBuffer === true && range?.rangeBufferRatio != null;
    const missingText = reasons.includes("MISSING_DATA") ? "MISSING" : "N/A";
    const netDeltaText = hasMark
      ? (Number.isFinite(Number(exposures?.netDelta))
          ? Number(exposures.netDelta).toFixed(4)
          : Number.isFinite(Number(exposures?.netSOLDelta))
            ? Number(exposures.netSOLDelta).toFixed(4)
            : missingText)
      : missingText;
    const hedgeText = hasMark && Number.isFinite(Number(exposures?.hedgeRatio)) ? `${(Number(exposures.hedgeRatio) * 100).toFixed(1)}%` : missingText;
    const liqText = hasLiq ? `${(Number(liq.liqBufferRatio) * 100).toFixed(1)}%` : missingText;
    const rangeText = isNx8 ? "Managed" : hasRange ? `${(Number(range.rangeBufferRatio) * 100).toFixed(1)}%` : missingText;
    const actionText = guardTriggers.length ? String(guardTriggers[0]) : "No action";
    const scoreText = Number.isFinite(Number(scoreObj?.score0to100)) ? Number(scoreObj.score0to100).toFixed(0) : dash;
    const scoreLabel = String(scoreObj?.label ?? "N/A").toUpperCase();
    const dataBadges = [
      reasons.includes("MISSING_DATA") ? `<span class="chip">MISSING_DATA</span>` : "",
      (reasons.includes("PROXY_HEDGE") || snapshot?.basisRisk?.isProxyHedge === true) ? `<span class="chip">PROXY_HEDGE</span>` : ""
    ].filter(Boolean);
    const missingWhy = missingReasons.length
      ? `<details style="margin-top:6px;"><summary class="table-note">Why missing</summary><div class="table-note">${missingReasons
          .map((reason) => escapeHtml(reason))
          .join(" | ")}</div></details>`
      : "";
    return {
      label,
      scoreChip: `${scoreText} • ${scoreLabel}`,
      managedBadge: isNx8 ? `<span class="chip">Kamino (auto-rebalanced)</span>` : "",
      netDelta: netDeltaText,
      hedge: hedgeText,
      liq: liqText,
      range: rangeText,
      basisRisk: reasons.includes("PROXY_HEDGE") ? `<span class="chip">PROXY_HEDGE</span>` : dash,
      action: actionText,
      dataFlags: dataBadges.length ? `${dataBadges.join(" ")}${missingWhy}` : dash
    };
  });
  const sol = rendered[0];
  const nx8 = rendered[1];

  systemConsolesWrap.innerHTML = `
    <div class="section-head">
      <h2>Systems Overview</h2>
      ${alertsUnavailable ? `<span class="table-note">Alerts unavailable${alertsDegraded ? ` (${escapeHtml(alertsErrorCode)})` : ""}</span>` : ""}
    </div>
    <table class="summary-table system-consoles-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>
            <div class="system-col-head">
              <span>SOL</span>
              <span class="chip">${escapeHtml(sol.scoreChip)}</span>
            </div>
          </th>
          <th>
            <div class="system-col-head">
              <span>NX8</span>
              ${nx8.managedBadge}
              <span class="chip">${escapeHtml(nx8.scoreChip)}</span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Net Delta/Exposure</td><td>${escapeHtml(sol.netDelta)}</td><td>${escapeHtml(nx8.netDelta)}</td></tr>
        <tr><td>Hedge %</td><td>${escapeHtml(sol.hedge)}</td><td>${escapeHtml(nx8.hedge)}</td></tr>
        <tr><td>Liq Buffer</td><td>${escapeHtml(sol.liq)}</td><td>${escapeHtml(nx8.liq)}</td></tr>
        <tr><td>Range</td><td>${escapeHtml(sol.range)}</td><td>${escapeHtml(nx8.range)}</td></tr>
        <tr><td>Basis Risk</td><td>${sol.basisRisk}</td><td>${nx8.basisRisk}</td></tr>
        <tr><td>Data Flags</td><td>${sol.dataFlags}</td><td>${nx8.dataFlags}</td></tr>
        <tr>
          <td>Action</td>
          <td><span class="action-text">${escapeHtml(sol.action)}</span> <a href="#operator" data-open-operator-inline="1">View Operator</a></td>
          <td><span class="action-text">${escapeHtml(nx8.action)}</span> <a href="#operator" data-open-operator-inline="1">View Operator</a></td>
        </tr>
      </tbody>
    </table>
  `;
  systemConsolesWrap.querySelectorAll("[data-open-operator-inline='1']").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      setMainTab("operator");
    });
  });
}
// SYSTEM_CONSOLES_TABLE_END

// OPERATOR_ACTION_PANEL_START
// Ordering: engine-provided order (deterministic). UI must not sort.
function getOperatorReasons(system) {
  const fromScoreObj = Array.isArray(system?.scoreObj?.reasons) ? system.scoreObj.reasons : [];
  if (fromScoreObj.length > 0) return fromScoreObj;
  const fromScore = Array.isArray(system?.score?.reasons) ? system.score.reasons : [];
  if (fromScore.length > 0) return fromScore;
  return Array.isArray(system?.snapshot?.reasons) ? system.snapshot.reasons : [];
}

async function copyTextValue(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function operatorCopyPayload(kind, selectedSystem) {
  const reasons = getOperatorReasons(selectedSystem);
  const triggers = Array.isArray(selectedSystem?.capitalGuard?.triggers) ? selectedSystem.capitalGuard.triggers : [];
  const level = String(selectedSystem?.capitalGuard?.level ?? "none");
  const actionLines = [`LEVEL: ${level}`];
  if (triggers.length > 0) {
    actionLines.push("TRIGGERS:");
    for (const trigger of triggers) actionLines.push(`- ${String(trigger)}`);
  } else {
    actionLines.push("TRIGGERS: (none)");
  }
  if (reasons.length > 0) {
    actionLines.push("REASONS:");
    for (const reason of reasons) actionLines.push(`- ${String(reason)}`);
  } else {
    actionLines.push("REASONS: (none)");
  }

  if (kind === "triggers") return triggers.length ? triggers.join("\n") : "No triggers";
  if (kind === "reasons") return reasons.length ? reasons.join("\n") : "No reasons";
  if (kind === "actionText") return actionLines.join("\n");
  if (kind === "debug") return JSON.stringify(selectedSystem?.snapshot?.debugMath ?? null, null, 2);
  return JSON.stringify(state.alerts.data ?? null, null, 2);
}

function renderOperatorPanel() {
  if (!operatorPanelWrap) return;
  const systems = getAlertsSystems();
  if (!systems.length) {
    operatorPanelWrap.innerHTML = `<div class="rewards-empty">Load wallet summary to view operator panel.</div><div class="table-note">Source: /api/alerts (system selector)</div>`;
    return;
  }
  const kinds = resolveSystemKinds();
  const selected = systems.find((system) => String(system?.id ?? system?.systemId ?? "").toLowerCase() === selectedOperatorSystemId) ?? systems[0];
  const selectedId = String(selected?.id ?? selected?.systemId ?? "unknown").toLowerCase();
  selectedOperatorSystemId = selectedId;
  const score = selected?.scoreObj ?? selected?.score ?? null;
  const reasons = getOperatorReasons(selected);
  const triggers = Array.isArray(selected?.capitalGuard?.triggers) ? selected.capitalGuard.triggers : [];
  const actionText = operatorCopyPayload("actionText", selected);
  const deepDiveSnapshot = JSON.stringify(selected?.snapshot ?? null, null, 2);
  const selectedLabel = selectedId.includes("nx8") ? "NX8" : "SOL";

  operatorPanelWrap.innerHTML = `
    <div class="table-note">Source: <code>/api/alerts</code> (system selector)</div>
    <div class="toggle-row" style="margin-top:8px;">
      <button type="button" id="operatorSelectSolBtn">SOL</button>
      <button type="button" id="operatorSelectNx8Btn">NX8</button>
      <span class="table-note">Selected: ${escapeHtml(selectedLabel)}</span>
    </div>
    <table class="summary-table" style="margin-top:10px;">
      <tbody>
        <tr><td>Capital Guard</td><td>${escapeHtml(String(selected?.capitalGuard?.level ?? "none").toUpperCase())}</td></tr>
        <tr><td>Health</td><td>${escapeHtml(String(selected?.health?.overall ?? "n/a").toUpperCase())}</td></tr>
        <tr><td>Score</td><td>${escapeHtml(String(score?.label ?? "n/a"))} (${Number.isFinite(Number(score?.score0to100)) ? Number(score.score0to100).toFixed(0) : "n/a"})</td></tr>
      </tbody>
    </table>
    <h4 class="table-subhead">Triggers</h4>
    ${triggers.length ? `<ul>${triggers.map((t) => `<li>${escapeHtml(String(t))}</li>`).join("")}</ul>` : `<div class="rewards-empty">No triggers</div>`}
    <h4 class="table-subhead">Reasons</h4>
    ${reasons.length ? `<ul>${reasons.map((r) => `<li>${escapeHtml(String(r))}</li>`).join("")}</ul>` : `<div class="rewards-empty">No reasons</div>`}
    <h4 class="table-subhead">Action Text</h4>
    <textarea id="operatorActionText" class="raw-json" readonly>${escapeHtml(actionText)}</textarea>
    <h4 class="table-subhead">Debug Math (raw)</h4>
    <pre class="raw-json">${escapeHtml(JSON.stringify(selected?.snapshot?.debugMath ?? null, null, 2))}</pre>
    <details style="margin-top:10px;">
      <summary><strong>${escapeHtml(selectedLabel)} Deep Dive (canonical snapshot)</strong></summary>
      <pre class="raw-json" style="margin-top:8px;">${escapeHtml(deepDiveSnapshot)}</pre>
    </details>
    <details style="margin-top:10px;">
      <summary><strong>SOL Deep Dive (positions summary)</strong></summary>
      <div class="toggle-row" style="margin-top:8px;">
        <button type="button" id="loadSolDeepDiveBtn">Load SOL Deep Dive</button>
        <span class="table-note">${
          state.positionsSummary.status === "loading"
            ? "POSITIONS: LOADING"
            : state.positionsSummary.status === "error"
              ? "POSITIONS: ERROR"
              : state.positionsSummary.data?.meta?.degraded === true
                ? "POSITIONS: DEGRADED (cached)"
                : state.positionsSummary.status === "ok"
                  ? "POSITIONS: LIVE"
                  : "POSITIONS: —"
        }</span>
      </div>
      ${
        state.positionsSummary.data?.meta?.degraded === true
          ? `<div class="table-note">Positions summary is cached (${escapeHtml(String(state.positionsSummary.data?.meta?.errorCode ?? "TIMEOUT"))}).</div>`
          : ""
      }
      <pre class="raw-json" style="margin-top:8px;">${escapeHtml(
        JSON.stringify(
          state.positionsSummary.data?.solSystem?.snapshot?.debugMath ?? state.positionsSummary.data?.solSystem?.snapshot ?? null,
          null,
          2
        )
      )}</pre>
    </details>
    <div class="toggle-row" style="margin-top:10px;">
      <button type="button" id="copyOperatorTriggersBtn">Copy Triggers</button>
      <button type="button" id="copyOperatorReasonsBtn">Copy Reasons</button>
      <button type="button" id="copyOperatorActionBtn">Copy Action Text</button>
      <button type="button" id="copyOperatorDebugBtn">Copy Debug Math</button>
      <button type="button" id="copyOperatorSummaryBtn">Copy Full Summary JSON</button>
    </div>
    <div id="operatorCopyStatus" class="table-note"></div>
  `;

  const statusElLocal = document.getElementById("operatorCopyStatus");
  document.getElementById("operatorSelectSolBtn")?.addEventListener("click", () => {
    selectedOperatorSystemId = kinds.solId;
    renderOperatorPanel();
  });
  document.getElementById("operatorSelectNx8Btn")?.addEventListener("click", () => {
    selectedOperatorSystemId = kinds.nx8Id;
    renderOperatorPanel();
  });
  document.getElementById("loadSolDeepDiveBtn")?.addEventListener("click", () => {
    void loadPositionsSummaryOnDemand();
  });
  const bindCopy = (id, kind) => {
    document.getElementById(id)?.addEventListener("click", async () => {
      try {
        await copyTextValue(operatorCopyPayload(kind, selected));
        if (statusElLocal) statusElLocal.textContent = `Copied ${kind}`;
      } catch (err) {
        if (statusElLocal) statusElLocal.textContent = err instanceof Error ? err.message : String(err);
      }
    });
  };
  bindCopy("copyOperatorTriggersBtn", "triggers");
  bindCopy("copyOperatorReasonsBtn", "reasons");
  bindCopy("copyOperatorActionBtn", "actionText");
  bindCopy("copyOperatorDebugBtn", "debug");
  bindCopy("copyOperatorSummaryBtn", "summary");
}
// OPERATOR_ACTION_PANEL_END

function applyOperatorMode() {
  if (operatorModeEnabled) {
    setMainTab("operator");
  }
}

function inferPerpSymbol(mint) {
  const known = {
    So11111111111111111111111111111111111111112: "SOL",
    "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": "WBTC"
  };
  return known[mint] ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol) {
  const amount = Number(row?.amountUi);
  if (!Number.isFinite(amount)) return null;

  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);
  if (stableSymbols.has(row?.symbol)) return amount;

  const strategy = row?.strategy ? strategyMap.get(row.strategy) : null;
  if (strategy) {
    if (row.symbol === strategy.tokenASymbol && Number.isFinite(Number(strategy.tokenAPriceUsd))) {
      return amount * Number(strategy.tokenAPriceUsd);
    }
    if (row.symbol === strategy.tokenBSymbol && Number.isFinite(Number(strategy.tokenBPriceUsd))) {
      return amount * Number(strategy.tokenBPriceUsd);
    }
  }

  const claimedPrice = claimedPriceBySymbol.get(row?.symbol);
  if (Number.isFinite(claimedPrice)) return amount * claimedPrice;
  return null;
}

function renderRollingBorrowApyChart(obligations) {
  const rows = (Array.isArray(obligations) ? obligations : [])
    .map((o) => ({
      obligation: String(o?.obligation ?? ""),
      market: String(o?.market ?? ""),
      pairLabel: deriveLendPairLabel(o),
      rawSeries: Array.isArray(o?.interestPaidRawSeries) ? o.interestPaidRawSeries : []
    }))
    .filter((o) => o.obligation && o.rawSeries.length > 0);
  if (!rows.length) {
    return `<div class="rewards-empty">No raw interest-paid points available.</div>`;
  }

  const colors = ["#53e6b4", "#66b3ff", "#ffd166", "#f78c6b", "#ff7aa2"];
  const allTs = [...new Set(rows.flatMap((r) => r.rawSeries.map((p) => Number(p.ts)).filter((v) => Number.isFinite(v))))].sort((a, b) => a - b);
  const allVals = rows.flatMap((r) => r.rawSeries.map((p) => Number(p.usdFees)).filter((v) => Number.isFinite(v)));
  if (allTs.length < 2 || allVals.length < 1) {
    return `<div class="rewards-empty">Not enough raw points to chart.</div>`;
  }

  const width = 940;
  const height = 280;
  const pad = 28;
  const minY = Math.min(...allVals, 0);
  const maxY = Math.max(...allVals, 1);
  const ySpan = Math.max(0.0001, maxY - minY);
  const xScale = (ts) => pad + ((ts - allTs[0]) / (allTs[allTs.length - 1] - allTs[0])) * (width - pad * 2);
  const yScale = (v) => height - pad - ((v - minY) / ySpan) * (height - pad * 2);
  const chartRows = rows.map((r, idx) => {
    const color = colors[idx % colors.length];
    const rawPoints = r.rawSeries
      .map((p) => ({
        x: xScale(Number(p.ts)),
        y: yScale(Number(p.usdFees)),
        ts: Number(p.ts),
        usdFees: Number(p.usdFees),
        ok: Number.isFinite(Number(p.ts)) && Number.isFinite(Number(p.usdFees))
      }))
      .filter((p) => p.ok);
    return { ...r, color, rawPoints };
  });

  const lines = chartRows
    .map((r) => {
      const pts = r.rawPoints.map((p) => `${p.x},${p.y}`).join(" ");
      if (!pts) return "";
      return `<polyline points="${pts}" fill="none" stroke="${r.color}" stroke-width="2"/>`;
    })
    .join("");

  const dots = chartRows
    .map((r) =>
      r.rawPoints
        .map(
          (p) => `
            <circle class="rolling-point"
              cx="${p.x}" cy="${p.y}" r="5" fill="${r.color}" fill-opacity="0.2" stroke="${r.color}" stroke-width="1.5"
              data-pair="${r.pairLabel}"
              data-obligation="${r.obligation}"
              data-market="${r.market}"
              data-ts="${p.ts}"
              data-raw-usd="${p.usdFees}"
            />
          `
        )
        .join("")
    )
    .join("");

  const endLabels = chartRows
    .map((r) => {
      const last = r.rawPoints[r.rawPoints.length - 1];
      if (!last) return "";
      return `<text x="${Math.min(width - 180, last.x + 6)}" y="${Math.max(pad + 10, last.y - 4)}" fill="${r.color}" font-size="11">${r.pairLabel.replace(
        "/",
        " / "
      )}</text>`;
    })
    .join("");

  const latestRows = rows
    .map((r) => {
      const last = r.rawSeries[r.rawSeries.length - 1] ?? null;
      return {
        obligation: r.obligation,
        market: r.market,
        pairLabel: r.pairLabel,
        ts: Number(last?.ts),
        rawUsd: Number(last?.usdFees)
      };
    })
    .sort((a, b) => Number(b.rawUsd || -Infinity) - Number(a.rawUsd || -Infinity));
  const legend = chartRows
      .map(
        (r) => `
        <span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${r.color};display:inline-block;"></span>
          <span class="mono">${r.pairLabel}</span>
          <span style="opacity:.8;">${r.market}</span>
        </span>
      `
    )
    .join("");

  return `
    <h4 class="table-subhead" style="margin-top:12px;">Raw Interest Paid (7d)</h4>
    <div class="table-note">${legend}</div>
    <div class="rolling-chart-wrap" style="position:relative;">
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Raw interest paid chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#0f1420"></rect>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#243147" />
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#243147" />
      ${lines}
      ${dots}
      ${endLabels}
      <text x="${pad + 8}" y="${pad + 14}" fill="#94a0b5" font-size="12">min ${minY.toFixed(6)} USD</text>
      <text x="${pad + 8}" y="${pad + 30}" fill="#94a0b5" font-size="12">max ${maxY.toFixed(6)} USD</text>
    </svg>
    <div class="rolling-tooltip" style="display:none;position:absolute;z-index:5;pointer-events:none;background:#0b1220;border:1px solid #2c3a57;border-radius:8px;padding:8px 10px;max-width:260px;font-size:12px;line-height:1.35;"></div>
    </div>
    <div class="table-note">Raw interest-paid points from Kamino over the last 7 days.</div>
    <table class="rewards-table" style="margin-top:8px;">
      <thead>
        <tr><th>Pair</th><th>Market</th><th>Timestamp</th><th>Raw Interest Paid (USD)</th></tr>
      </thead>
      <tbody>
        ${latestRows
          .map(
            (r) => `
          <tr>
            <td>${r.pairLabel}</td>
            <td>${r.market}</td>
            <td>${fmtDateTime(r.ts)}</td>
            <td>${fmtUsd(r.rawUsd)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPortfolioSystemsInline() {
  const systems = Array.isArray(latestPortfolioSystems?.systems) ? latestPortfolioSystems.systems : [];
  if (!systems.length) return `<div class="table-note">Portfolio systems: unavailable.</div>`;
  return `<div class="table-note">Portfolio systems: ${systems
    .map((s) => {
      const score = Number(s?.score);
      const status = String(s?.status ?? "red").toUpperCase();
      return `${s?.label ?? s?.id}: ${Number.isFinite(score) ? (score * 100).toFixed(1) : "n/a"} (${status})`;
    })
    .join(" | ")}</div>`;
}

// DEGRADED_STATUS_START
function renderHeaderStatus() {
  if (!dataStatusPill || !degradedBanner) return;
  const alertsMeta = state.alerts.data?.meta ?? null;
  const alertsDegraded = Boolean(alertsMeta?.degraded);
  if (state.alerts.status === "loading") statusEl.textContent = "ALERTS: LOADING";
  else if (state.alerts.status === "error") statusEl.textContent = "ALERTS: ERROR";
  else if (state.alerts.status === "ok") statusEl.textContent = alertsDegraded ? "ALERTS: DEGRADED" : "ALERTS: LIVE";
  else statusEl.textContent = "ALERTS: —";

  if (state.positionsSummary.status === "loading") {
    dataStatusPill.textContent = "POSITIONS: LOADING";
    dataStatusPill.classList.remove("status-pill-warning");
    degradedBanner.classList.add("hidden");
    degradedBanner.innerHTML = "";
    return;
  }
  if (state.positionsSummary.status === "error") {
    dataStatusPill.textContent = "POSITIONS: ERROR";
    dataStatusPill.classList.add("status-pill-warning");
    degradedBanner.classList.add("hidden");
    degradedBanner.innerHTML = "";
    return;
  }
  if (state.positionsSummary.status !== "ok" || !state.positionsSummary.data) {
    dataStatusPill.textContent = "POSITIONS: —";
    dataStatusPill.classList.remove("status-pill-warning");
    degradedBanner.classList.add("hidden");
    degradedBanner.innerHTML = "";
    return;
  }
  const meta = state.positionsSummary.data?.meta ?? null;
  const degraded = Boolean(meta?.degraded);
  if (!degraded) {
    dataStatusPill.textContent = "POSITIONS: LIVE";
    dataStatusPill.classList.remove("status-pill-warning");
    degradedBanner.classList.add("hidden");
    degradedBanner.innerHTML = "";
    return;
  }

  const fallbackSource = String(meta?.fallbackSource ?? "unknown");
  const errorCode = String(meta?.errorCode ?? "ERROR");
  const reasons = Array.isArray(meta?.reasons) ? meta.reasons : [];
  dataStatusPill.textContent = "POSITIONS: DEGRADED (cached)";
  dataStatusPill.classList.add("status-pill-warning");
  degradedBanner.classList.remove("hidden");
  degradedBanner.innerHTML = `
    <div class="table-note">
      Using cached systems index (${escapeHtml(errorCode)}). Some wallet-specific data may be missing.
      <details style="margin-top:6px;">
        <summary>Details</summary>
        <div>fallback: ${escapeHtml(fallbackSource)} | ${escapeHtml(errorCode)}</div>
        ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(String(reason))}</li>`).join("")}</ul>` : ""}
      </details>
    </div>
  `;
}
// DEGRADED_STATUS_END

function render() {
  renderHeaderStatus();
  renderAttentionStrip();
  renderWalletHeadlines();
  renderSystemConsoles();
  renderOperatorPanel();
  if (!(walletDataLoaded || currentMainTab === "wallet") || !state.positionsSummary.data) {
    return;
  }
  renderWalletInventory(state.positionsSummary.data, null);
}

function renderWalletInventory(summary, fullPositions) {
  const perpsPnl = Number(summary?.jupiterPerps?.summary?.pnlUsd ?? 0);
  const liqPnl = Number(summary?.kaminoLiquidity?.pnlUsd ?? 0);
  const liqPnlFarms = Number(summary?.kaminoLiquidity?.pnlUsdFarmsStaked ?? 0);
  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];

  const solPriceFromStrategies = strategyValuations
    .map((s) => {
      if (s?.tokenASymbol === "SOL") return Number(s?.tokenAPriceUsd);
      if (s?.tokenBSymbol === "SOL") return Number(s?.tokenBPriceUsd);
      return NaN;
    })
    .find((v) => Number.isFinite(v));

  const knownTokenNames = {
    SOL: "Solana",
    USDC: "USD Coin",
    USDG: "USDG",
    USDS: "USDS",
    NX8: "NX8"
  };
  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);
  const lendTokenPricesByMint = new Map((summary?.kaminoLend?.tokenPrices?.byMint ?? []).map((r) => [String(r.mint), Number(r.priceUsd)]));
  const lendTokenPricesBySymbol = new Map(
    (summary?.kaminoLend?.tokenPrices?.bySymbol ?? []).map((r) => [String(r.symbol ?? "").toUpperCase(), Number(r.priceUsd)])
  );

  function tokenDisplayName(symbol) {
    if (!symbol) return "Unknown";
    const normalized = symbol.replace("...TwcA", "").replace("...DLVS", "");
    return knownTokenNames[normalized] ?? symbol;
  }

  function tokenPriceUsd(symbol, mint) {
    if (symbol === "SOL" || mint === "So11111111111111111111111111111111111111112") {
      return Number.isFinite(solPriceFromStrategies) ? solPriceFromStrategies : null;
    }
    if (stableSymbols.has(symbol) || stableSymbols.has(tokenDisplayName(symbol))) return 1;
    const lendByMint = lendTokenPricesByMint.get(String(mint ?? ""));
    if (Number.isFinite(lendByMint) && lendByMint > 0) return lendByMint;
    const lendBySymbol = lendTokenPricesBySymbol.get(String(symbol ?? "").toUpperCase());
    if (Number.isFinite(lendBySymbol) && lendBySymbol > 0) return lendBySymbol;

    for (const s of strategyValuations) {
      if (symbol === s?.tokenASymbol || mint === s?.tokenAMint) return Number(s?.tokenAPriceUsd) || null;
      if (symbol === s?.tokenBSymbol || mint === s?.tokenBMint) return Number(s?.tokenBPriceUsd) || null;
    }
    return null;
  }

  const walletTokens = summary?.spot?.tokens ?? [];
  const knownSolSpotUsd = Number.isFinite(solPriceFromStrategies) ? Number(summary?.spot?.nativeSol || 0) * solPriceFromStrategies : 0;
  const knownSplSpotUsd = walletTokens.reduce((acc, t) => {
    const px = tokenPriceUsd(t.symbol, t.mint);
    return acc + (px == null ? 0 : Number(t.amountUi || 0) * px);
  }, 0);
  const walletSpotKnownUsd = knownSolSpotUsd + knownSplSpotUsd;

  const perpsValueUsd = Number(summary?.jupiterPerps?.summary?.valueUsd ?? 0);
  const lendValueUsd = Number(summary?.kaminoLend?.netValueUsd ?? 0);
  const lendObligations = summary?.kaminoLend?.obligations ?? [];
  const claimedRewardsTyped = summary?.kaminoLiquidity?.rewards?.claimedByPositionTypeSymbol ?? [];
  const liqFarmsValueUsd = Number(summary?.kaminoLiquidity?.valueUsdFarmsStaked ?? 0);
  const orcaWhirlpoolsValueUsd = Number(summary?.kaminoLiquidity?.orcaWhirlpoolsValueUsd ?? summary?.orcaWhirlpools?.valueUsd ?? 0);
  const liqPlusOrcaValueUsd = Number(summary?.kaminoLiquidity?.valueUsdFarmsStakedWithOrca ?? (liqFarmsValueUsd + orcaWhirlpoolsValueUsd));
  const claimableValueUsd = Number(summary?.kaminoLiquidity?.rewards?.claimableValueUsd ?? 0);
  const positionsTotalUsd = perpsValueUsd + lendValueUsd + liqPlusOrcaValueUsd;
  const portfolioTotalUsd = positionsTotalUsd + walletSpotKnownUsd;
  const portfolioPlusClaimablesUsd = portfolioTotalUsd + claimableValueUsd;
  const positionsPnlUsd = perpsPnl + liqPnlFarms;

  const pnlClass = positionsPnlUsd >= 0 ? "pnl-pos" : "pnl-neg";
  const liqPnlFarmsClass = liqPnlFarms >= 0 ? "pnl-pos" : "pnl-neg";

  const leverageElement = (fullPositions?.jupiterPerps?.data?.raw?.elements ?? []).find((e) => e?.type === "leverage");
  const perpsPositions = leverageElement?.data?.isolated?.positions ?? [];
  const perpsRowsHtml = perpsPositions.length
    ? perpsPositions
        .map((p) => {
          const symbol = inferPerpSymbol(String(p?.address || ""));
          const side = String(p?.side || "").toLowerCase();
          const sizeValue = Number(p?.sizeValue ?? 0);
          const pnlValue = Number(p?.pnlValue ?? 0);
          const value = Number(p?.value ?? 0);
          const liqPrice = Number(p?.liquidationPrice ?? NaN);
          const markPrice = Number(p?.markPrice ?? NaN);
          const liqGapAbs = Number.isFinite(liqPrice) && Number.isFinite(markPrice) ? Math.abs(liqPrice - markPrice) : NaN;
          const liqBufferPct =
            Number.isFinite(liqPrice) && Number.isFinite(markPrice) && markPrice > 0
              ? side === "short"
                ? ((liqPrice - markPrice) / markPrice) * 100
                : ((markPrice - liqPrice) / markPrice) * 100
              : NaN;
          return `
            <tr>
              <td>${symbol}</td>
              <td>${side || "n/a"}</td>
              <td>${fmtUsd(sizeValue)}</td>
              <td class="${pnlValue >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtSignedUsd(pnlValue)}</td>
              <td>${fmtUsd(value)}</td>
              <td>${Number.isFinite(liqPrice) ? liqPrice.toFixed(4) : "n/a"}</td>
              <td class="${Number.isFinite(liqBufferPct) && liqBufferPct >= 0 ? "pnl-pos" : "pnl-neg"}">${
                Number.isFinite(liqGapAbs) ? liqGapAbs.toFixed(4) : "n/a"
              } (${fmtPct(liqBufferPct)})</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7" class="rewards-empty">No perps positions found.</td></tr>`;

  const pureLendObligations = lendObligations.filter((o) => !String(o?.market || "").toLowerCase().includes("multiply"));
  const pureLendValueUsd = pureLendObligations.reduce((acc, o) => acc + Number(o?.netValueUsd || 0), 0);
  const obligationByBorrowToken = new Map();
  for (const ob of lendObligations) {
    const txs = Array.isArray(ob?.transactions) ? ob.transactions : [];
    const borrowTokens = new Set(
      txs
        .filter((t) => String(t?.transactionDisplayName ?? t?.transactionName ?? "").toLowerCase().includes("borrow"))
        .map((t) => String(t?.liquidityToken ?? "").toUpperCase())
        .filter(Boolean)
    );
    for (const tok of borrowTokens) {
      const prev = obligationByBorrowToken.get(tok) ?? [];
      prev.push(String(ob.obligation));
      obligationByBorrowToken.set(tok, prev);
    }
  }
  const obligationExtraRewardsUsd = new Map();
  const lendRewardTypes = new Set(["Lend", "Multiply", "Lend/Multiply"]);
  for (const row of claimedRewardsTyped) {
    if (!lendRewardTypes.has(String(row?.positionType ?? ""))) continue;
    const sym = String(row?.symbol ?? "").toUpperCase();
    const totalUsd = Number(row?.amountUsd ?? 0);
    const obs = obligationByBorrowToken.get(sym) ?? [];
    if (!obs.length || !Number.isFinite(totalUsd) || totalUsd <= 0) continue;
    const splitUsd = totalUsd / obs.length;
    for (const ob of obs) {
      obligationExtraRewardsUsd.set(ob, (obligationExtraRewardsUsd.get(ob) ?? 0) + splitUsd);
    }
  }
  const lendRowsHtml = pureLendObligations.length
    ? pureLendObligations
        .map(
          (o) => {
            const baseRewards = Number(o.rewardsClaimedUsd ?? 0);
            const linkedRewards = Number(obligationExtraRewardsUsd.get(String(o.obligation)) ?? 0);
            const mergedRewardsUsd = (Number.isFinite(baseRewards) ? baseRewards : 0) + (Number.isFinite(linkedRewards) ? linkedRewards : 0);
            const investedUsd = Number(o.investedUsd ?? NaN);
            const currentNetValueUsd = Number(o.netValueUsd ?? NaN);
            const daysObserved = Number(o.daysCapitalWeighted ?? o.daysObserved ?? NaN);
            const apyWithRewards =
              Number.isFinite(investedUsd) &&
              investedUsd > 0 &&
              Number.isFinite(currentNetValueUsd) &&
              Number.isFinite(daysObserved) &&
              daysObserved > 0
                ? (() => {
                    const adjustedCurrentValueUsd = currentNetValueUsd + mergedRewardsUsd;
                    const gross = adjustedCurrentValueUsd / investedUsd;
                    return gross > 0 ? (gross ** (365 / daysObserved) - 1) * 100 : NaN;
                  })()
                : Number(o.unrealizedApyWithRewardsPct ?? NaN);
            return `
        <tr>
          <td>${o.market}</td>
          <td>${fmtUsd(o.netValueUsd)}</td>
          <td class="${Number(o.pnlUsd ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtSignedUsd(o.pnlUsd)}</td>
          <td>${Number.isFinite(Number(o.daysCapitalWeighted ?? o.daysObserved)) ? Number(o.daysCapitalWeighted ?? o.daysObserved).toFixed(1) : "n/a"}</td>
          <td class="${Number(o.unrealizedApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(o.unrealizedApyPct)}</td>
          <td class="${Number(o.currentNetInterestApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">
            ${fmtPct(o.currentNetInterestApyPct)}
            <br/><span class="mono">Net APY ${fmtPct(o.currentNetInterestApyPct)}</span>
            <br/><span class="mono">ONyc APY (net value terms) ${fmtPct(o.currentSupplyContributionNetApyPct)} | Total Borrow APY (net value terms) ${fmtPct(
              o.currentBorrowCostNetApyPct
            )}</span>
            <br/><span class="mono">Total Supply APY ${fmtPct(o.currentSupplyApyPct)}${o.currentSupplyApySource === "onre-live-apy" ? " (ONRE)" : ""} | raw borrow APY ${fmtPct(
              o.currentBorrowApyPct
            )}</span>
            <br/><span class="mono">combined b ${fmtPct(o.currentCombinedBorrowApyPctLive ?? o.combinedBorrowApyPctEst)} | credit ${fmtPct(
              o.currentBorrowRewardCreditApyPctLive ?? o.borrowRewardCreditApyPctEst
            )}</span>
          </td>
          <td>${fmtUsd(mergedRewardsUsd)}</td>
          <td class="${Number(apyWithRewards ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(apyWithRewards)}</td>
          <td>${
            Array.isArray(o.transactions) && o.transactions.length
              ? o.transactions
                  .slice(0, 2)
                  .map(
                    (t) =>
                      `${t.transactionDisplayName ?? t.transactionName ?? "tx"} ${fmtTokenAmount(t.liquidityTokenAmount)} ${t.liquidityToken ?? ""} (${fmtUsd(
                        t.liquidityUsdValue
                      )}) @ ${t.createdOn ? new Date(t.createdOn).toLocaleString() : "n/a"}`
                  )
                  .join("<br/>")
              : "n/a"
          }</td>
          <td>${o.obligation}</td>
        </tr>
      `;
          }
        )
        .join("")
    : `<tr><td colspan="10" class="rewards-empty">No non-multiply lend obligations found.</td></tr>`;
  const farmingRowsHtml = strategyValuations.length
    ? strategyValuations
        .map((s) => {
          const pnlUsd = Number(s.pnlUsdFarmsStaked ?? s.pnlUsd ?? 0);
          const feesPnlUsd = Number(s.feesPnlUsd ?? NaN);
          const priceAndRatioPnlUsd = Number(s.priceAndRatioPnlUsd ?? NaN);
          const daysObserved = Number(s.daysObserved ?? NaN);
          const rewardsClaimedUsd = Number(s.rewardsClaimedUsdLiquidity ?? 0);
          const rewardsUnclaimedUsd = Number(s.rewardsUnclaimedUsdLiquidity ?? 0);
          const rewardsTotalUsd = Number(s.rewardsTotalUsdLiquidity ?? rewardsClaimedUsd + rewardsUnclaimedUsd);
          const historyDepositsUsd = Number(s.historyNetDepositsUsd ?? NaN);
          const unreconciledBasisUsd = Number(s.unreconciledCostBasisUsd ?? NaN);
          return `
        <tr>
          <td>${s.pairLabel ?? "unknown"}</td>
          <td>${fmtUsd(s.valueUsdFarmsStaked ?? s.valueUsd)}</td>
          <td class="${pnlUsd >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtSignedUsd(s.pnlUsdFarmsStaked ?? s.pnlUsd)}</td>
          <td class="${Number.isFinite(feesPnlUsd) ? (feesPnlUsd >= 0 ? "pnl-pos" : "pnl-neg") : ""}">${
            Number.isFinite(feesPnlUsd) ? fmtSignedUsd(feesPnlUsd) : "n/a"
          }</td>
          <td class="${Number.isFinite(priceAndRatioPnlUsd) ? (priceAndRatioPnlUsd >= 0 ? "pnl-pos" : "pnl-neg") : ""}">${
            Number.isFinite(priceAndRatioPnlUsd) ? fmtSignedUsd(priceAndRatioPnlUsd) : "n/a"
          }</td>
          <td>${Number.isFinite(daysObserved) ? daysObserved.toFixed(1) : "n/a"}</td>
          <td>${Number.isFinite(historyDepositsUsd) ? fmtUsd(historyDepositsUsd) : "n/a"}</td>
          <td class="${Number.isFinite(unreconciledBasisUsd) ? (unreconciledBasisUsd >= 0 ? "pnl-neg" : "pnl-pos") : ""}">${
            Number.isFinite(unreconciledBasisUsd) ? fmtSignedUsd(unreconciledBasisUsd) : "n/a"
          }</td>
          <td class="${Number(s.unrealizedApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(s.unrealizedApyPct)}</td>
          <td class="${Number(s.feesApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(s.feesApyPct)}</td>
          <td class="${Number(s.rewardsApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(s.rewardsApyPct)}</td>
          <td>
            ${fmtUsd(rewardsTotalUsd)}
            <details class="inline-details">
              <summary>Details</summary>
              <span class="mono">claimed ${fmtUsd(rewardsClaimedUsd)} | unclaimed ${fmtUsd(rewardsUnclaimedUsd)}</span>
            </details>
          </td>
          <td class="${Number(s.totalApyPct ?? 0) >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(s.totalApyPct)}</td>
        </tr>
      `;
        })
        .join("")
    : `<tr><td colspan="13" class="rewards-empty">No farming/liquidity strategy rows found.</td></tr>`;

  summaryCards.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Jupiter Perps</td>
          <td>${fmtUsd(perpsValueUsd)}</td>
        </tr>
        <tr>
          <td>Kamino Multiply/Lend Net</td>
          <td>${fmtUsd(lendValueUsd)}</td>
        </tr>
        <tr>
          <td>Kamino Liquidity + Orca (farms-staked + whirlpools)</td>
          <td>${fmtUsd(liqPlusOrcaValueUsd)}</td>
        </tr>
        <tr class="total-row">
          <td>Positions Total (subtotal)</td>
          <td>${fmtUsd(positionsTotalUsd)}</td>
        </tr>
        <tr>
          <td>Wallet Balance</td>
          <td>${fmtUsd(walletSpotKnownUsd)}</td>
        </tr>
        <tr class="total-row">
          <td>Portfolio Total</td>
          <td>${fmtUsd(portfolioTotalUsd)}</td>
        </tr>
        <tr>
          <td>Claimable Rewards</td>
          <td>${fmtUsd(claimableValueUsd)}</td>
        </tr>
        <tr class="total-row">
          <td>Portfolio + Claimables Total</td>
          <td>${fmtUsd(portfolioPlusClaimablesUsd)}</td>
        </tr>
      </tbody>
    </table>
    ${renderPortfolioSystemsInline()}
    <div class="collapse-actions">
      <button id="collapseToggleBtn" type="button">Expand all</button>
    </div>
    <div class="collapse-grid">
      <details class="collapse-card">
        <summary>Jupiter Perps <span>${fmtUsd(perpsValueUsd)}</span></summary>
        <div class="rewards-wrap">
          <table class="rewards-table">
            <thead>
              <tr><th>Token</th><th>Side</th><th>Notional</th><th>PnL</th><th>Value</th><th>Liq Price</th><th>Distance to Liq</th></tr>
            </thead>
            <tbody>${perpsRowsHtml}</tbody>
          </table>
        </div>
      </details>
      <details class="collapse-card">
        <summary>Kamino Lend (non-multiply) <span>${fmtUsd(pureLendValueUsd)}</span></summary>
        <div class="rewards-wrap">
          <table class="rewards-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Net Value</th>
                <th>PnL</th>
                <th>Days (Wtd)</th>
                <th>Unrealized APR</th>
                <th>Current APY (forward)</th>
                <th>Rewards</th>
                <th>APR + Rewards</th>
                <th>Recent Transactions</th>
                <th>Obligation</th>
              </tr>
            </thead>
            <tbody>${lendRowsHtml}</tbody>
          </table>
          <p class="table-note">Labels now mirror Kamino net-value terminology: Net APY = ONyc APY (net value terms) + Total Supply APY contribution - Total Borrow APY (net value terms). Raw reserve rates and reward-credit breakdown remain shown for transparency.</p>
        </div>
      </details>
      <details class="collapse-card">
        <summary>Kamino Liquidity / Farming + Orca <span>${fmtUsd(liqPlusOrcaValueUsd)}</span></summary>
        <div class="rewards-wrap">
          <div class="table-note">Kamino farms-staked valuation: ${fmtUsd(liqFarmsValueUsd)} | Orca whirlpools (est): ${fmtUsd(orcaWhirlpoolsValueUsd)}</div>
          <table class="rewards-table">
            <thead>
              <tr><th>Pair</th><th>Value</th><th>PnL</th><th>Fees/Rewards PnL</th><th>Price/Ratio PnL</th><th>Days</th><th>Deposits (History)</th><th>Unreconciled Basis</th><th>Unrealized APR</th><th>Fees APY</th><th>Rewards APY</th><th>Rewards</th><th>Total APY</th></tr>
            </thead>
            <tbody>${farmingRowsHtml}</tbody>
          </table>
        </div>
      </details>
      <details class="collapse-card">
        <summary>Wallet Holdings <span>${fmtUsd(walletSpotKnownUsd)}</span></summary>
        <div class="rewards-wrap">
          <table class="rewards-table">
            <thead>
              <tr><th>Token</th><th>Amount</th><th>Value</th></tr>
            </thead>
            <tbody>
            ${[
              {
                name: "Solana",
                mint: "Native",
                amountUi: Number(summary?.spot?.nativeSol || 0),
                valueUsd: knownSolSpotUsd
              },
              ...walletTokens.map((t) => {
                const px = tokenPriceUsd(t.symbol, t.mint);
                return {
                  name: tokenDisplayName(t.symbol ?? "unknown"),
                  mint: t.mint,
                  amountUi: Number(t.amountUi || 0),
                  valueUsd: px == null ? null : Number(t.amountUi || 0) * px
                };
              })
            ]
              .filter((r) => r.valueUsd != null && Number.isFinite(r.valueUsd))
              .sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd))
              .map(
                (r) => `
              <tr>
                <td>${r.name}</td>
                <td>${fmtTokenAmount(r.amountUi)}</td>
                <td>${fmtUsd(r.valueUsd)}</td>
              </tr>
            `
              )
              .join("")}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;

  const collapseToggleBtn = summaryCards.querySelector("#collapseToggleBtn");
  const collapseCards = Array.from(summaryCards.querySelectorAll(".collapse-card"));
  if (collapseToggleBtn && collapseCards.length) {
    const syncLabel = () => {
      const allOpen = collapseCards.every((d) => d.open);
      collapseToggleBtn.textContent = allOpen ? "Collapse all" : "Expand all";
    };
    collapseToggleBtn.addEventListener("click", () => {
      const allOpen = collapseCards.every((d) => d.open);
      for (const d of collapseCards) d.open = !allOpen;
      syncLabel();
    });
    for (const d of collapseCards) d.addEventListener("toggle", syncLabel);
    syncLabel();
  }

  const walletRows = [
    {
      name: "Solana",
      mint: "Native",
      amountUi: Number(summary?.spot?.nativeSol || 0),
      valueUsd: (Number(summary?.spot?.nativeSol || 0) || 0) * (Number.isFinite(solPriceFromStrategies) ? solPriceFromStrategies : 0)
    },
    ...walletTokens.map((t) => {
      const px = tokenPriceUsd(t.symbol, t.mint);
      const md = t.metadata ?? null;
      const inferredType = md?.isNft === true ? "NFT" : md?.isNft === false ? "Fungible" : "Unknown";
      const inferredSource = md?.source === "das" ? "DAS" : "Heuristic";
      const inferredDetails =
        md?.description?.trim() ||
        md?.interface ||
        md?.tokenStandard ||
        (Number(t.decimals) === 0 && Number(t.amountUi) <= 1 ? "Likely NFT/receipt-style token (0 decimals)." : "No priced market found.");
      return {
        name: tokenDisplayName(t.symbol ?? "unknown"),
        mint: t.mint,
        amountUi: Number(t.amountUi || 0),
        valueUsd: px == null ? null : Number(t.amountUi || 0) * px,
        tokenType: inferredType,
        source: inferredSource,
        details: inferredDetails
      };
    })
  ].sort((a, b) => {
    const av = a.valueUsd;
    const bv = b.valueUsd;
    const aKnown = av != null && Number.isFinite(av);
    const bKnown = bv != null && Number.isFinite(bv);
    if (aKnown && bKnown) return bv - av;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return 0;
  });

  const pricedWalletRows = walletRows.filter((row) => row.valueUsd != null && Number.isFinite(row.valueUsd));
  const unpricedWalletRows = walletRows.filter((row) => row.valueUsd == null || !Number.isFinite(row.valueUsd));
  const pricedWalletTotalUsd = pricedWalletRows.reduce((acc, row) => acc + Number(row.valueUsd || 0), 0);

  walletTokensWrap.innerHTML = `
    <h4 class="table-subhead">Priced Tokens</h4>
    <table class="rewards-table">
      <thead>
        <tr>
          <th>Token</th>
          <th>Amount</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${
          pricedWalletRows.length
            ? pricedWalletRows
                .map(
                  (row) => `
                <tr>
                  <td>${row.name}</td>
                  <td>${fmtTokenAmount(row.amountUi)}</td>
                  <td>${fmtUsd(row.valueUsd)}</td>
                </tr>
              `
                )
                .join("")
            : `
                <tr>
                  <td colspan="3" class="rewards-empty">No priced wallet tokens found.</td>
                </tr>
              `
        }
        <tr class="total-row">
          <td></td>
          <td>Total USD</td>
          <td>${fmtUsd(pricedWalletTotalUsd)}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="table-subhead">Unpriced Tokens (n/a)</h4>
    <table class="rewards-table">
      <thead>
        <tr>
          <th>Token</th>
          <th>Amount</th>
          <th>Type</th>
          <th>Source</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${
          unpricedWalletRows.length
            ? unpricedWalletRows
                .map(
                  (row) => `
                <tr>
                  <td>${row.name}</td>
                  <td>${fmtTokenAmount(row.amountUi)}</td>
                  <td>${row.tokenType ?? "Known"}</td>
                  <td>${row.source ?? "n/a"}</td>
                  <td>${row.details ?? "n/a"}</td>
                </tr>
              `
                )
                .join("")
            : `
                <tr>
                  <td colspan="5" class="rewards-empty">No unpriced wallet tokens.</td>
                </tr>
              `
        }
      </tbody>
    </table>
    <p class="table-note">n/a means no reliable USD price feed was found in current sources. Type/details come from token metadata when available.</p>
  `;

  const claimableByPosition =
    summary?.kaminoLiquidity?.rewards?.claimableByPositionWithOrca ?? summary?.kaminoLiquidity?.rewards?.claimableByPosition ?? [];
  const claimedRewards = summary?.kaminoLiquidity?.rewards?.claimed ?? [];
  const claimedRewardsTypedRows = summary?.kaminoLiquidity?.rewards?.claimedByPositionTypeSymbol ?? [];
  function obligationTextForToken(symbol) {
    const obs = obligationByBorrowToken.get(String(symbol ?? "").toUpperCase()) ?? [];
    return obs.length ? obs.join(", ") : "-";
  }
  function tokenCellWithMeta(label, meta) {
    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const parts = [];
    if (meta?.mint) parts.push(`Mint: ${meta.mint}`);
    if (meta?.obligation) parts.push(`Obligation: ${meta.obligation}`);
    const title = parts.join("\n");
    return title ? `<span title="${esc(title)}">${esc(String(label ?? "-"))}</span>` : esc(String(label ?? "-"));
  }
  const strategyMap = new Map(strategyValuations.map((s) => [s.strategy, s]));
  const claimedPriceBySymbol = new Map(
    claimedRewards
      .filter((r) => Number(r.amountUi) > 0 && Number(r.amountUsd) > 0)
      .map((r) => [r.symbol, Number(r.amountUsd) / Number(r.amountUi)])
  );

  rewardsTableWrap.innerHTML = claimableByPosition.length || claimedRewards.length
    ? (() => {
        const totalRewardsUsd = claimableByPosition.reduce((acc, row) => {
          if (String(row?.source || "") === "orca" && Number.isFinite(Number(row?.amountUsd))) {
            return acc + Number(row.amountUsd);
          }
          const v = estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol);
          return acc + (Number.isFinite(Number(v)) ? Number(v) : 0);
        }, 0);
        const claimedTotalUsd = claimedRewards.reduce((acc, row) => acc + (Number.isFinite(Number(row.amountUsd)) ? Number(row.amountUsd) : 0), 0);
        const rewardsClaimsColgroup = `
        <colgroup>
          <col style="width: 120px" />
          <col style="width: 150px" />
          <col style="width: 110px" />
          <col style="width: 180px" />
          <col style="width: 140px" />
        </colgroup>`;
        return `
      <h4 class="table-subhead">Claimable</h4>
      <table class="rewards-table rewards-claims-table">
        ${rewardsClaimsColgroup}
        <thead>
          <tr>
            <th>Token</th>
            <th>Amount</th>
            <th>Value</th>
            <th>Position</th>
            <th>Position Type</th>
          </tr>
        </thead>
        <tbody>
          ${claimableByPosition
            .map((row) => {
              const isOrcaPending = String(row?.source || "") === "orca";
              const valueUsd = isOrcaPending
                ? (Number.isFinite(Number(row?.amountUsd)) ? Number(row.amountUsd) : null)
                : estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol);
              const orcaTokenLabel = (mint) => {
                if (mint === "So11111111111111111111111111111111111111112") return "SOL";
                if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return "USDC";
                return shortPk(String(mint || ""));
              };
              const amountCell = isOrcaPending
                ? (Array.isArray(row?.breakdown) && row.breakdown.length
                    ? row.breakdown
                        .map((b) => {
                          const sym = orcaTokenLabel(String(b?.token || ""));
                          const amt = Number.isFinite(Number(b?.amount)) ? fmtTokenAmount(b.amount) : "n/a";
                          const usd = Number.isFinite(Number(b?.amountUsd)) ? fmtUsd(b.amountUsd) : "n/a";
                          return `${amt} ${sym} (${usd})`;
                        })
                        .join("<br/>")
                    : "n/a")
                : fmtTokenAmount(row.amountUi);
              if (isOrcaPending && Array.isArray(row?.breakdown) && row.breakdown.length) {
                return row.breakdown
                  .map((b) => {
                    const tokenMint = String(b?.token || "");
                    const tokenSymbol = orcaTokenLabel(tokenMint);
                    const tokenAmount = Number.isFinite(Number(b?.amount)) ? fmtTokenAmount(b.amount) : "n/a";
                    const tokenValueUsd = Number.isFinite(Number(b?.amountUsd)) ? fmtUsd(b.amountUsd) : "n/a";
                    return `
                <tr>
                  <td>${tokenCellWithMeta(tokenSymbol, { mint: tokenMint, obligation: "-" })}</td>
                  <td>${tokenAmount}</td>
                  <td>${tokenValueUsd}</td>
                  <td>${row.position}</td>
                  <td>${row.positionType}</td>
                </tr>
              `;
                  })
                  .join("");
              }
              return `
                <tr>
                  <td>${tokenCellWithMeta(isOrcaPending ? "Orca Pending Yield" : row.symbol, {
                    mint: row.mint ?? "-",
                    obligation:
                      row.positionType === "Lend" || row.positionType === "Multiply" ? obligationTextForToken(row.symbol) : "-"
                  })}</td>
                  <td>${amountCell}</td>
                  <td>${fmtUsd(valueUsd)}</td>
                  <td>${row.position}</td>
                  <td>${row.positionType}</td>
                </tr>
              `;
            })
            .join("")}
          <tr class="total-row">
            <td></td>
            <td></td>
            <td>${fmtUsd(totalRewardsUsd)}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <h4 class="table-subhead" style="margin-top:14px;">Claimed</h4>
      <table class="rewards-table rewards-claims-table">
        ${rewardsClaimsColgroup}
        <thead>
          <tr>
            <th>Token</th>
            <th>Amount</th>
            <th>Value</th>
            <th>Position</th>
            <th>Position Type</th>
          </tr>
        </thead>
        <tbody>
          ${
            claimedRewardsTypedRows.length
              ? claimedRewardsTypedRows
                  .map(
                    (row) => `
                <tr>
                  <td>${tokenCellWithMeta(row.symbol, {
                    mint: row.mint ?? "-",
                    obligation:
                      row.positionType === "Lend" || row.positionType === "Multiply" || row.positionType === "Lend/Multiply"
                        ? obligationTextForToken(row.symbol)
                        : "-"
                  })}</td>
                  <td>${fmtTokenAmount(row.amountUi)}</td>
                  <td>${fmtUsd(row.amountUsd)}</td>
                  <td>${row.position ?? "-"}</td>
                  <td>${row.positionType ?? "-"}</td>
                </tr>
              `
                  )
                  .join("")
              : `
                <tr>
                  <td colspan="5" class="rewards-empty">No claimed rewards found.</td>
                </tr>
              `
          }
          <tr class="total-row">
            <td></td>
            <td></td>
            <td>${fmtUsd(claimedTotalUsd)}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `
      })()
    : `<div class="rewards-empty">No rewards found.</div>`;

  if (walletSummaryStatus) walletSummaryStatus.textContent = `Wallet data updated ${new Date().toLocaleTimeString()}`;
  if (walletTokensSummary) walletTokensSummary.textContent = `${pricedWalletRows.length + unpricedWalletRows.length} tokens`;
  if (walletPositionsSummary) walletPositionsSummary.textContent = `${fmtUsd(positionsTotalUsd)} total`;
  if (walletRewardsSummary) walletRewardsSummary.textContent = `${fmtUsd(Number(summary?.kaminoLiquidity?.rewards?.claimableValueUsd ?? 0))} claimable`;
}

async function ensureWalletDataLoaded() {
  if (walletDataLoaded && state.positionsSummary.data) return;
  walletDataLoaded = true;
  if (!state.positionsSummary.data) {
    if (walletSummaryStatus) walletSummaryStatus.textContent = "Load SOL Deep Dive in Operator to populate wallet inventory.";
    walletTokensWrap.innerHTML = `<div class="rewards-empty">Positions summary not loaded.</div>`;
    summaryCards.innerHTML = `<div class="rewards-empty">Positions summary not loaded.</div>`;
    rewardsTableWrap.innerHTML = `<div class="rewards-empty">Positions summary not loaded.</div>`;
    return;
  }
  if (walletSummaryStatus) walletSummaryStatus.textContent = "Loading wallet inventory...";
  render();
}

async function refreshWalletData() {
  setMainTab("wallet");
  await loadPositionsSummaryOnDemand();
}

async function loadPositionsSummaryOnDemand(options = {}) {
  const background = options.background === true;
  const wallet = walletInput.value.trim();
  if (!wallet) {
    state.positionsSummary.status = "error";
    state.positionsSummary.error = "Wallet required";
    render();
    return;
  }
  state.positionsSummary.status = "loading";
  state.positionsSummary.error = null;
  render();
  try {
    const summaryRes = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=summary`);
    if (!summaryRes.ok) {
      const body = await summaryRes.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${summaryRes.status})`);
    }
    state.positionsSummary.data = await summaryRes.json();
    state.positionsSummary.status = "ok";
    state.positionsSummary.error = null;
    state.positionsSummary.fetchedAt = Date.now();
    walletDataLoaded = true;
    render();
    if (walletSummaryStatus && !background) walletSummaryStatus.textContent = `Wallet refreshed ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    state.positionsSummary.status = "error";
    state.positionsSummary.error = err instanceof Error ? err.message : String(err);
    render();
    if (walletSummaryStatus && !background) walletSummaryStatus.textContent = state.positionsSummary.error;
  }
}

async function loadAlerts() {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    state.alerts.status = "error";
    state.alerts.error = "Wallet required";
    render();
    return;
  }
  loadBtn.disabled = true;
  const walletChanged = latestWallet !== wallet;
  latestWallet = wallet;
  if (walletChanged) {
    state.positionsSummary = { data: null, fetchedAt: null, status: "idle", error: null };
    walletDataLoaded = false;
    if (walletSummaryStatus) walletSummaryStatus.textContent = "Idle";
  }
  state.alerts.status = "loading";
  state.alerts.error = null;
  render();
  try {
    const alertsRes = await fetch(`/api/alerts?wallet=${encodeURIComponent(wallet)}`);
    if (!alertsRes.ok) {
      const body = await alertsRes.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${alertsRes.status})`);
    }
    state.alerts.data = await alertsRes.json();
    state.alerts.status = "ok";
    state.alerts.error = null;
    state.alerts.fetchedAt = Date.now();
    selectedOperatorSystemId = chooseDefaultOperatorSystemId();
    render();
    if (walletChanged || !state.positionsSummary.data) {
      void loadPositionsSummaryOnDemand({ background: true });
    }
  } catch (err) {
    state.alerts.status = "error";
    state.alerts.error = err instanceof Error ? err.message : String(err);
    state.alerts.data = null;
    render();
  } finally {
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener("click", loadAlerts);
walletInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadAlerts();
});
tabPortfolioMain?.addEventListener("click", () => setMainTab("portfolio"));
tabOrcaMain?.addEventListener("click", () => setMainTab("orca"));
tabOperatorMain?.addEventListener("click", () => setMainTab("operator"));
tabWalletMain?.addEventListener("click", () => setMainTab("wallet"));
refreshOrcaBtn?.addEventListener("click", () => {
  void ensureOrcaDataLoaded({ force: true, cacheBust: true });
});
refreshWalletBtn?.addEventListener("click", () => {
  void refreshWalletData();
});
if (orcaFullTableDetails) {
  orcaFullTableDetails.open = loadOrcaFullTableState();
  orcaFullTableDetails.addEventListener("toggle", () => {
    persistOrcaFullTableState(Boolean(orcaFullTableDetails.open));
  });
}
if (walletTokensDetails) walletTokensDetails.open = false;
if (walletPositionsDetails) walletPositionsDetails.open = false;
if (walletRewardsDetails) walletRewardsDetails.open = false;
operatorModeToggle?.addEventListener("change", () => {
  operatorModeEnabled = Boolean(operatorModeToggle.checked);
  persistOperatorModeState(operatorModeEnabled);
  applyOperatorMode();
  render();
});
operatorModeEnabled = loadOperatorModeState();
if (operatorModeToggle) operatorModeToggle.checked = operatorModeEnabled;
applyOperatorMode();
window.addEventListener("hashchange", () => {
  const hashTab = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
  if (hashTab === "portfolio" || hashTab === "orca" || hashTab === "operator" || hashTab === "wallet") {
    setMainTab(hashTab, { skipHash: true });
  }
});
setMainTab(operatorModeEnabled ? "operator" : loadMainTabState(), { skipHash: true });
void ensureOrcaDataLoaded();
loadAlerts();
