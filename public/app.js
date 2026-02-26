const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const operatorModeToggle = document.getElementById("operatorModeToggle");
const statusEl = document.getElementById("status");
const summaryCards = document.getElementById("summaryCards");
const walletTokensWrap = document.getElementById("walletTokensWrap");
const rewardsTableWrap = document.getElementById("rewardsTableWrap");
const rawJson = document.getElementById("rawJson");
const tabOverview = document.getElementById("tabOverview");
const tabHedge = document.getElementById("tabHedge");
const overviewView = document.getElementById("overviewView");
const hedgeView = document.getElementById("hedgeView");
const hedgeTableWrap = document.getElementById("hedgeTableWrap");
const hedgeQuickWrap = document.getElementById("hedgeQuickWrap");
const tabsWrap = document.querySelector(".tabs");
const hedgeQuickCard = document.querySelector(".hedge-quick-card");
const walletTokensCard = walletTokensWrap?.closest("section.card");
const rewardsCard = rewardsTableWrap?.closest("section.card");
const rawSummaryCard = rawJson?.closest("section.card");

const OPERATOR_MODE_KEY = "operatorModeEnabled";

const DEFAULT_WALLET = "4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr";
walletInput.value = DEFAULT_WALLET;

let currentTab = "overview";
let latestWallet = "";
let latestSummary = null;
let latestFullPositions = null;
let latestPortfolioSystems = null;
let fullPositionsLoadPromise = null;
let operatorModeEnabled = false;

const HEDGE_LINKS = [
  { strategyLabel: "NX8-USDC vs WBTC Short", lpPair: "NX8-USDC", perpSymbol: "WBTC" },
  { strategyLabel: "SOL-USDG vs SOL Short", lpPair: "SOL-USDG", perpSymbol: "SOL" }
];
const BETA_OVERRIDES = {
  "NX8-USDC vs WBTC Short": 1.0,
  "SOL-USDG vs SOL Short": 1.0
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

function hedgeSignal(driftPct, hedgeRatio) {
  if (!Number.isFinite(driftPct) || !Number.isFinite(hedgeRatio)) {
    return { label: "n/a", className: "" };
  }
  const absDrift = Math.abs(driftPct);
  const ratioOff = Math.abs(1 - hedgeRatio);
  if (absDrift <= 10 && ratioOff <= 0.1) return { label: "OK", className: "pnl-pos" };
  if (absDrift <= 20 && ratioOff <= 0.2) return { label: "Watch", className: "pnl-warn" };
  return { label: "Rebalance", className: "pnl-neg" };
}

function hedgeActionText(adjustmentUsd, signalLabel) {
  if (!Number.isFinite(adjustmentUsd)) return "n/a";
  if (signalLabel === "OK") return "No change";
  if (signalLabel === "Watch") {
    if (Math.abs(adjustmentUsd) < 10) return "Optional rebalance";
    return adjustmentUsd < 0 ? `Watch: increase short ${fmtUsd(Math.abs(adjustmentUsd))}` : `Watch: decrease short ${fmtUsd(Math.abs(adjustmentUsd))}`;
  }
  if (Math.abs(adjustmentUsd) < 10) return "Rebalance (small)";
  if (adjustmentUsd < 0) return `Increase short by ${fmtUsd(Math.abs(adjustmentUsd))}`;
  return `Decrease short by ${fmtUsd(Math.abs(adjustmentUsd))}`;
}

function computeHedgeRows(summary, fullPositions) {
  const strategyValuations = summary?.kaminoLiquidity?.strategyValuations ?? [];
  const valuationByPair = new Map(strategyValuations.map((v) => [String(v?.pairLabel || "").toUpperCase(), v]));
  const orcaPositions = summary?.orcaWhirlpools?.positions ?? [];
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

  function estimateOrcaVolatileDeltaUsd(position) {
    const a = String(position?.tokenA || "").toUpperCase();
    const b = String(position?.tokenB || "").toUpperCase();
    const stable = new Set(["USDC", "USDG", "USDS", "USDT", "AUSD"]);
    const amountA = Number(position?.amountAEstUi ?? NaN);
    const amountB = Number(position?.amountBEstUi ?? NaN);
    const priceBPerA = Number(position?.currentPriceOrcaApi ?? position?.currentPrice ?? NaN);
    const valueUsd = Number(position?.valueEstUsd ?? NaN);

    if (stable.has(a) && !stable.has(b)) {
      if (Number.isFinite(amountB) && Number.isFinite(priceBPerA) && priceBPerA > 0) {
        return { token: b, deltaUsd: amountB / priceBPerA, method: "orca-exact" };
      }
      return { token: b, deltaUsd: Number.isFinite(valueUsd) ? valueUsd * 0.5 : NaN, method: "orca-fallback-50" };
    }

    if (stable.has(b) && !stable.has(a)) {
      if (Number.isFinite(amountA) && Number.isFinite(priceBPerA) && priceBPerA > 0) {
        return { token: a, deltaUsd: amountA * priceBPerA, method: "orca-exact" };
      }
      return { token: a, deltaUsd: Number.isFinite(valueUsd) ? valueUsd * 0.5 : NaN, method: "orca-fallback-50" };
    }

    return { token: a || b || "unknown", deltaUsd: Number.isFinite(valueUsd) ? valueUsd * 0.5 : NaN, method: "orca-fallback-50" };
  }

  const orcaExposureByToken = new Map();
  for (const p of orcaPositions) {
    const est = estimateOrcaVolatileDeltaUsd(p);
    const token = String(est.token || "").toUpperCase();
    if (!token || !Number.isFinite(est.deltaUsd)) continue;
    const prev = orcaExposureByToken.get(token) ?? { deltaUsd: 0, valueUsd: 0, rows: [] };
    prev.deltaUsd += est.deltaUsd;
    prev.valueUsd += Number.isFinite(Number(p?.valueEstUsd)) ? Number(p.valueEstUsd) : 0;
    prev.rows.push({
      pair: String(p?.pair || "unknown"),
      valueUsd: Number(p?.valueEstUsd ?? NaN),
      deltaUsd: est.deltaUsd,
      method: est.method
    });
    orcaExposureByToken.set(token, prev);
  }

  return HEDGE_LINKS.map((link) => {
    const valuation = valuationByPair.get(link.lpPair.toUpperCase());
    const lpValueUsd = Number(valuation?.valueUsdFarmsStaked ?? valuation?.valueUsd ?? NaN);
    const lpDelta = valuation ? estimateLpVolatileDeltaUsd(valuation) : { token: "n/a", deltaUsd: NaN };
    const orcaExposure = orcaExposureByToken.get(String(link.perpSymbol || "").toUpperCase()) ?? null;
    const orcaDeltaUsd = orcaExposure ? Number(orcaExposure.deltaUsd ?? NaN) : NaN;
    const orcaValueUsd = orcaExposure ? Number(orcaExposure.valueUsd ?? NaN) : NaN;
    const combinedLpValueUsd =
      (Number.isFinite(lpValueUsd) ? lpValueUsd : 0) + (Number.isFinite(orcaValueUsd) ? orcaValueUsd : 0);
    const combinedLpDeltaUsd =
      (Number.isFinite(lpDelta.deltaUsd) ? lpDelta.deltaUsd : 0) + (Number.isFinite(orcaDeltaUsd) ? orcaDeltaUsd : 0);
    const beta = Number(BETA_OVERRIDES[link.strategyLabel] ?? 1);
    const betaAdjustedLpDeltaUsd = Number.isFinite(combinedLpDeltaUsd) ? combinedLpDeltaUsd * beta : NaN;
    const perp = perpsBySymbol.get(link.perpSymbol) ?? { notionalUsd: NaN, deltaUsd: NaN, side: "n/a" };
    const targetPerpDeltaUsd = Number.isFinite(betaAdjustedLpDeltaUsd) ? -betaAdjustedLpDeltaUsd : NaN;
    const adjustmentUsd = Number.isFinite(targetPerpDeltaUsd) && Number.isFinite(perp.deltaUsd) ? targetPerpDeltaUsd - perp.deltaUsd : NaN;
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
      lpToken: lpDelta.token,
      lpDeltaMethod: lpDelta.method,
      orcaValueUsd,
      orcaDeltaUsd,
      orcaExposureRows: orcaExposure?.rows ?? [],
      beta,
      lpValueUsd: Number.isFinite(combinedLpValueUsd) ? combinedLpValueUsd : lpValueUsd,
      lpDeltaUsd: Number.isFinite(combinedLpDeltaUsd) ? combinedLpDeltaUsd : lpDelta.deltaUsd,
      betaAdjustedLpDeltaUsd,
      perpSide: perp.side,
      perpNotionalUsd: perp.notionalUsd,
      perpDeltaUsd: perp.deltaUsd,
      targetPerpDeltaUsd,
      adjustmentUsd,
      netDeltaUsd,
      hedgeRatio,
      driftPct
    };
  });
}

function renderHedgeQuick(summary, fullPositions) {
  if (!hedgeQuickWrap) return;
  const rows = computeHedgeRows(summary, fullPositions);
  if (!rows.length) {
    hedgeQuickWrap.innerHTML = `<div class="rewards-empty">No hedge strategies found.</div>`;
    return;
  }
  hedgeQuickWrap.innerHTML = `
    <table class="summary-table hedge-quick-table">
      <thead>
        <tr>
          <th>Strategy</th>
          <th>Drift</th>
          <th>Rebalance Signal</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const signal = hedgeSignal(row.driftPct, row.hedgeRatio);
            const driftClass = Number.isFinite(row.driftPct) ? (Math.abs(row.driftPct) <= 10 ? "pnl-pos" : "pnl-neg") : "";
            return `
              <tr>
                <td>${row.strategyLabel}</td>
                <td class="${driftClass}">${fmtPct(row.driftPct)}</td>
                <td class="${signal.className}">${signal.label}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function setTab(tab) {
  currentTab = tab;
  const showOverview = tab === "overview";
  const showHedge = tab === "hedge";
  overviewView.classList.toggle("hidden", !showOverview);
  hedgeView.classList.toggle("hidden", !showHedge);
  tabOverview.classList.toggle("is-active", showOverview);
  tabHedge.classList.toggle("is-active", showHedge);

  if (showHedge) {
    void ensureFullPositionsLoaded();
  }
}

async function ensureFullPositionsLoaded() {
  const wallet = latestWallet || walletInput.value.trim();
  if (!wallet) return null;
  if (latestFullPositions && latestWallet === wallet) {
    return latestFullPositions;
  }
  if (fullPositionsLoadPromise) {
    return fullPositionsLoadPromise;
  }

  fullPositionsLoadPromise = (async () => {
    const fullRes = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=full`);
    if (!fullRes.ok) {
      const body = await fullRes.json().catch(() => ({}));
      throw new Error(body.error || `Full positions request failed (${fullRes.status})`);
    }
    const fullPositions = await fullRes.json();
    if (latestWallet === wallet) {
      latestFullPositions = fullPositions;
      if (latestSummary) {
        render(latestSummary, latestFullPositions);
      }
    }
    return fullPositions;
  })();

  try {
    return await fullPositionsLoadPromise;
  } catch (err) {
    if (currentTab === "hedge") {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
    }
    return null;
  } finally {
    fullPositionsLoadPromise = null;
  }
}

function applyOperatorMode() {
  setHidden(tabsWrap, operatorModeEnabled);
  setHidden(hedgeQuickCard, operatorModeEnabled);
  setHidden(walletTokensCard, operatorModeEnabled);
  setHidden(rewardsCard, operatorModeEnabled);
  setHidden(rawSummaryCard, operatorModeEnabled);
  setHidden(tabHedge, operatorModeEnabled);

  if (operatorModeEnabled) {
    setTab("overview");
    setHidden(hedgeView, true);
  }
}

function renderSolSystemCard(system) {
  if (!system) {
    return `<section class="card"><h2>SOL System Console</h2><div class="rewards-empty">SOL system snapshot unavailable.</div></section>`;
  }

  const health = Number(system.healthScore);
  const scoreClass = Number.isFinite(health) ? (health >= 80 ? "pnl-pos" : health >= 60 ? "pnl-warn" : "pnl-neg") : "";
  const hedgePct = Number(system.hedgeCoveragePct);
  const liqPct = Number(system.liqBufferPct);
  const rangePct = Number(system.rangeBufferPct);

  return `
    <section class="card">
      <div class="section-head">
        <h2>SOL System Console</h2>
        <span class="section-subtle">Aggregated hedge health</span>
      </div>
      <div class="stat">
        <h3>Health Score</h3>
        <p class="${scoreClass}" style="font-size:1.8rem;">${Number.isFinite(health) ? health.toFixed(0) : "n/a"}</p>
      </div>
      <table class="summary-table" style="margin-top:12px;">
        <tbody>
          <tr><td>Net SOL</td><td>${fmtTokenAmount(system.netSol)}</td></tr>
          <tr><td>Hedge %</td><td>${Number.isFinite(hedgePct) ? `${(hedgePct * 100).toFixed(2)}%` : "n/a"}</td></tr>
          <tr><td>Liq buffer %</td><td>${Number.isFinite(liqPct) ? `${(liqPct * 100).toFixed(2)}%` : "n/a"}</td></tr>
          <tr><td>Range buffer %</td><td>${Number.isFinite(rangePct) ? `${(rangePct * 100).toFixed(2)}%` : "n/a"}</td></tr>
          <tr><td>Recommended Action</td><td>${system.action ?? "No action"}</td></tr>
        </tbody>
      </table>
    </section>
  `;
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

function renderHedge(summary, fullPositions) {
  const rows = computeHedgeRows(summary, fullPositions);

  hedgeTableWrap.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Strategy</th>
          <th>LP Value</th>
          <th>Beta</th>
          <th>Beta-Adj LP Delta</th>
          <th>Perp Leg</th>
          <th>Perp Delta</th>
          <th>Target Perp</th>
          <th>Rebalance Needed</th>
          <th>Net Delta</th>
          <th>Drift</th>
          <th>Rebalance Signal</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const driftClass = Number.isFinite(row.driftPct) ? (Math.abs(row.driftPct) <= 10 ? "pnl-pos" : "pnl-neg") : "";
            const netClass = Number.isFinite(row.netDeltaUsd) ? (row.netDeltaUsd >= 0 ? "pnl-neg" : "pnl-pos") : "";
            const signal = hedgeSignal(row.driftPct, row.hedgeRatio);
            return `
              <tr>
                <td>${row.strategyLabel}</td>
                <td>${fmtUsd(row.lpValueUsd)}</td>
                <td>${Number.isFinite(row.beta) ? row.beta.toFixed(2) : "n/a"}x</td>
                <td>${fmtUsd(row.betaAdjustedLpDeltaUsd)} (${row.lpToken}${row.lpDeltaMethod === "fallback-50" ? ", est." : ""})</td>
                <td>${row.perpSymbol} ${row.perpSide || ""} (${fmtUsd(row.perpNotionalUsd)})</td>
                <td>${fmtUsd(row.perpDeltaUsd)}</td>
                <td>${fmtUsd(row.targetPerpDeltaUsd)}</td>
                <td>${hedgeActionText(row.adjustmentUsd, signal.label)}</td>
                <td class="${netClass}">${fmtUsd(row.netDeltaUsd)}</td>
                <td class="${driftClass}">${fmtPct(row.driftPct)} | ratio ${Number.isFinite(row.hedgeRatio) ? row.hedgeRatio.toFixed(2) : "n/a"}x</td>
                <td class="${signal.className}">${signal.label}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <div class="table-note">
      <div>How to rebalance:</div>
      <div>1. Set beta per strategy in <code>BETA_OVERRIDES</code> (use <code>1.0</code> if unsure).</div>
      <div>2. Use <code>Target Perp</code> as your desired perp delta, and <code>Rebalance Needed</code> for the trade size.</div>
      <div>3. Aim for hedge ratio near <code>1.00x</code> and drift near <code>0%</code>; above ~20% drift usually warrants a rebalance.</div>
      <div>LP delta uses exact non-stable leg USD from Kamino share holdings when available; 50% is only a fallback.</div>
    </div>
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

function render(summary, fullPositions) {
  renderHedgeQuick(summary, fullPositions);
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

  if (operatorModeEnabled) {
    summaryCards.innerHTML = `${renderSolSystemCard(summary?.solSystem)}`;
    applyOperatorMode();
    return;
  }

  summaryCards.innerHTML = `
    ${renderSolSystemCard(summary?.solSystem)}
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

  rawJson.textContent = JSON.stringify(summary, null, 2);
  renderHedge(summary, fullPositions);
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
    const [summaryRes, portfolioRes] = await Promise.all([
      fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=summary`),
      fetch(`/data/portfolio/systems_index.json`).catch(() => null)
    ]);
    if (!summaryRes.ok) {
      const body = await summaryRes.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${summaryRes.status})`);
    }
    const summary = await summaryRes.json();
    latestSummary = summary;

    if (portfolioRes && portfolioRes.ok) {
      latestPortfolioSystems = await portfolioRes.json().catch(() => null);
    }

    render(summary, latestFullPositions);
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    if (currentTab === "hedge") {
      await ensureFullPositionsLoaded();
    } else {
      void ensureFullPositionsLoaded();
    }
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener("click", loadSummary);
walletInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSummary();
});
tabOverview.addEventListener("click", () => setTab("overview"));
tabHedge.addEventListener("click", () => setTab("hedge"));
operatorModeToggle?.addEventListener("change", () => {
  operatorModeEnabled = Boolean(operatorModeToggle.checked);
  persistOperatorModeState(operatorModeEnabled);
  applyOperatorMode();
  if (latestSummary) render(latestSummary, latestFullPositions);
});
operatorModeEnabled = loadOperatorModeState();
if (operatorModeToggle) operatorModeToggle.checked = operatorModeEnabled;
applyOperatorMode();
setTab(currentTab);
loadSummary();
