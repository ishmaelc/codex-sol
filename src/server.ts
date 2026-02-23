import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { buildSummary, fetchWalletPositions } from "./index.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const positionsCacheTtlMs = Math.max(0, Number(process.env.POSITIONS_CACHE_TTL_MS ?? 15000));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const positionsCache = new Map<string, { ts: number; payload: unknown }>();

app.use(express.json());
app.use(
  express.static(publicDir, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  })
);

type PricePoint = { t: number; p: number };

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function interpolatePriceAt(t: number, series: PricePoint[]): number | null {
  if (series.length === 0) return null;
  if (t <= series[0].t) return series[0].p;
  if (t >= series[series.length - 1].t) return series[series.length - 1].p;
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = series[lo];
  const b = series[hi];
  const span = b.t - a.t;
  if (span <= 0) return a.p;
  const w = (t - a.t) / span;
  return a.p + (b.p - a.p) * w;
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}

async function fetchCoinGeckoSeries(cgId: string, fromSec: number, toSec: number): Promise<PricePoint[]> {
  const cgUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
  const cgRes = await fetch(cgUrl);
  if (!cgRes.ok) {
    const body = await cgRes.text().catch(() => "");
    throw new Error(`coingecko:${cgRes.status}:${body.slice(0, 300)}`);
  }
  const cgPayload = (await cgRes.json()) as { prices?: Array<[number, number]> };
  return (Array.isArray(cgPayload.prices) ? cgPayload.prices : [])
    .map((x) => ({ t: Number(x[0]), p: Number(x[1]) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.t - b.t);
}

async function fetchCoinGeckoContractSeries(mint: string, fromSec: number, toSec: number): Promise<PricePoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/solana/contract/${encodeURIComponent(
    mint
  )}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko-contract:${res.status}:${body.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { prices?: Array<[number, number]> };
  return (Array.isArray(payload.prices) ? payload.prices : [])
    .map((x) => ({ t: Number(x[0]), p: Number(x[1]) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.t - b.t);
}

async function fetchCoinbaseSeries(benchmark: string, fromMs: number, toMs: number): Promise<PricePoint[]> {
  const productMap: Record<string, string> = {
    WBTC: "BTC-USD",
    BTC: "BTC-USD",
    SOL: "SOL-USD",
    ETH: "ETH-USD"
  };
  const product = productMap[benchmark];
  if (!product) return [];
  const start = new Date(fromMs).toISOString();
  const end = new Date(toMs).toISOString();
  // Daily candles keep requests small and avoid pagination/rate issues.
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=86400&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ t: Number(r[0]) * 1000, p: Number(r[4]) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.t - b.t);
}

async function fetchBenchmarkSeries(
  benchmark: string,
  cgId: string,
  fromSec: number,
  toSec: number
): Promise<{ source: string; series: PricePoint[] }> {
  try {
    const series = await fetchCoinGeckoSeries(cgId, fromSec, toSec);
    if (series.length > 0) return { source: `coingecko:${cgId}`, series };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("coingecko:429")) {
      // For non-rate errors we still try fallback, but keep behavior transparent via source.
    }
  }

  const fallback = await fetchCoinbaseSeries(benchmark, fromSec * 1000, toSec * 1000);
  if (fallback.length > 0) return { source: "coinbase:candles", series: fallback };
  return { source: "unavailable", series: [] };
}

app.get("/api/positions", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  const mode = String(req.query.mode ?? "summary").trim().toLowerCase();

  if (!wallet) {
    res.status(400).json({ error: "Missing query param: wallet" });
    return;
  }

  try {
    new PublicKey(wallet);
  } catch {
    res.status(400).json({ error: "Invalid Solana wallet address" });
    return;
  }

  const cacheKey = `${wallet}:${mode}`;
  const cached = positionsCache.get(cacheKey);
  const now = Date.now();
  if (positionsCacheTtlMs > 0 && cached && now - cached.ts <= positionsCacheTtlMs) {
    res.json(cached.payload);
    return;
  }

  try {
    const positions = await fetchWalletPositions(wallet);
    if (mode === "full") {
      positionsCache.set(cacheKey, { ts: now, payload: positions });
      res.json(positions);
      return;
    }
    const summary = buildSummary(positions);
    positionsCache.set(cacheKey, { ts: now, payload: summary });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/hedge-beta", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  const lpPair = String(req.query.lpPair ?? "NX8-USDC").trim().toUpperCase();
  const benchmark = String(req.query.benchmark ?? "WBTC").trim().toUpperCase();
  const lookbackDays = Math.max(7, Math.min(180, Number(req.query.lookbackDays ?? 30)));

  if (!wallet) {
    res.status(400).json({ error: "Missing query param: wallet" });
    return;
  }
  try {
    new PublicKey(wallet);
  } catch {
    res.status(400).json({ error: "Invalid Solana wallet address" });
    return;
  }

  try {
    const positions = await fetchWalletPositions(wallet);
    const liqData = (positions.kaminoLiquidity.data ?? {}) as {
      strategyValuations?: Array<{
        pairLabel?: string;
        tokenAMint?: string;
        tokenBMint?: string;
        tokenASymbol?: string;
        tokenBSymbol?: string;
        endpoints?: { pnlHistoryUrl?: string };
      }>;
    };
    const strategies = liqData.strategyValuations ?? [];
    const strategy = strategies.find((s) => String(s.pairLabel ?? "").toUpperCase() === lpPair);
    if (!strategy?.endpoints?.pnlHistoryUrl) {
      res.status(404).json({ error: `No pnl history endpoint found for pair ${lpPair}` });
      return;
    }

    const baseSymbol = lpPair.split("-")[0] ?? "";
    const isTokenA = String(strategy.tokenASymbol ?? "").toUpperCase() === baseSymbol;
    const isTokenB = String(strategy.tokenBSymbol ?? "").toUpperCase() === baseSymbol;
    if (!isTokenA && !isTokenB) {
      res.status(400).json({ error: `Could not map base token for pair ${lpPair}` });
      return;
    }
    const baseMint = isTokenA ? String(strategy.tokenAMint ?? "") : String(strategy.tokenBMint ?? "");

    const pnlRes = await fetch(strategy.endpoints.pnlHistoryUrl);
    if (!pnlRes.ok) {
      const body = await pnlRes.text().catch(() => "");
      throw new Error(`Kamino pnl history failed (${pnlRes.status}) ${body.slice(0, 300)}`);
    }
    const pnlPayload = (await pnlRes.json()) as {
      history?: Array<{ timestamp?: number; tokenPrice?: { a?: string | number; b?: string | number } }>;
    };
    const history = Array.isArray(pnlPayload.history) ? pnlPayload.history : [];
    const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    let assetSeries = history
      .map((h) => {
        const t = Number(h.timestamp ?? 0);
        const rawPrice = isTokenA ? h.tokenPrice?.a : h.tokenPrice?.b;
        const p = parseNum(rawPrice);
        return { t, p };
      })
      .filter((x): x is { t: number; p: number } => {
        const p = x.p;
        return Number.isFinite(x.t) && x.t > since && typeof p === "number" && Number.isFinite(p) && p > 0;
      })
      .sort((a, b) => a.t - b.t);
    let assetSource = "kamino:pnl-history";
    const assetSpanDays =
      assetSeries.length > 1 ? (assetSeries[assetSeries.length - 1].t - assetSeries[0].t) / (24 * 60 * 60 * 1000) : 0;

    // If wallet-specific strategy history is too short (common for new positions),
    // fall back to global token market history by mint for a better beta window.
    if (baseMint && (assetSeries.length < 20 || assetSpanDays < Math.min(lookbackDays * 0.7, 7))) {
      try {
        const globalSeries = await fetchCoinGeckoContractSeries(baseMint, Math.floor(since / 1000), Math.floor(Date.now() / 1000));
        if (globalSeries.length >= 20) {
          assetSeries = globalSeries;
          assetSource = "coingecko:contract";
        }
      } catch {
        // keep Kamino series if fallback fails
      }
    }

    if (assetSeries.length < 20) {
      res.status(422).json({ error: `Not enough ${baseSymbol} history points for beta (${assetSeries.length})` });
      return;
    }

    const cgIdMap: Record<string, string> = {
      WBTC: "bitcoin",
      BTC: "bitcoin",
      SOL: "solana",
      ETH: "ethereum"
    };
    const cgId = cgIdMap[benchmark] ?? "bitcoin";
    const fromSec = Math.floor((assetSeries[0].t - 60 * 60 * 1000) / 1000);
    const toSec = Math.floor((assetSeries[assetSeries.length - 1].t + 60 * 60 * 1000) / 1000);
    const benchmarkFeed = await fetchBenchmarkSeries(benchmark, cgId, fromSec, toSec);
    const benchmarkSeries = benchmarkFeed.series;
    if (benchmarkSeries.length < 10) {
      res.status(422).json({ error: `Not enough benchmark history points for ${benchmark} (source=${benchmarkFeed.source})` });
      return;
    }

    const aligned = assetSeries
      .map((a) => {
        const b = interpolatePriceAt(a.t, benchmarkSeries);
        return b && Number.isFinite(b) ? { t: a.t, asset: a.p, benchmark: b } : null;
      })
      .filter((x): x is { t: number; asset: number; benchmark: number } => Boolean(x));

    if (aligned.length < 20) {
      res.status(422).json({ error: `Not enough aligned points (${aligned.length})` });
      return;
    }

    const returns: Array<{ t: number; assetRet: number; benchmarkRet: number }> = [];
    for (let i = 1; i < aligned.length; i += 1) {
      const prev = aligned[i - 1];
      const cur = aligned[i];
      const assetRet = cur.asset / prev.asset - 1;
      const benchmarkRet = cur.benchmark / prev.benchmark - 1;
      if (Number.isFinite(assetRet) && Number.isFinite(benchmarkRet)) {
        returns.push({ t: cur.t, assetRet, benchmarkRet });
      }
    }
    if (returns.length < 20) {
      res.status(422).json({ error: `Not enough return points (${returns.length})` });
      return;
    }

    const n = returns.length;
    const meanX = returns.reduce((acc, r) => acc + r.benchmarkRet, 0) / n;
    const meanY = returns.reduce((acc, r) => acc + r.assetRet, 0) / n;
    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (const r of returns) {
      const dx = r.benchmarkRet - meanX;
      const dy = r.assetRet - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    cov /= Math.max(1, n - 1);
    varX /= Math.max(1, n - 1);
    varY /= Math.max(1, n - 1);
    const beta = varX > 0 ? cov / varX : NaN;
    const corr = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : NaN;
    const r2 = Number.isFinite(corr) ? corr * corr : NaN;
    const alpha = meanY - beta * meanX;

    const baseAsset = aligned[0].asset;
    const baseBenchmark = aligned[0].benchmark;
    const chartRows = downsample(
      aligned.map((p) => ({
        t: p.t,
        assetPrice: p.asset,
        benchmarkPrice: p.benchmark,
        assetIndex: (p.asset / baseAsset) * 100,
        benchmarkIndex: (p.benchmark / baseBenchmark) * 100
      })),
      260
    );

    res.json({
      wallet,
      pair: lpPair,
      baseAssetSymbol: baseSymbol,
      baseAssetSource: assetSource,
      benchmarkSymbol: benchmark,
      benchmarkSource: benchmarkFeed.source,
      lookbackDays,
      sampleCount: n,
      beta,
      alpha,
      correlation: corr,
      r2,
      means: { assetRet: meanY, benchmarkRet: meanX },
      series: chartRows.map((r) => ({ t: r.t, asset: r.assetIndex, benchmark: r.benchmarkIndex })),
      chartRows,
      returns: downsample(
        returns.map((r) => ({ t: r.t, assetRet: r.assetRet, benchmarkRet: r.benchmarkRet })),
        260
      )
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`dashboard server listening on http://localhost:${port}`);
});
