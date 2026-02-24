const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const autoRefresh = document.getElementById("autoRefresh");
const betaEnabled = document.getElementById("betaEnabled");
const statusEl = document.getElementById("status");
const summaryCards = document.getElementById("summaryCards");
const walletTokensWrap = document.getElementById("walletTokensWrap");
const liqEndpointInfo = document.getElementById("liqEndpointInfo");
const pairsList = document.getElementById("pairsList");
const rewardsTableWrap = document.getElementById("rewardsTableWrap");
const rawJson = document.getElementById("rawJson");
const tabOverview = document.getElementById("tabOverview");
const tabHedge = document.getElementById("tabHedge");
const tabBeta = document.getElementById("tabBeta");
const overviewView = document.getElementById("overviewView");
const hedgeView = document.getElementById("hedgeView");
const betaView = document.getElementById("betaView");
const hedgeTableWrap = document.getElementById("hedgeTableWrap");
const hedgeQuickWrap = document.getElementById("hedgeQuickWrap");
const betaPair = document.getElementById("betaPair");
const betaBenchmark = document.getElementById("betaBenchmark");
const betaLookback = document.getElementById("betaLookback");
const betaRunBtn = document.getElementById("betaRunBtn");
const betaMetricsWrap = document.getElementById("betaMetricsWrap");
const betaRankingWrap = document.getElementById("betaRankingWrap");
const betaChartWrap = document.getElementById("betaChartWrap");

const DEFAULT_WALLET = "4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr";
walletInput.value = DEFAULT_WALLET;

let refreshTimer = null;
let currentTab = "overview";
let betaLastKey = "";
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
      beta,
      lpValueUsd,
      lpDeltaUsd: lpDelta.deltaUsd,
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
  if (tab === "beta" && !betaEnabled.checked) {
    tab = "overview";
  }
  currentTab = tab;
  const showOverview = tab === "overview";
  const showHedge = tab === "hedge";
  const showBeta = tab === "beta";
  overviewView.classList.toggle("hidden", !showOverview);
  hedgeView.classList.toggle("hidden", !showHedge);
  betaView.classList.toggle("hidden", !showBeta);
  tabOverview.classList.toggle("is-active", showOverview);
  tabHedge.classList.toggle("is-active", showHedge);
  tabBeta.classList.toggle("is-active", showBeta);

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

function updateBetaLabEnabled() {
  const enabled = Boolean(betaEnabled.checked);
  tabBeta.classList.toggle("hidden", !enabled);
  if (!enabled && currentTab === "beta") {
    setTab("overview");
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

function renderBetaChart(series, assetLabel, benchmarkLabel) {
  if (!Array.isArray(series) || series.length < 2) {
    betaChartWrap.innerHTML = `<div class="rewards-empty">Not enough chart points.</div>`;
    return;
  }
  const width = 940;
  const height = 280;
  const pad = 24;
  const minY = Math.min(...series.flatMap((p) => [Number(p.asset), Number(p.benchmark)]));
  const maxY = Math.max(...series.flatMap((p) => [Number(p.asset), Number(p.benchmark)]));
  const ySpan = Math.max(0.0001, maxY - minY);
  const xScale = (idx) => pad + (idx / (series.length - 1)) * (width - pad * 2);
  const yScale = (v) => height - pad - ((v - minY) / ySpan) * (height - pad * 2);
  const lineA = series.map((p, i) => `${xScale(i)},${yScale(Number(p.asset))}`).join(" ");
  const lineB = series.map((p, i) => `${xScale(i)},${yScale(Number(p.benchmark))}`).join(" ");

  betaChartWrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Beta normalized price chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#0f1420"></rect>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#243147" />
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#243147" />
      <polyline points="${lineA}" fill="none" stroke="#53e6b4" stroke-width="2.2" />
      <polyline points="${lineB}" fill="none" stroke="#66b3ff" stroke-width="2.2" />
      <text x="${pad + 8}" y="${pad + 14}" fill="#53e6b4" font-size="12">${assetLabel} (index=100)</text>
      <text x="${pad + 8}" y="${pad + 30}" fill="#66b3ff" font-size="12">${benchmarkLabel} (index=100)</text>
      <text x="${width - 110}" y="${pad + 14}" fill="#94a0b5" font-size="12">min ${minY.toFixed(1)}</text>
      <text x="${width - 110}" y="${pad + 30}" fill="#94a0b5" font-size="12">max ${maxY.toFixed(1)}</text>
    </svg>
  `;
}

function renderBetaPriceTable(chartRows, assetLabel, benchmarkLabel) {
  if (!Array.isArray(chartRows) || chartRows.length === 0) return "";
  return `
    <h4 class="table-subhead" style="margin-top:10px;">Chart Data Points</h4>
    <table class="rewards-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>${assetLabel} Price</th>
          <th>${benchmarkLabel} Price</th>
          <th>${assetLabel} Index</th>
          <th>${benchmarkLabel} Index</th>
        </tr>
      </thead>
      <tbody>
        ${chartRows
          .map(
            (r) => `
          <tr>
            <td>${fmtDateTime(r.t)}</td>
            <td>${Number.isFinite(Number(r.assetPrice)) ? Number(r.assetPrice).toFixed(6) : "n/a"}</td>
            <td>${Number.isFinite(Number(r.benchmarkPrice)) ? Number(r.benchmarkPrice).toFixed(6) : "n/a"}</td>
            <td>${Number.isFinite(Number(r.assetIndex)) ? Number(r.assetIndex).toFixed(2) : "n/a"}</td>
            <td>${Number.isFinite(Number(r.benchmarkIndex)) ? Number(r.benchmarkIndex).toFixed(2) : "n/a"}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
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

function stddev(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return NaN;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const varp = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(varp);
}

async function fetchBetaPoint(wallet, pair, benchmark, lookbackDays) {
  const qs = new URLSearchParams({
    wallet,
    lpPair: pair,
    benchmark,
    lookbackDays: String(lookbackDays)
  });
  const res = await fetch(`/api/hedge-beta?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Beta request failed (${res.status})`);
  }
  return res.json();
}

async function fetchBetaPointWithRetry(wallet, pair, benchmark, lookbackDays, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetchBetaPoint(wallet, pair, benchmark, lookbackDays);
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "unknown beta fetch error"));
}

async function loadBetaRanking(wallet, pair) {
  const benchmarks = ["WBTC", "SOL", "ETH"];
  betaRankingWrap.innerHTML = `<div class="rewards-empty">Ranking benchmarks...</div>`;

  function statsFromReturns(allReturns, lookbackDays) {
    if (!Array.isArray(allReturns) || allReturns.length === 0) return { beta: NaN, corr: NaN, r2: NaN };
    const maxT = Math.max(...allReturns.map((r) => Number(r.t)));
    const cutoff = maxT - lookbackDays * 24 * 60 * 60 * 1000;
    const returns = allReturns.filter((r) => Number(r.t) >= cutoff);
    const minPoints = lookbackDays <= 7 ? 4 : 10;
    if (returns.length < minPoints) return { beta: NaN, corr: NaN, r2: NaN };
    const n = returns.length;
    const meanX = returns.reduce((acc, r) => acc + Number(r.benchmarkRet || 0), 0) / n;
    const meanY = returns.reduce((acc, r) => acc + Number(r.assetRet || 0), 0) / n;
    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (const r of returns) {
      const dx = Number(r.benchmarkRet || 0) - meanX;
      const dy = Number(r.assetRet || 0) - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    cov /= Math.max(1, n - 1);
    varX /= Math.max(1, n - 1);
    varY /= Math.max(1, n - 1);
    const beta = varX > 0 ? cov / varX : NaN;
    const corr = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : NaN;
    return { beta, corr, r2: Number.isFinite(corr) ? corr * corr : NaN };
  }

  const rows = await Promise.all(
    benchmarks.map(async (bm) => {
      let point = null;
      try {
        point = await fetchBetaPointWithRetry(wallet, pair, bm, 90, 3);
      } catch {
        point = null;
      }
      const returns = point?.returns ?? [];
      const s7 = statsFromReturns(returns, 7);
      const s30 = statsFromReturns(returns, 30);
      const s90 = statsFromReturns(returns, 90);
      const b7 = Number(s7.beta ?? NaN);
      const b30 = Number(s30.beta ?? NaN);
      const b90 = Number(s90.beta ?? NaN);
      const r230 = Number(s30.r2 ?? NaN);
      const c30 = Number(s30.corr ?? NaN);
      const betaStability = stddev([b7, b30, b90]);
      const score =
        Number.isFinite(r230) && Number.isFinite(c30) && Number.isFinite(betaStability)
          ? (Math.max(0, c30) * Math.max(0, r230)) / (1 + betaStability)
          : NaN;
      return { benchmark: bm, b7, b30, b90, r230, c30, betaStability, score };
    })
  );

  const sorted = rows.sort((a, b) => {
    const as = Number.isFinite(a.score) ? a.score : -Infinity;
    const bs = Number.isFinite(b.score) ? b.score : -Infinity;
    return bs - as;
  });
  const best = sorted.find((r) => Number.isFinite(r.score));

  betaRankingWrap.innerHTML = `
    <h4 class="table-subhead">Benchmark Ranking (7d/30d/90d)</h4>
    <table class="summary-table">
      <thead>
        <tr>
          <th>Benchmark</th>
          <th>Beta 7d</th>
          <th>Beta 30d</th>
          <th>Beta 90d</th>
          <th>Beta Stability (stdev)</th>
          <th>Corr 30d</th>
          <th>R^2 30d</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map((r) => {
            const isBest = best && r.benchmark === best.benchmark;
            return `
              <tr${isBest ? ' class="total-row"' : ""}>
                <td>${r.benchmark}${isBest ? " (best)" : ""}</td>
                <td>${Number.isFinite(r.b7) ? r.b7.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.b30) ? r.b30.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.b90) ? r.b90.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.betaStability) ? r.betaStability.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.c30) ? r.c30.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.r230) ? r.r230.toFixed(3) : "n/a"}</td>
                <td>${Number.isFinite(r.score) ? r.score.toFixed(4) : "n/a"}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <p class="table-note">Higher score is better for hedge benchmark selection: strong positive correlation + higher R^2 + steadier beta across windows.</p>
  `;
}

async function loadBeta() {
  const wallet = walletInput.value.trim();
  if (!wallet) return;
  const cacheKey = `${wallet}|${betaPair.value}|${betaBenchmark.value}|${betaLookback.value}`;
  if (cacheKey === betaLastKey && currentTab === "beta") return;

  betaMetricsWrap.innerHTML = `<div class="rewards-empty">Calculating beta...</div>`;
  betaRankingWrap.innerHTML = `<div class="rewards-empty">Ranking benchmarks...</div>`;
  betaChartWrap.innerHTML = "";
  try {
    const qs = new URLSearchParams({
      wallet,
      lpPair: String(betaPair.value || "NX8-USDC"),
      benchmark: String(betaBenchmark.value || "WBTC"),
      lookbackDays: String(betaLookback.value || "30")
    });
    const res = await fetch(`/api/hedge-beta?${qs.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Beta request failed (${res.status})`);
    }
    const data = await res.json();
    betaMetricsWrap.innerHTML = `
      <table class="summary-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Benchmark</th>
            <th>Beta</th>
            <th>R^2</th>
            <th>Correlation</th>
            <th>Alpha (per step)</th>
            <th>Samples</th>
            <th>Asset Source</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${data.pair}</td>
            <td>${data.benchmarkSymbol} (${data.benchmarkSource})</td>
            <td>${Number.isFinite(Number(data.beta)) ? Number(data.beta).toFixed(3) : "n/a"}</td>
            <td>${Number.isFinite(Number(data.r2)) ? Number(data.r2).toFixed(3) : "n/a"}</td>
            <td>${Number.isFinite(Number(data.correlation)) ? Number(data.correlation).toFixed(3) : "n/a"}</td>
            <td>${Number.isFinite(Number(data.alpha)) ? Number(data.alpha).toFixed(6) : "n/a"}</td>
            <td>${data.sampleCount ?? "n/a"}</td>
            <td>${data.baseAssetSource ?? "kamino:pnl-history"}</td>
          </tr>
        </tbody>
      </table>
      <p class="table-note">Interpretation: beta near 1.0 means 1:1 sensitivity to benchmark; above 1.0 is more volatile than benchmark; below 1.0 is less sensitive.</p>
    `;
    renderBetaChart(data.series ?? [], data.baseAssetSymbol ?? "Asset", data.benchmarkSymbol ?? "Benchmark");
    betaChartWrap.innerHTML += renderBetaPriceTable(data.chartRows ?? [], data.baseAssetSymbol ?? "Asset", data.benchmarkSymbol ?? "Benchmark");
    await loadBetaRanking(wallet, String(betaPair.value || "NX8-USDC"));
    betaLastKey = cacheKey;
  } catch (err) {
    betaMetricsWrap.innerHTML = `<div class="rewards-empty">${err instanceof Error ? err.message : String(err)}</div>`;
    betaRankingWrap.innerHTML = "";
  }
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
  const claimableValueUsd = Number(summary?.kaminoLiquidity?.rewards?.claimableValueUsd ?? 0);
  const positionsTotalUsd = perpsValueUsd + lendValueUsd + liqFarmsValueUsd;
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
          <td>Kamino Liquidity (farms-staked)</td>
          <td>${fmtUsd(liqFarmsValueUsd)}</td>
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
        <summary>Kamino Liquidity / Farming <span>${fmtUsd(liqFarmsValueUsd)}</span></summary>
        <div class="rewards-wrap">
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

  liqEndpointInfo.textContent = `Endpoint valuation: ${fmtUsd(summary?.kaminoLiquidity?.valueUsd)} | PnL: ${fmtUsd(liqPnl)}`;

  const pairs = summary?.kaminoLiquidity?.strategyPairs ?? [];
  pairsList.innerHTML = pairs.length
    ? pairs
        .map(
          (p) => `
        <div class="pair-item">
          <span class="pair-tag">${p.pair}</span>
          <span class="pair-id">${p.strategy}</span>
        </div>
      `
        )
        .join("")
    : `<div class="pair-item"><span>No liquidity pairs found.</span></div>`;

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

  const claimableByPosition = summary?.kaminoLiquidity?.rewards?.claimableByPosition ?? [];
  const claimedRewards = summary?.kaminoLiquidity?.rewards?.claimed ?? [];
  const claimedRewardsTypedRows = summary?.kaminoLiquidity?.rewards?.claimedByPositionTypeSymbol ?? [];
  const lendObligationRows = summary?.kaminoLend?.obligations ?? [];
  function obligationCellForToken(symbol) {
    const obs = obligationByBorrowToken.get(String(symbol ?? "").toUpperCase()) ?? [];
    if (!obs.length) return "-";
    return obs
      .map((ob) => `<a href="https://solscan.io/account/${ob}" target="_blank" rel="noopener noreferrer">${shortPk(ob)}</a>`)
      .join(", ");
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
          const v = estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol);
          return acc + (Number.isFinite(Number(v)) ? Number(v) : 0);
        }, 0);
        const claimedTotalUsd = claimedRewards.reduce((acc, row) => acc + (Number.isFinite(Number(row.amountUsd)) ? Number(row.amountUsd) : 0), 0);
        return `
      <h4 class="table-subhead">Claimable</h4>
      <table class="rewards-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Amount</th>
            <th>Value</th>
            <th>Position</th>
            <th>Position Type</th>
            <th>Mint</th>
            <th>Obligation</th>
          </tr>
        </thead>
        <tbody>
          ${claimableByPosition
            .map((row) => {
              const valueUsd = estimateRewardValueUsd(row, strategyMap, claimedPriceBySymbol);
              return `
                <tr>
                  <td>${row.symbol}</td>
                  <td>${fmtTokenAmount(row.amountUi)}</td>
                  <td>${fmtUsd(valueUsd)}</td>
                  <td>${row.position}</td>
                  <td>${row.positionType}</td>
                  <td>${row.mint}</td>
                  <td>${row.positionType === "Lend" || row.positionType === "Multiply" ? obligationCellForToken(row.symbol) : "-"}</td>
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
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <h4 class="table-subhead" style="margin-top:14px;">Claimed</h4>
      <table class="rewards-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Amount</th>
            <th>Value</th>
            <th>Position</th>
            <th>Position Type</th>
            <th>Mint</th>
            <th>Obligation</th>
          </tr>
        </thead>
        <tbody>
          ${
            claimedRewardsTypedRows.length
              ? claimedRewardsTypedRows
                  .map(
                    (row) => `
                <tr>
                  <td>${row.symbol}</td>
                  <td>${fmtTokenAmount(row.amountUi)}</td>
                  <td>${fmtUsd(row.amountUsd)}</td>
                  <td>${row.position ?? "-"}</td>
                  <td>${row.positionType ?? "-"}</td>
                  <td>${row.mint ?? "-"}</td>
                  <td>${row.positionType === "Lend" || row.positionType === "Multiply" || row.positionType === "Lend/Multiply" ? obligationCellForToken(row.symbol) : "-"}</td>
                </tr>
              `
                  )
                  .join("")
              : `
                <tr>
                  <td colspan="7" class="rewards-empty">No claimed rewards found.</td>
                </tr>
              `
          }
          <tr class="total-row">
            <td></td>
            <td></td>
            <td>${fmtUsd(claimedTotalUsd)}</td>
            <td></td>
            <td></td>
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
    const summaryRes = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}&mode=summary`);
    if (!summaryRes.ok) {
      const body = await summaryRes.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${summaryRes.status})`);
    }
    const summary = await summaryRes.json();
    latestSummary = summary;

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

function updateAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (autoRefresh.checked) {
    refreshTimer = setInterval(loadSummary, 30_000);
  }
}

loadBtn.addEventListener("click", loadSummary);
autoRefresh.addEventListener("change", updateAutoRefresh);
walletInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSummary();
});
tabOverview.addEventListener("click", () => setTab("overview"));
tabHedge.addEventListener("click", () => setTab("hedge"));
tabBeta.addEventListener("click", async () => {
  setTab("beta");
  betaLastKey = "";
  await loadBeta();
});
betaRunBtn.addEventListener("click", async () => {
  betaLastKey = "";
  await loadBeta();
});
betaEnabled.addEventListener("change", updateBetaLabEnabled);

betaEnabled.checked = false;
updateBetaLabEnabled();
setTab(currentTab);
loadSummary();
