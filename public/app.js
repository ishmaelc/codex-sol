const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const autoRefresh = document.getElementById("autoRefresh");
const betaEnabled = document.getElementById("betaEnabled");
const statusEl = document.getElementById("status");
const updatedAt = document.getElementById("updatedAt");
const summaryCards = document.getElementById("summaryCards");
const deltaMeta = document.getElementById("deltaMeta");
const driftPctLabel = document.getElementById("driftPctLabel");
const driftNeedle = document.getElementById("driftNeedle");
const liquidityTableWrap = document.getElementById("liquidityTableWrap");
const hedgeTableWrap = document.getElementById("hedgeTableWrap");
const multiplyTableWrap = document.getElementById("multiplyTableWrap");
const rewardsSummary = document.getElementById("rewardsSummary");
const walletTokensWrap = document.getElementById("walletTokensWrap");
const rawJson = document.getElementById("rawJson");
const rawFullJson = document.getElementById("rawFullJson");

const DEFAULT_WALLET = "4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr";
walletInput.value = DEFAULT_WALLET;

let refreshTimer = null;
let latestWallet = "";
let latestSummary = null;
let latestFullPositions = null;
let fullPositionsLoadPromise = null;

const HEDGE_LINKS = [
  { strategyLabel: "NX8-USDC vs WBTC Short", lpPair: "NX8-USDC", perpSymbol: "WBTC" },
  { strategyLabel: "SOL-USDG vs SOL Short", lpPair: "SOL-USDG", perpSymbol: "SOL" }
];
const BETA_OVERRIDES = {
  "NX8-USDC vs WBTC Short": 1.0,
  "SOL-USDG vs SOL Short": 1.0
};

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

function deriveLendPairLabel(ob) {
  const rows = Array.isArray(ob?.reserveApyBreakdown) ? ob.reserveApyBreakdown : [];
  const supply = rows.find((r) => String(r?.side) === "supply" && r?.symbol)?.symbol ?? null;
  const borrow = rows.find((r) => String(r?.side) === "borrow" && r?.symbol)?.symbol ?? null;
  if (supply && borrow) return `${supply}/${borrow}`;
  return String(ob?.market ?? "Unknown Pair");
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
  if (stableSymbols.has(String(row?.symbol || "").toUpperCase())) return amount;

  const strategy = row?.strategy ? strategyMap.get(row.strategy) : null;
  if (strategy) {
    if (row.symbol === strategy.tokenASymbol && Number.isFinite(Number(strategy.tokenAPriceUsd))) {
      return amount * Number(strategy.tokenAPriceUsd);
    }
    if (row.symbol === strategy.tokenBSymbol && Number.isFinite(Number(strategy.tokenBPriceUsd))) {
      return amount * Number(strategy.tokenBPriceUsd);
    }
  }

  const claimedPrice = claimedPriceBySymbol.get(String(row?.symbol || "").toUpperCase());
  if (Number.isFinite(claimedPrice)) return amount * claimedPrice;
  return null;
}

function hedgeSignal(driftPct, hedgeRatio) {
  if (!Number.isFinite(driftPct) || !Number.isFinite(hedgeRatio)) return { label: "n/a", className: "" };
  const absDrift = Math.abs(driftPct);
  const ratioOff = Math.abs(1 - hedgeRatio);
  if (absDrift <= 10 && ratioOff <= 0.1) return { label: "OK", className: "pnl-pos" };
  if (absDrift <= 20 && ratioOff <= 0.2) return { label: "Watch", className: "pnl-warn" };
  return { label: "Rebalance", className: "pnl-neg" };
}

function computeHedgeRows(summary, fullPositions) {
  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];
  const valuationByPair = new Map(strategyValuations.map((v) => [String(v?.pairLabel || "").toUpperCase(), v]));
  const leverageElement = (fullPositions?.jupiterPerps?.data?.raw?.elements ?? []).find((e) => e?.type === "leverage");
  const perpsPositions = leverageElement?.data?.isolated?.positions ?? [];

  const perpsBySymbol = new Map();
  for (const p of perpsPositions) {
    const symbol = inferPerpSymbol(String(p?.address || ""));
    const side = String(p?.side || "").toLowerCase();
    const notional = Math.abs(Number(p?.sizeValue || 0));
    const deltaUsd = side === "short" ? -notional : notional;
    const prev = perpsBySymbol.get(symbol) ?? { notionalUsd: 0, deltaUsd: 0, side };
    prev.notionalUsd += notional;
    prev.deltaUsd += deltaUsd;
    prev.side = side || prev.side;
    perpsBySymbol.set(symbol, prev);
  }

  function estimateLpVolatileDeltaUsd(valuation) {
    const a = String(valuation?.tokenASymbol || "").toUpperCase();
    const b = String(valuation?.tokenBSymbol || "").toUpperCase();
    const stable = new Set(["USDC", "USDG", "USDS"]);
    const tokenAValueExact = Number(valuation?.tokenAValueUsdFarmsStaked ?? NaN);
    const tokenBValueExact = Number(valuation?.tokenBValueUsdFarmsStaked ?? NaN);
    if (stable.has(a) && !stable.has(b) && Number.isFinite(tokenBValueExact)) return { token: b, deltaUsd: tokenBValueExact, method: "exact" };
    if (stable.has(b) && !stable.has(a) && Number.isFinite(tokenAValueExact)) return { token: a, deltaUsd: tokenAValueExact, method: "exact" };
    const pairValue = Number(valuation?.valueUsdFarmsStaked ?? valuation?.valueUsd ?? 0);
    const est = pairValue * 0.5;
    if (stable.has(a) && !stable.has(b)) return { token: b, deltaUsd: est, method: "fallback-50" };
    if (stable.has(b) && !stable.has(a)) return { token: a, deltaUsd: est, method: "fallback-50" };
    return { token: a || b || "unknown", deltaUsd: est, method: "fallback-50" };
  }

  return HEDGE_LINKS.map((link) => {
    const valuation = valuationByPair.get(link.lpPair.toUpperCase());
    const lpValueUsd = Number(valuation?.valueUsdFarmsStaked ?? valuation?.valueUsd ?? NaN);
    const lpDelta = valuation ? estimateLpVolatileDeltaUsd(valuation) : { token: "n/a", deltaUsd: NaN };
    const beta = Number(BETA_OVERRIDES[link.strategyLabel] ?? 1);
    const betaAdjustedLpDeltaUsd = Number.isFinite(lpDelta.deltaUsd) ? lpDelta.deltaUsd * beta : NaN;
    const perp = perpsBySymbol.get(link.perpSymbol) ?? { notionalUsd: NaN, deltaUsd: NaN, side: "n/a" };
    const targetPerpDeltaUsd = Number.isFinite(betaAdjustedLpDeltaUsd) ? -betaAdjustedLpDeltaUsd : NaN;
    const netDeltaUsd =
      Number.isFinite(betaAdjustedLpDeltaUsd) && Number.isFinite(perp.deltaUsd) ? betaAdjustedLpDeltaUsd + perp.deltaUsd : NaN;
    const hedgeRatio =
      Number.isFinite(betaAdjustedLpDeltaUsd) && betaAdjustedLpDeltaUsd > 0 && Number.isFinite(perp.deltaUsd)
        ? Math.abs(perp.deltaUsd) / betaAdjustedLpDeltaUsd
        : NaN;
    const driftPct =
      Number.isFinite(betaAdjustedLpDeltaUsd) && betaAdjustedLpDeltaUsd > 0 && Number.isFinite(netDeltaUsd)
        ? (netDeltaUsd / betaAdjustedLpDeltaUsd) * 100
        : NaN;

    return {
      ...link,
      lpValueUsd,
      lpToken: lpDelta.token,
      betaAdjustedLpDeltaUsd,
      perpSide: perp.side,
      perpNotionalUsd: perp.notionalUsd,
      perpDeltaUsd: perp.deltaUsd,
      targetPerpDeltaUsd,
      netDeltaUsd,
      hedgeRatio,
      driftPct
    };
  });
}

function renderSummaryStrip(summary) {
  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];
  const perpsValueUsd = Number(summary?.jupiterPerps?.summary?.valueUsd ?? 0);
  const lendValueUsd = Number(summary?.kaminoLend?.netValueUsd ?? 0);
  const liqValueUsd = Number(summary?.kaminoLiquidity?.valueUsdFarmsStaked ?? 0);
  const positionsTotalUsd = perpsValueUsd + lendValueUsd + liqValueUsd;

  const solPriceFromStrategies = strategyValuations
    .map((s) => {
      if (s?.tokenASymbol === "SOL") return Number(s?.tokenAPriceUsd);
      if (s?.tokenBSymbol === "SOL") return Number(s?.tokenBPriceUsd);
      return NaN;
    })
    .find((v) => Number.isFinite(v));

  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);
  const lendTokenPricesByMint = new Map((summary?.kaminoLend?.tokenPrices?.byMint ?? []).map((r) => [String(r.mint), Number(r.priceUsd)]));
  const lendTokenPricesBySymbol = new Map(
    (summary?.kaminoLend?.tokenPrices?.bySymbol ?? []).map((r) => [String(r.symbol ?? "").toUpperCase(), Number(r.priceUsd)])
  );

  function tokenPriceUsd(symbol, mint) {
    const sym = String(symbol ?? "").toUpperCase();
    if (sym === "SOL" || mint === "So11111111111111111111111111111111111111112") {
      return Number.isFinite(solPriceFromStrategies) ? solPriceFromStrategies : null;
    }
    if (stableSymbols.has(sym)) return 1;

    const byMint = lendTokenPricesByMint.get(String(mint ?? ""));
    if (Number.isFinite(byMint) && byMint > 0) return byMint;

    const bySymbol = lendTokenPricesBySymbol.get(sym);
    if (Number.isFinite(bySymbol) && bySymbol > 0) return bySymbol;

    for (const st of strategyValuations) {
      if (sym === String(st?.tokenASymbol ?? "").toUpperCase() || mint === st?.tokenAMint) {
        const px = Number(st?.tokenAPriceUsd);
        if (Number.isFinite(px) && px > 0) return px;
      }
      if (sym === String(st?.tokenBSymbol ?? "").toUpperCase() || mint === st?.tokenBMint) {
        const px = Number(st?.tokenBPriceUsd);
        if (Number.isFinite(px) && px > 0) return px;
      }
    }
    return null;
  }

  const walletTokens = summary?.spot?.tokens ?? [];
  const knownSolSpotUsd = Number.isFinite(solPriceFromStrategies) ? Number(summary?.spot?.nativeSol || 0) * solPriceFromStrategies : 0;
  const knownSplSpotUsd = walletTokens.reduce((acc, t) => {
    const px = tokenPriceUsd(t?.symbol, t?.mint);
    return acc + (px == null ? 0 : Number(t?.amountUi || 0) * px);
  }, 0);
  const walletUsd = knownSolSpotUsd + knownSplSpotUsd;

  const claimableValueFromSummary = Number(summary?.kaminoLiquidity?.rewards?.claimableValueUsd ?? NaN);
  const claimableByPosition = summary?.kaminoLiquidity?.rewards?.claimableByPosition ?? [];
  const claimedRewards = summary?.kaminoLiquidity?.rewards?.claimedByPositionTypeSymbol ?? [];
  const strategyMap = new Map(strategyValuations.map((s) => [s.strategy, s]));
  const claimedPriceBySymbol = new Map(
    claimedRewards
      .filter((r) => Number(r.amountUi) > 0 && Number(r.amountUsd) > 0)
      .map((r) => [String(r.symbol ?? "").toUpperCase(), Number(r.amountUsd) / Number(r.amountUi)])
  );
  const estimatedClaimables = claimableByPosition.reduce((acc, row) => {
    const v = estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol);
    return acc + (Number.isFinite(Number(v)) ? Number(v) : 0);
  }, 0);
  const totalClaimables = Number.isFinite(claimableValueFromSummary) ? claimableValueFromSummary : estimatedClaimables;

  summaryCards.innerHTML = [
    { label: "Total Portfolio", value: fmtUsd(positionsTotalUsd + walletUsd) },
    { label: "Wallet Balance", value: fmtUsd(walletUsd) },
    { label: "Total Claimables", value: fmtUsd(totalClaimables) }
  ]
    .map((s) => `<article class="stat"><div class="label">${s.label}</div><div class="value">${s.value}</div></article>`)
    .join("");

  return { totalClaimables, walletUsd, claimableByPosition, strategyMap, claimedPriceBySymbol };
}

function renderDelta(summary, fullPositions) {
  const rows = computeHedgeRows(summary, fullPositions);
  const worstDrift = rows.reduce((acc, r) => (Number.isFinite(r.driftPct) ? Math.max(acc, Math.abs(r.driftPct)) : acc), 0);
  const dominant = rows.find((r) => Number.isFinite(r.driftPct) && Math.abs(r.driftPct) === worstDrift);
  const signal = dominant ? hedgeSignal(dominant.driftPct, dominant.hedgeRatio).label : "n/a";
  const deltaCapital = rows.reduce((acc, row) => acc + (Number.isFinite(row.lpValueUsd) ? row.lpValueUsd : 0), 0);

  deltaMeta.innerHTML = [
    { label: "Delta Capital", value: fmtUsd(deltaCapital) },
    { label: "Drift %", value: fmtPct(worstDrift) },
    { label: "Hedge Signal", value: signal }
  ]
    .map((s) => `<article class="stat"><div class="label">${s.label}</div><div class="value">${s.value}</div></article>`)
    .join("");

  driftPctLabel.textContent = fmtPct(worstDrift);
  const clamped = Math.min(20, Math.max(0, Number(worstDrift) || 0));
  driftNeedle.style.left = `${(clamped / 20) * 100}%`;

  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];
  liquidityTableWrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Pair</th><th>Value/TVL</th><th>Fees</th><th>Incentives</th><th>Net</th></tr></thead>
      <tbody>
        ${strategyValuations
          .map((row) => {
            const value = Number(row?.valueUsdFarmsStaked ?? row?.valueUsd ?? NaN);
            const net = Number(row?.pnlUsdFarmsStaked ?? row?.pnlUsd ?? NaN);
            return `<tr>
              <td>${row?.pairLabel ?? "n/a"}</td>
              <td>${fmtUsd(value)}</td>
              <td>${fmtUsd(row?.feesAccruedUsd)}</td>
              <td>${fmtUsd(row?.incentivesAccruedUsd)}</td>
              <td class="${net >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtSignedUsd(net)}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  const leverageElement = (fullPositions?.jupiterPerps?.data?.raw?.elements ?? []).find((e) => e?.type === "leverage");
  const perpsPositions = leverageElement?.data?.isolated?.positions ?? [];
  hedgeTableWrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Market</th><th>Side</th><th>Notional</th><th>PnL</th><th>Funding</th></tr></thead>
      <tbody>
        ${
          perpsPositions.length
            ? perpsPositions
                .map((p) => {
                  const pnl = Number(p?.pnlValue ?? NaN);
                  const funding = Number(p?.accruedFunding ?? p?.fundingPaid ?? NaN);
                  return `<tr>
                    <td>${inferPerpSymbol(String(p?.address || ""))}</td>
                    <td>${String(p?.side || "n/a")}</td>
                    <td>${fmtUsd(p?.sizeValue)}</td>
                    <td class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtSignedUsd(pnl)}</td>
                    <td>${fmtUsd(funding)}</td>
                  </tr>`;
                })
                .join("")
            : '<tr><td colspan="5" class="muted">No perps positions found.</td></tr>'
        }
      </tbody>
    </table>`;
}

function renderMultiply(summary) {
  const obligations = summary?.kaminoLend?.obligations ?? [];
  const multiplyRows = obligations.filter((ob) => String(ob?.market || "").toLowerCase().includes("multiply"));
  const focused = multiplyRows.filter((row) => {
    const pair = deriveLendPairLabel(row).toUpperCase();
    return pair.includes("ONYC/USDC") || pair.includes("ONYC/USDG");
  });
  const rows = focused.length ? focused : multiplyRows;

  multiplyTableWrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Market</th><th>Position Value</th><th>Borrowed</th><th>LTV</th><th>Liq Threshold</th><th>Buffer</th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map((o) => {
                  const ltv = Number(o?.ltvPct ?? o?.ltv ?? NaN);
                  const liq = Number(o?.liquidationThresholdPct ?? NaN);
                  const buffer = Number.isFinite(ltv) && Number.isFinite(liq) ? liq - ltv : NaN;
                  return `<tr>
                    <td>${deriveLendPairLabel(o)}</td>
                    <td>${fmtUsd(o?.netValueUsd)}</td>
                    <td>${fmtUsd(o?.borrowedUsd ?? o?.borrowValueUsd)}</td>
                    <td>${fmtPct(ltv)}</td>
                    <td>${fmtPct(liq)}</td>
                    <td class="${Number.isFinite(buffer) && buffer >= 0 ? "pnl-pos" : "pnl-neg"}">${fmtPct(buffer)}</td>
                  </tr>`;
                })
                .join("")
            : '<tr><td colspan="6" class="muted">No multiply positions found.</td></tr>'
        }
      </tbody>
    </table>`;
}

function renderRewardsAndWallet(summary, totals) {
  const claimables = totals.claimableByPosition ?? [];
  const lpClaimables = claimables
    .filter((r) => String(r.positionType || "").toLowerCase().includes("liquidity"))
    .reduce((acc, r) => {
      const v = estimateRewardValueUsd(r, totals.strategyMap, totals.claimedPriceBySymbol);
      return acc + (Number.isFinite(Number(v)) ? Number(v) : 0);
    }, 0);
  const multiplyClaimables = claimables
    .filter((r) => String(r.positionType || "").toLowerCase().includes("multiply") || String(r.positionType || "").toLowerCase().includes("lend"))
    .reduce((acc, r) => {
      const v = estimateRewardValueUsd(r, totals.strategyMap, totals.claimedPriceBySymbol);
      return acc + (Number.isFinite(Number(v)) ? Number(v) : 0);
    }, 0);

  rewardsSummary.innerHTML = [
    { label: "LP claimables", value: fmtUsd(lpClaimables) },
    { label: "Multiply claimables", value: fmtUsd(multiplyClaimables) },
    { label: "Total claimables", value: fmtUsd(totals.totalClaimables) },
    { label: "Wallet balance", value: fmtUsd(totals.walletUsd) }
  ]
    .map((s) => `<article class="stat"><div class="label">${s.label}</div><div class="value">${s.value}</div></article>`)
    .join("");
}

function renderAdvanced(summary, fullPositions) {
  const walletTokens = summary?.spot?.tokens ?? [];
  walletTokensWrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Token</th><th>Amount</th><th>Mint</th></tr></thead>
      <tbody>
      ${walletTokens.map((t) => `<tr><td>${t.symbol ?? "?"}</td><td>${fmtTokenAmount(t.amountUi)}</td><td class="mono">${t.mint ?? "n/a"}</td></tr>`).join("")}
      </tbody>
    </table>`;

  rawJson.textContent = JSON.stringify(summary, null, 2);
  rawFullJson.textContent = fullPositions ? JSON.stringify(fullPositions, null, 2) : "Full positions not loaded yet.";
}

function render(summary, fullPositions) {
  const totals = renderSummaryStrip(summary);
  renderDelta(summary, fullPositions);
  renderMultiply(summary);
  renderRewardsAndWallet(summary, totals);
  renderAdvanced(summary, fullPositions);
}

async function ensureFullPositionsLoaded() {
  const wallet = latestWallet || walletInput.value.trim();
  if (!wallet) return null;
  if (latestFullPositions && latestWallet === wallet) return latestFullPositions;
  if (fullPositionsLoadPromise) return fullPositionsLoadPromise;

  fullPositionsLoadPromise = (async () => {
    const fullRes = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=full`);
    if (!fullRes.ok) {
      const body = await fullRes.json().catch(() => ({}));
      throw new Error(body.error || `Full positions request failed (${fullRes.status})`);
    }
    const fullPositions = await fullRes.json();
    if (latestWallet === wallet) {
      latestFullPositions = fullPositions;
      if (latestSummary) render(latestSummary, latestFullPositions);
    }
    return fullPositions;
  })();

  try {
    return await fullPositionsLoadPromise;
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    fullPositionsLoadPromise = null;
  }
}

async function loadSummary() {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    statusEl.textContent = "Wallet required";
    return;
  }

  statusEl.textContent = "Loading...";
  loadBtn.disabled = true;
  const walletChanged = latestWallet !== wallet;
  latestWallet = wallet;
  latestSummary = null;
  if (walletChanged) {
    latestFullPositions = null;
    fullPositionsLoadPromise = null;
  }

  try {
    const summaryRes = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=summary`);
    if (!summaryRes.ok) {
      const body = await summaryRes.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${summaryRes.status})`);
    }
    const summary = await summaryRes.json();
    latestSummary = summary;
    render(summary, latestFullPositions);
    statusEl.textContent = "Loaded";
    updatedAt.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    void ensureFullPositionsLoaded();
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    loadBtn.disabled = false;
  }
}

function updateAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (autoRefresh.checked) refreshTimer = setInterval(loadSummary, 30_000);
}

loadBtn.addEventListener("click", loadSummary);
autoRefresh.addEventListener("change", updateAutoRefresh);
walletInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSummary();
});
betaEnabled.addEventListener("change", () => {});

loadSummary();
