import "dotenv/config";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { address, createSolanaRpc } from "@solana/kit";
import { Decimal } from "decimal.js";
import { Farms } from "@kamino-finance/farms-sdk";
import { Kamino } from "@kamino-finance/kliquidity-sdk";
import { pathToFileURL } from "node:url";
import { z } from "zod";

type SpotTokenPosition = {
  mint: string;
  amountRaw: string;
  decimals: number;
  amountUi: number;
  symbol: string | null;
  metadata?: {
    source: "das" | "none";
    name: string | null;
    symbol: string | null;
    description: string | null;
    interface: string | null;
    tokenStandard: string | null;
    isNft: boolean | null;
    confidence: "high" | "medium" | "low";
  };
};

type ProtocolFetchResult = {
  source: string;
  ok: boolean;
  endpointUsed: string | null;
  data: unknown;
  error: string | null;
};

type WalletPositions = {
  wallet: string;
  slot: number;
  rpc: string;
  spot: {
    nativeSol: number;
    splTokens: SpotTokenPosition[];
  };
  jupiterPerps: ProtocolFetchResult;
  kaminoLend: ProtocolFetchResult;
  kaminoLiquidity: ProtocolFetchResult;
};

type OutputMode = "full" | "summary";

type KaminoMarket = {
  lendingMarket: string;
  name?: string;
  isPrimary?: boolean;
};

type KaminoLiquidityStrategyPosition = {
  strategy: string;
  sharesMint: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  pairLabel: string;
  sharesIssuedUi: number | null;
  totalTokenAUi: number | null;
  totalTokenBUi: number | null;
};

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": "USDG",
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
  NX8DuAWprqWAYDvpkkuhKnPfGRXQQhgiw85pCkgvFYk: "NX8"
};
const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": 6,
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: 6,
  NX8DuAWprqWAYDvpkkuhKnPfGRXQQhgiw85pCkgvFYk: 9
};

const cliSchema = z.object({
  wallet: z.string().min(32)
});

function parseWalletArg(): string {
  const wallet = process.argv[2];
  const parsed = cliSchema.safeParse({ wallet });
  if (!parsed.success) {
    throw new Error("Usage: npm run start -- <WALLET_ADDRESS>");
  }
  return wallet;
}

function parseOutputMode(): OutputMode {
  return process.argv.includes("--summary") ? "summary" : "full";
}

function parseEndpointList(envValue: string | undefined, fallback: string[]): string[] {
  if (!envValue?.trim()) return fallback;
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeUrl(template: string, wallet: string): string {
  return template.replaceAll("{wallet}", wallet);
}

function normalizeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function inferTokenSymbol(mint: string): string {
  return KNOWN_TOKEN_SYMBOLS[mint] ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseMaybeDecimal(v: unknown): Decimal | null {
  if (v == null) return null;
  try {
    const d = new Decimal(String(v));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function sumKnown(nums: Array<number | null | undefined>): number {
  return nums.reduce<number>((acc, n) => acc + (typeof n === "number" && Number.isFinite(n) ? n : 0), 0);
}

function toUiAmount(raw: number, decimals: number | null): number | null {
  if (!Number.isFinite(raw) || decimals == null) return null;
  return raw / 10 ** decimals;
}

function inferNonLiquidityPositionLabel(symbol: string): { position: string; positionType: string } {
  if (symbol === "USDC") return { position: "USDC", positionType: "Lend" };
  if (symbol === "USDG") return { position: "USDG", positionType: "Multiply" };
  return { position: symbol, positionType: "Lend/Multiply" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRpcList(envValue: string | undefined, fallback: string[]): string[] {
  return parseEndpointList(envValue, fallback);
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 300)}` : ""}`);
  }
  return res.json();
}

async function fetchDasAssetMetadata(
  rpcUrl: string,
  mint: string
): Promise<{
  source: "das" | "none";
  name: string | null;
  symbol: string | null;
  description: string | null;
  interface: string | null;
  tokenStandard: string | null;
  isNft: boolean | null;
  confidence: "high" | "medium" | "low";
}> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `asset-${mint}`,
        method: "getAsset",
        params: { id: mint }
      })
    });

    if (!res.ok) {
      return {
        source: "none",
        name: null,
        symbol: null,
        description: null,
        interface: null,
        tokenStandard: null,
        isNft: null,
        confidence: "low"
      };
    }

    const payload = (await res.json()) as {
      result?: {
        interface?: string;
        content?: { metadata?: { name?: string; symbol?: string; description?: string; token_standard?: string } };
        token_info?: { decimals?: number; supply?: number | string; token_standard?: string };
      };
      error?: unknown;
    };
    if (!payload?.result || payload.error) {
      return {
        source: "none",
        name: null,
        symbol: null,
        description: null,
        interface: null,
        tokenStandard: null,
        isNft: null,
        confidence: "low"
      };
    }

    const iface = payload.result.interface ?? null;
    const md = payload.result.content?.metadata;
    const tokenStandard = payload.result.token_info?.token_standard ?? md?.token_standard ?? null;
    const decimals = Number(payload.result.token_info?.decimals ?? NaN);
    const supply = Number(payload.result.token_info?.supply ?? NaN);
    const fungibleByInterface = typeof iface === "string" && /fungibletoken/i.test(iface);
    const fungibleByStandard = typeof tokenStandard === "string" && /fungible/i.test(tokenStandard) && !/non.?fungible|nft/i.test(tokenStandard);
    const nftByInterface = typeof iface === "string" && /nft/i.test(iface);
    const nftByStandard = typeof tokenStandard === "string" && /non.?fungible|nft/i.test(tokenStandard);
    const nftByMintShape = Number.isFinite(decimals) && decimals === 0 && Number.isFinite(supply) && supply <= 1;
    const isNft = fungibleByInterface || fungibleByStandard ? false : nftByInterface || nftByStandard || nftByMintShape;
    const confidence: "high" | "medium" | "low" =
      nftByInterface || nftByStandard || fungibleByInterface || fungibleByStandard ? "high" : nftByMintShape ? "medium" : "medium";

    return {
      source: "das",
      name: md?.name ?? null,
      symbol: md?.symbol ?? null,
      description: md?.description ?? null,
      interface: iface,
      tokenStandard,
      isNft,
      confidence
    };
  } catch {
    return {
      source: "none",
      name: null,
      symbol: null,
      description: null,
      interface: null,
      tokenStandard: null,
      isNft: null,
      confidence: "low"
    };
  }
}

async function fetchWithFallback(
  source: string,
  endpointTemplates: string[],
  wallet: string,
  headers: Record<string, string>
): Promise<ProtocolFetchResult> {
  let lastError: string | null = null;

  for (const tpl of endpointTemplates) {
    const url = makeUrl(tpl, wallet);
    try {
      const data = await fetchJson(url, headers);
      return {
        source,
        ok: true,
        endpointUsed: url,
        data,
        error: null
      };
    } catch (err) {
      lastError = normalizeErr(err);
    }
  }

  return {
    source,
    ok: false,
    endpointUsed: null,
    data: null,
    error: lastError ?? "All endpoints failed"
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractPerpLikeEntries(root: unknown): unknown[] {
  const out: unknown[] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (!isObject(node)) return;

    const serialized = JSON.stringify(node).toLowerCase();
    if (serialized.includes("perp")) {
      out.push(node);
    }

    for (const val of Object.values(node)) {
      visit(val);
    }
  }

  visit(root);
  return out;
}

async function getJupiterPerpsDetails(wallet: string): Promise<ProtocolFetchResult> {
  const apiKey = process.env.JUPITER_API_KEY ?? process.env.POSITIONS_API_KEY;
  const portfolioEndpoint = process.env.JUPITER_PORTFOLIO_ENDPOINT ?? "https://api.jup.ag/portfolio/v1/positions/{wallet}";

  const errors: string[] = [];

  if (apiKey) {
    const url = makeUrl(portfolioEndpoint, wallet);
    try {
      const raw = await fetchJson(url, { "x-api-key": apiKey });
      return {
        source: "jupiterPerps",
        ok: true,
        endpointUsed: url,
        data: {
          raw,
          perpLikeEntries: extractPerpLikeEntries(raw)
        },
        error: null
      };
    } catch (err) {
      errors.push(`Portfolio API failed: ${normalizeErr(err)}`);
    }
  } else {
    errors.push("Missing JUPITER_API_KEY (required for Jupiter Portfolio API)");
  }

  const legacyEndpoints = parseEndpointList(process.env.JUPITER_PERPS_ENDPOINTS, []);
  if (legacyEndpoints.length > 0) {
    const legacy = await fetchWithFallback("jupiterPerps", legacyEndpoints, wallet, {});
    if (legacy.ok) return legacy;
    errors.push(`Legacy perps endpoints failed: ${legacy.error ?? "Unknown error"}`);
  }

  return {
    source: "jupiterPerps",
    ok: false,
    endpointUsed: null,
    data: null,
    error: errors.join(" | ")
  };
}

async function getKaminoLendDetails(wallet: string): Promise<ProtocolFetchResult> {
  const kaminoBase = process.env.KAMINO_BASE_URL ?? "https://api.kamino.finance";
  const kaminoEnv = process.env.KAMINO_ENV ?? "mainnet-beta";
  const onreLiveApyUrl = process.env.ONRE_LIVE_APY_URL ?? "https://core.api.onre.finance/data/live-apy";
  const sdkRpcUrls = parseRpcList(process.env.KAMINO_SDK_RPC_URLS, [
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"
  ]);

  const marketsUrl = `${kaminoBase}/v2/kamino-market?env=${encodeURIComponent(kaminoEnv)}`;
  const onreLiveApyPromise = fetchJson(onreLiveApyUrl)
    .then((v) => parseMaybeDecimal(v))
    .catch(() => null);

  let marketsRaw: unknown;
  try {
    marketsRaw = await fetchJson(marketsUrl);
  } catch (err) {
    return {
      source: "kaminoLend",
      ok: false,
      endpointUsed: marketsUrl,
      data: null,
      error: normalizeErr(err)
    };
  }

  const markets = Array.isArray(marketsRaw) ? (marketsRaw as KaminoMarket[]) : [];
  if (markets.length === 0) {
    return {
      source: "kaminoLend",
      ok: true,
      endpointUsed: marketsUrl,
      data: {
        markets: [],
        positionsByMarket: []
      },
      error: null
    };
  }

  const nonLiquidityFarmRewardApyByMint = new Map<string, Decimal>();
  const nonLiquidityFarmRewardApyBySymbol = new Map<string, Decimal>();
  for (const rpcUrl of sdkRpcUrls) {
    try {
      const rpc = createSolanaRpc(rpcUrl);
      const farms = new Farms(rpc);
      const userFarms = await farms.getAllFarmsForUser(address(wallet), new Decimal(Math.floor(Date.now() / 1000)));
      const farmRows = [...userFarms.values()].filter((uf) => String(uf.strategyId) === "11111111111111111111111111111111");
      if (farmRows.length === 0) continue;
      const today = new Date();
      const start = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const end = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      for (const userFarm of farmRows) {
        const reward = userFarm.pendingRewards.find((r) => String(r.rewardTokenMint) !== "11111111111111111111111111111111");
        if (!reward) continue;
        const rewardMint = String(reward.rewardTokenMint);
        const rewardSymbol = inferTokenSymbol(rewardMint).toUpperCase();
        const yieldUrl = `${kaminoBase}/yields/${String(userFarm.farm)}/history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        const yieldRows = (await fetchJson(yieldUrl).catch(() => null)) as Array<{ apy?: string | number }> | null;
        const apyValues = Array.isArray(yieldRows)
          ? yieldRows
              .map((r) => parseMaybeDecimal(r.apy))
              .filter((v): v is Decimal => v != null && v.gt(0))
          : [];
        if (apyValues.length === 0) continue;
        const latestApy = apyValues[apyValues.length - 1];
        const prevMint = nonLiquidityFarmRewardApyByMint.get(rewardMint);
        if (!prevMint || latestApy.gt(prevMint)) nonLiquidityFarmRewardApyByMint.set(rewardMint, latestApy);
        const prevSym = nonLiquidityFarmRewardApyBySymbol.get(rewardSymbol);
        if (!prevSym || latestApy.gt(prevSym)) nonLiquidityFarmRewardApyBySymbol.set(rewardSymbol, latestApy);
      }
      break;
    } catch {
      // Best-effort enrichment only.
    }
  }

  const onreLiveApy = await onreLiveApyPromise;
  const byMarket = await Promise.all(
    markets.map(async (market) => {
      const marketPk = market.lendingMarket;
      const obligationsUrl = `${kaminoBase}/kamino-market/${marketPk}/users/${wallet}/obligations?env=${encodeURIComponent(kaminoEnv)}`;
      const userTransactionsUrl = `${kaminoBase}/v2/kamino-market/${marketPk}/users/${wallet}/transactions?env=${encodeURIComponent(kaminoEnv)}`;
      const reservesMetricsUrl = `${kaminoBase}/kamino-market/${marketPk}/reserves/metrics?env=${encodeURIComponent(kaminoEnv)}`;
      try {
        const obligations = await fetchJson(obligationsUrl);
        const obligationsArr = Array.isArray(obligations) ? obligations : [];
        if (obligationsArr.length === 0) {
          return {
            market: marketPk,
            marketName: market.name ?? null,
            isPrimary: market.isPrimary ?? false,
            endpoint: obligationsUrl,
            ok: true,
            reserveMetrics: [],
            obligations: []
          };
        }
        const [userTxRaw, reservesMetricsRaw] = await Promise.all([
          fetchJson(userTransactionsUrl).catch(() => null),
          fetchJson(reservesMetricsUrl).catch(() => null)
        ]);
        const userTxByObligation = userTxRaw && typeof userTxRaw === "object" ? (userTxRaw as Record<string, unknown[]>) : {};
        const reserveMetricsByReserve = new Map<
          string,
          {
            reserve: string;
            liquidityToken: string;
            liquidityTokenMint: string | null;
            assetPriceUsd: Decimal | null;
            supplyApy: Decimal | null;
            borrowApy: Decimal | null;
          }
        >(
          (Array.isArray(reservesMetricsRaw) ? reservesMetricsRaw : [])
            .map((r) => {
              const row = r as Record<string, unknown>;
              const reserve = String(row.reserve ?? "");
              if (!reserve) return null;
              const symbol = String(row.liquidityToken ?? inferTokenSymbol(String(row.liquidityTokenMint ?? reserve)));
              const assetPriceDirect = parseMaybeDecimal(row.assetPriceUSD);
              const totalSupplyUsd = parseMaybeDecimal(row.totalSupplyUsd);
              const totalSupply = parseMaybeDecimal(row.totalSupply);
              const assetPriceDerived =
                !assetPriceDirect && totalSupplyUsd && totalSupply && totalSupply.gt(0) ? totalSupplyUsd.div(totalSupply) : null;
              return {
                reserve,
                liquidityToken: symbol,
                liquidityTokenMint: typeof row.liquidityTokenMint === "string" ? row.liquidityTokenMint : null,
                assetPriceUsd: assetPriceDirect ?? assetPriceDerived,
                supplyApy: symbol.toUpperCase() === "ONYC" && onreLiveApy != null ? onreLiveApy : parseMaybeDecimal(row.supplyApy),
                borrowApy: parseMaybeDecimal(row.borrowApy)
              };
            })
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
            .map((r) => [r.reserve, r] as const)
        );
        const enrichedObligations = await Promise.all(
          obligationsArr.map(async (ob) => {
            const obligationAddress = String(
              (ob as { obligationAddress?: string; state?: { owner?: string } }).obligationAddress ??
                (ob as { state?: { owner?: string } }).state?.owner ??
                "unknown"
            );
            if (obligationAddress === "unknown") return ob;

            const pnlUrl = `${kaminoBase}/v2/kamino-market/${marketPk}/obligations/${obligationAddress}/pnl?env=${encodeURIComponent(kaminoEnv)}`;
            const historyUrl = `${kaminoBase}/v2/kamino-market/${marketPk}/obligations/${obligationAddress}/metrics/history?env=${encodeURIComponent(
              kaminoEnv
            )}&frequency=day`;
            const interestPaidUrl = `${kaminoBase}/v2/kamino-market/${marketPk}/obligations/${obligationAddress}/interest-paid?env=${encodeURIComponent(
              kaminoEnv
            )}`;
            const [pnlRes, historyRes, interestPaidRes] = await Promise.allSettled([
              fetchJson(pnlUrl),
              fetchJson(historyUrl),
              fetchJson(interestPaidUrl)
            ]);

            const nowMs = Date.now();
            const pnlData = pnlRes.status === "fulfilled" ? (pnlRes.value as { usd?: string | number; invested?: { usd?: string | number } }) : null;
            const pnlUsd = parseMaybeNumber(pnlData?.usd);
            const investedUsd = parseMaybeNumber(pnlData?.invested?.usd);
            const refreshedStats = (ob as { refreshedStats?: Record<string, unknown> }).refreshedStats ?? {};
            const txRowsRaw = Array.isArray(userTxByObligation[obligationAddress]) ? userTxByObligation[obligationAddress] : [];
            const txRows = txRowsRaw.map((t) => {
              const row = t as Record<string, unknown>;
              return {
                createdOn: typeof row.createdOn === "string" ? row.createdOn : null,
                timestamp: parseMaybeNumber(row.timestamp),
                transactionDisplayName: typeof row.transactionDisplayName === "string" ? row.transactionDisplayName : null,
                transactionName: typeof row.transactionName === "string" ? row.transactionName : null,
                transactionSignature: typeof row.transactionSignature === "string" ? row.transactionSignature : null,
                liquidityToken: typeof row.liquidityToken === "string" ? row.liquidityToken : null,
                liquidityTokenAmount: parseMaybeNumber(row.liquidityTokenAmount),
                liquidityUsdValue: parseMaybeNumber(row.liquidityUsdValue)
              };
            });
            const weightedDeposits = txRows
              .filter((t) => String(t.transactionDisplayName ?? t.transactionName ?? "").toLowerCase() === "deposit")
              .map((t) => {
                const tsMs = t.createdOn ? new Date(t.createdOn).getTime() : Number(t.timestamp ?? NaN);
                const usd = Number(t.liquidityUsdValue ?? NaN);
                return { tsMs, usd };
              })
              .filter((x) => Number.isFinite(x.tsMs) && x.tsMs > 0 && Number.isFinite(x.usd) && x.usd > 0);
            const weightedDenom = weightedDeposits.reduce((acc, x) => acc + x.usd, 0);
            const daysCapitalWeighted =
              weightedDenom > 0
                ? weightedDeposits.reduce((acc, x) => acc + x.usd * Math.max(1 / 24, (nowMs - x.tsMs) / (24 * 60 * 60 * 1000)), 0) / weightedDenom
                : null;
            const rewardsClaimedUsd = txRows
              .filter((t) => String(t.transactionDisplayName ?? t.transactionName ?? "").toLowerCase().includes("claim"))
              .reduce((acc, t) => acc + (Number.isFinite(Number(t.liquidityUsdValue)) ? Number(t.liquidityUsdValue) : 0), 0);
            const history = historyRes.status === "fulfilled" ? ((historyRes.value as { history?: unknown[] }).history ?? []) : [];
            const firstTsMs =
              Array.isArray(history) && history.length > 0
                ? Number((history[0] as { timestamp?: string | number }).timestamp ? new Date(String((history[0] as { timestamp?: string | number }).timestamp)).getTime() : NaN)
                : NaN;
            const daysObserved = Number.isFinite(firstTsMs) && firstTsMs > 0 ? Math.max(1 / 24, (nowMs - firstTsMs) / (24 * 60 * 60 * 1000)) : null;
            const annualizationDays = daysCapitalWeighted ?? daysObserved;
            let unrealizedApyPct: number | null = null;
            let unrealizedApyWithRewardsPct: number | null = null;
            if (investedUsd != null && pnlUsd != null && investedUsd > 0 && annualizationDays != null) {
              const gross = 1 + pnlUsd / investedUsd;
              if (gross > 0) {
                unrealizedApyPct = (gross ** (365 / annualizationDays) - 1) * 100;
              }
              const grossWithRewards = 1 + (pnlUsd + rewardsClaimedUsd) / investedUsd;
              if (grossWithRewards > 0) {
                unrealizedApyWithRewardsPct = (grossWithRewards ** (365 / annualizationDays) - 1) * 100;
              }
            }

            const rawDeposits = Array.isArray((ob as { state?: { deposits?: unknown[] } }).state?.deposits)
              ? ((ob as { state?: { deposits?: unknown[] } }).state?.deposits ?? [])
              : [];
            const rawBorrows = Array.isArray((ob as { state?: { borrows?: unknown[] } }).state?.borrows)
              ? ((ob as { state?: { borrows?: unknown[] } }).state?.borrows ?? [])
              : [];
            const depositWeights = rawDeposits
              .map((d) => {
                const row = d as Record<string, unknown>;
                const reserve = String(row.depositReserve ?? "");
                const w = parseMaybeDecimal(row.marketValueSf);
                return { reserve, weight: w };
              })
              .filter((r) => r.reserve !== "11111111111111111111111111111111" && r.weight != null && r.weight.gt(0));
            const borrowWeights = rawBorrows
              .map((b) => {
                const row = b as Record<string, unknown>;
                const reserve = String(row.borrowReserve ?? "");
                const w = parseMaybeDecimal(row.marketValueSf);
                return { reserve, weight: w };
              })
              .filter((r) => r.reserve !== "11111111111111111111111111111111" && r.weight != null && r.weight.gt(0));

            const weightedApy = (
              rows: Array<{ reserve: string; weight: Decimal | null }>,
              selector: (m: {
                liquidityToken: string;
                liquidityTokenMint: string | null;
                assetPriceUsd: Decimal | null;
                supplyApy: Decimal | null;
                borrowApy: Decimal | null;
              }) => Decimal | null
            ): Decimal | null => {
              let weighted = new Decimal(0);
              let denom = new Decimal(0);
              for (const row of rows) {
                if (!row.weight) continue;
                const metric = reserveMetricsByReserve.get(row.reserve);
                const apy = metric ? selector(metric) : null;
                if (!apy) continue;
                weighted = weighted.plus(row.weight.mul(apy));
                denom = denom.plus(row.weight);
              }
              if (denom.lte(0)) return null;
              return weighted.div(denom);
            };

            const currentSupplyApy = weightedApy(depositWeights, (m) => m.supplyApy);
            const currentBorrowApy = weightedApy(borrowWeights, (m) => m.borrowApy);
            const totalDepositUsd = parseMaybeDecimal(refreshedStats.userTotalDeposit);
            const totalBorrowUsd = parseMaybeDecimal(refreshedStats.userTotalBorrow);
            const netAccountValueUsd = parseMaybeDecimal(refreshedStats.netAccountValue);
            let currentNetInterestApyPct: number | null = null;
            let currentSupplyContributionNetApyPct: number | null = null;
            let currentBorrowCostNetApyPct: number | null = null;
            const currentBorrowRewardCreditApy = weightedApy(borrowWeights, (m) => {
              if (m.liquidityTokenMint) {
                const byMint = nonLiquidityFarmRewardApyByMint.get(m.liquidityTokenMint);
                if (byMint) return byMint;
              }
              const bySymbol = nonLiquidityFarmRewardApyBySymbol.get(String(m.liquidityToken ?? "").toUpperCase());
              return bySymbol ?? null;
            });
            const currentCombinedBorrowApy =
              currentBorrowApy && currentBorrowRewardCreditApy
                ? Decimal.max(new Decimal(0), currentBorrowApy.minus(currentBorrowRewardCreditApy))
                : null;
            const effectiveBorrowApyForNet = currentCombinedBorrowApy ?? currentBorrowApy;
            if (totalDepositUsd && totalBorrowUsd && netAccountValueUsd && netAccountValueUsd.gt(0) && currentSupplyApy && effectiveBorrowApyForNet) {
              const yearlyUsd = totalDepositUsd.mul(currentSupplyApy).minus(totalBorrowUsd.mul(effectiveBorrowApyForNet));
              currentNetInterestApyPct = yearlyUsd.div(netAccountValueUsd).mul(100).toNumber();
              currentSupplyContributionNetApyPct = totalDepositUsd.mul(currentSupplyApy).div(netAccountValueUsd).mul(100).toNumber();
              currentBorrowCostNetApyPct = totalBorrowUsd.mul(effectiveBorrowApyForNet).div(netAccountValueUsd).mul(100).toNumber();
            }
            const interestPaidData =
              interestPaidRes.status === "fulfilled"
                ? (interestPaidRes.value as {
                    historicalFeesObligation?: Record<string, Array<Record<string, { ts?: number | string; usdFees?: number | string }>>>;
                  })
                : null;
            const parseTsMs = (value: number): number => {
              if (!Number.isFinite(value) || value <= 0) return NaN;
              return value > 10_000_000_000 ? value : value * 1000;
            };
            const paidRows = (interestPaidData?.historicalFeesObligation?.[obligationAddress] ?? [])
              .flatMap((entry) =>
                Object.values(entry).map((v) => ({
                  tsMs: parseTsMs(Number(v.ts ?? 0)),
                  usdFees: Number(v.usdFees ?? 0)
                }))
              )
              .filter((r) => Number.isFinite(r.tsMs) && r.tsMs > 0 && Number.isFinite(r.usdFees))
              .sort((a, b) => a.tsMs - b.tsMs);
            const sevenDayStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;
            const interestPaidRawSeries = paidRows
              .filter((r) => r.tsMs >= sevenDayStartMs)
              .map((r) => ({ ts: r.tsMs, usdFees: r.usdFees }));
            const sevenDayCutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
            const paid7dUsd = paidRows.filter((r) => r.tsMs >= sevenDayCutoff).reduce((acc, r) => acc + r.usdFees, 0);
            const twoHourMs = 2 * 60 * 60 * 1000;
            const rolling2hBorrowApySeries: Array<{ ts: number; fees2hUsd: number; borrowUsd: number; apyPct: number | null }> = [];
            if (totalBorrowUsd && totalBorrowUsd.gt(0) && paidRows.length > 0) {
              const borrowUsd = totalBorrowUsd.toNumber();
              const deltas = paidRows
                .map((r, i) => (i > 0 ? r.tsMs - paidRows[i - 1].tsMs : NaN))
                .filter((d) => Number.isFinite(d) && d > 0)
                .sort((a, b) => a - b);
              const inferredBucketMs =
                deltas.length > 0
                  ? deltas.length % 2 === 1
                    ? deltas[Math.floor(deltas.length / 2)]
                    : (deltas[deltas.length / 2 - 1] + deltas[deltas.length / 2]) / 2
                  : twoHourMs;
              const bucketProration = inferredBucketMs > twoHourMs ? twoHourMs / inferredBucketMs : 1;
              const sampleTs = [...new Set([...paidRows.map((r) => r.tsMs), nowMs])].sort((a, b) => a - b);
              for (const ts of sampleTs) {
                const cutoff = ts - twoHourMs;
                const rawFeesInWindow = paidRows
                  .filter((r) => r.tsMs > cutoff && r.tsMs <= ts)
                  .reduce((acc, r) => acc + r.usdFees, 0);
                const fees2hUsd = rawFeesInWindow * bucketProration;
                const periodReturn = borrowUsd > 0 ? fees2hUsd / borrowUsd : NaN;
                const apyPct = Number.isFinite(periodReturn) && periodReturn > -1
                  ? (Math.pow(1 + periodReturn, (365 * 24) / 2) - 1) * 100
                  : null;
                rolling2hBorrowApySeries.push({ ts, fees2hUsd, borrowUsd, apyPct: Number.isFinite(Number(apyPct)) ? Number(apyPct) : null });
              }
            }
            const currentRolling2hBorrowApyPct =
              rolling2hBorrowApySeries.length > 0 ? rolling2hBorrowApySeries[rolling2hBorrowApySeries.length - 1]?.apyPct ?? null : null;
            let combinedBorrowApyPctEst: number | null = null;
            let borrowRewardCreditApyPctEst: number | null = null;
            if (totalBorrowUsd && totalBorrowUsd.gt(0) && Number.isFinite(paid7dUsd) && paid7dUsd >= 0) {
              combinedBorrowApyPctEst = new Decimal(paid7dUsd).mul(365).div(7).div(totalBorrowUsd).mul(100).toNumber();
              if (currentBorrowApy) {
                const rawCredit = currentBorrowApy.mul(100).minus(combinedBorrowApyPctEst).toNumber();
                borrowRewardCreditApyPctEst = Number.isFinite(rawCredit) ? Math.max(0, rawCredit) : null;
              }
            }
            const reserveApyBreakdown = [
              ...depositWeights.map((row) => {
                const metric = reserveMetricsByReserve.get(row.reserve);
                return {
                  side: "supply" as const,
                  reserve: row.reserve,
                  symbol: metric?.liquidityToken ?? row.reserve,
                  apyPct: metric?.supplyApy ? metric.supplyApy.mul(100).toNumber() : null
                };
              }),
              ...borrowWeights.map((row) => {
                const metric = reserveMetricsByReserve.get(row.reserve);
                return {
                  side: "borrow" as const,
                  reserve: row.reserve,
                  symbol: metric?.liquidityToken ?? row.reserve,
                  apyPct: metric?.borrowApy ? metric.borrowApy.mul(100).toNumber() : null
                };
              })
            ];

            return {
              ...ob,
              analytics: {
                pnlUsd,
                investedUsd,
                daysObserved,
                daysCapitalWeighted,
                unrealizedApyPct,
                rewardsClaimedUsd,
                unrealizedApyWithRewardsPct,
                currentSupplyApyPct: currentSupplyApy ? currentSupplyApy.mul(100).toNumber() : null,
                currentBorrowApyPct: currentBorrowApy ? currentBorrowApy.mul(100).toNumber() : null,
                currentNetInterestApyPct,
                currentSupplyContributionNetApyPct,
                currentBorrowCostNetApyPct,
                currentSupplyApySource: onreLiveApy != null ? "onre-live-apy" : "kamino-reserves-metrics",
                onycLiveApyPct: onreLiveApy ? onreLiveApy.mul(100).toNumber() : null,
                currentBorrowRewardCreditApyPctLive: currentBorrowRewardCreditApy ? currentBorrowRewardCreditApy.mul(100).toNumber() : null,
                currentCombinedBorrowApyPctLive: currentCombinedBorrowApy ? currentCombinedBorrowApy.mul(100).toNumber() : null,
                currentRolling2hBorrowApyPct,
                rolling2hBorrowApySeries,
                interestPaidRawSeries,
                combinedBorrowApyPctEst,
                borrowRewardCreditApyPctEst,
                reserveApyBreakdown,
                transactions: txRows,
                endpoints: { pnlUrl, historyUrl, interestPaidUrl },
                error:
                  (pnlRes.status === "rejected" ? `pnl: ${normalizeErr(pnlRes.reason)}` : "") +
                  (historyRes.status === "rejected" ? `${pnlRes.status === "rejected" ? " | " : ""}history: ${normalizeErr(historyRes.reason)}` : "") +
                  (interestPaidRes.status === "rejected"
                    ? `${pnlRes.status === "rejected" || historyRes.status === "rejected" ? " | " : ""}interest-paid: ${normalizeErr(
                        interestPaidRes.reason
                      )}`
                    : "")
              }
            };
          })
        );
        return {
          market: marketPk,
          marketName: market.name ?? null,
          isPrimary: market.isPrimary ?? false,
          endpoint: obligationsUrl,
          ok: true,
          reserveMetrics: [...reserveMetricsByReserve.values()].map((r) => ({
            reserve: r.reserve,
            symbol: r.liquidityToken,
            mint: r.liquidityTokenMint,
            assetPriceUsd: r.assetPriceUsd ? r.assetPriceUsd.toNumber() : null
          })),
          obligations: enrichedObligations
        };
      } catch (err) {
        return {
          market: marketPk,
          marketName: market.name ?? null,
          isPrimary: market.isPrimary ?? false,
          endpoint: obligationsUrl,
          ok: false,
          error: normalizeErr(err)
        };
      }
    })
  );

  const positionsByMarket = byMarket.filter((entry) => {
    if (!entry.ok) return true;
    return Array.isArray(entry.obligations) ? entry.obligations.length > 0 : true;
  });

  return {
    source: "kaminoLend",
    ok: true,
    endpointUsed: marketsUrl,
    data: {
      marketCount: markets.length,
      nonEmptyOrErrorMarketCount: positionsByMarket.length,
      positionsByMarket
    },
    error: null
  };
}

async function getKaminoLiquidityDetails(wallet: string): Promise<ProtocolFetchResult> {
  const kaminoBase = process.env.KAMINO_BASE_URL ?? "https://api.kamino.finance";
  const kaminoEnv = process.env.KAMINO_ENV ?? "mainnet-beta";
  const kvaultPositionsUrl = `${kaminoBase}/kvaults/users/${wallet}/positions?env=${encodeURIComponent(kaminoEnv)}`;
  const kvaultRewardsUrl = `${kaminoBase}/kvaults/users/${wallet}/rewards?env=${encodeURIComponent(kaminoEnv)}`;
  const farmsTransactionsUrl = `${kaminoBase}/farms/users/${wallet}/transactions?env=${encodeURIComponent(kaminoEnv)}&limit=50`;
  const sdkRpcUrls = parseRpcList(process.env.KAMINO_SDK_RPC_URLS, [
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"
  ]);

  const [kvaultPositionsRes, kvaultRewardsRes, farmsTransactionsRes] = await Promise.allSettled([
    fetchJson(kvaultPositionsUrl),
    fetchJson(kvaultRewardsUrl),
    fetchJson(farmsTransactionsUrl)
  ]);

  const kvaultPositions = kvaultPositionsRes.status === "fulfilled" ? kvaultPositionsRes.value : null;
  const kvaultRewards = kvaultRewardsRes.status === "fulfilled" ? kvaultRewardsRes.value : null;
  const farmsTransactions = farmsTransactionsRes.status === "fulfilled" ? farmsTransactionsRes.value : null;
  const sdkErrors: string[] = [];
  let sdkPositions: KaminoLiquidityStrategyPosition[] = [];
  let sdkRpcUsed: string | null = null;
  const strategySharesByAddress = new Map<string, number>();
  let farmsRpcUsed: string | null = null;
  const claimableRewardsRawByMint = new Map<string, number>();
  const farmToPositionMeta = new Map<string, { positionType: string; position: string; strategy: string | null }>();
  const claimableByPosition: Array<{
    position: string;
    positionType: string;
    strategy: string | null;
    farm: string;
    mint: string;
    symbol: string;
    amountRaw: string;
    amountUi: number | null;
  }> = [];

  for (const rpcUrl of sdkRpcUrls) {
    try {
      const rpc = createSolanaRpc(rpcUrl);
      const kamino = new Kamino("mainnet-beta", rpc);
      const positions = await kamino.getUserPositions(address(wallet));
      const strategyAddresses = Array.from(new Set(positions.map((p) => String(p.strategy))));

      const strategyDetails = await Promise.all(
        strategyAddresses.map(async (strategyAddress) => {
          const strategy = await kamino.getStrategyByAddress(address(strategyAddress));
          if (!strategy) return null;
          const shareData = await kamino.getStrategyShareData(address(strategyAddress)).catch(() => null);

          const tokenAMint = String(strategy.tokenAMint);
          const tokenBMint = String(strategy.tokenBMint);
          const tokenASymbol = inferTokenSymbol(tokenAMint);
          const tokenBSymbol = inferTokenSymbol(tokenBMint);
          const sharesIssuedRaw = Number((strategy.sharesIssued as Decimal | undefined)?.toString?.() ?? NaN);
          const sharesMintDecimals = Number(strategy.sharesMintDecimals ?? NaN);
          const sharesIssuedUi =
            Number.isFinite(sharesIssuedRaw) && Number.isFinite(sharesMintDecimals) ? sharesIssuedRaw / 10 ** sharesMintDecimals : null;
          const totalTokenAUi = shareData
            ? Number(shareData.balance.computedHoldings.available.a) + Number(shareData.balance.computedHoldings.invested.a)
            : null;
          const totalTokenBUi = shareData
            ? Number(shareData.balance.computedHoldings.available.b) + Number(shareData.balance.computedHoldings.invested.b)
            : null;

          return {
            strategy: strategyAddress,
            sharesMint: String(strategy.sharesMint),
            tokenAMint,
            tokenBMint,
            tokenASymbol,
            tokenBSymbol,
            pairLabel: `${tokenASymbol}-${tokenBSymbol}`,
            sharesIssuedUi: Number.isFinite(Number(sharesIssuedUi)) ? Number(sharesIssuedUi) : null,
            totalTokenAUi: Number.isFinite(Number(totalTokenAUi)) ? Number(totalTokenAUi) : null,
            totalTokenBUi: Number.isFinite(Number(totalTokenBUi)) ? Number(totalTokenBUi) : null
          };
        })
      );

      sdkPositions = strategyDetails.filter((it): it is NonNullable<typeof it> => Boolean(it));
      sdkRpcUsed = rpcUrl;
      break;
    } catch (err) {
      sdkErrors.push(`${rpcUrl}: ${normalizeErr(err)}`);
    }
  }

  // Optional second valuation input: include shares currently staked in Kamino farms.
  // This can diverge from shareholder PnL endpoints, so we expose both values side-by-side.
  if (sdkPositions.length > 0) {
    const strategySet = new Set(sdkPositions.map((p) => p.strategy));
    for (const rpcUrl of sdkRpcUrls) {
      let fetched = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const rpc = createSolanaRpc(rpcUrl);
          const farms = new Farms(rpc);
          const userFarms = await farms.getAllFarmsForUser(address(wallet), new Decimal(Math.floor(Date.now() / 1000)));
          for (const userFarm of userFarms.values()) {
            const strategyId = String(userFarm.strategyId);
            if (!strategySet.has(strategyId)) continue;

            const activeStake = [...userFarm.activeStakeByDelegatee.values()].reduce((acc, v) => acc.plus(v), new Decimal(0));
            const pendingDeposit = [...userFarm.pendingDepositStakeByDelegatee.values()].reduce((acc, v) => acc.plus(v), new Decimal(0));
            const pendingWithdrawal = [...userFarm.pendingWithdrawalUnstakeByDelegatee.values()].reduce(
              (acc, v) => acc.plus(v),
              new Decimal(0)
            );
            const totalShares = activeStake.plus(pendingDeposit).plus(pendingWithdrawal).toNumber();
            if (Number.isFinite(totalShares) && totalShares > 0) {
              strategySharesByAddress.set(strategyId, (strategySharesByAddress.get(strategyId) ?? 0) + totalShares);
            }
          }
          fetched = true;
          farmsRpcUsed = rpcUrl;
          break;
        } catch (err) {
          sdkErrors.push(`farms ${rpcUrl} (attempt ${attempt + 1}): ${normalizeErr(err)}`);
          await sleep(500);
        }
      }
      if (fetched) break;
    }
  }

  // Claimable rewards from farms user states.
  if (sdkPositions.length > 0) {
    const strategyByAddress = new Map(sdkPositions.map((p) => [p.strategy, p]));
    for (const rpcUrl of sdkRpcUrls) {
      let fetched = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const rpc = createSolanaRpc(rpcUrl);
          const farms = new Farms(rpc);
          const userFarms = await farms.getAllFarmsForUser(address(wallet), new Decimal(Math.floor(Date.now() / 1000)));
          for (const userFarm of userFarms.values()) {
            const strategyId = String(userFarm.strategyId);
            const strategyMeta = strategyByAddress.get(strategyId);
            farmToPositionMeta.set(String(userFarm.farm), {
              positionType: strategyMeta ? "Liquidity" : "Unknown",
              position: strategyMeta ? strategyMeta.pairLabel : "Unknown",
              strategy: strategyMeta?.strategy ?? null
            });

            for (const reward of userFarm.pendingRewards) {
              const mint = String(reward.rewardTokenMint);
              if (mint === "11111111111111111111111111111111") continue;
              const raw = reward.cumulatedPendingRewards.toNumber();
              if (Number.isFinite(raw) && raw > 0) {
                claimableRewardsRawByMint.set(mint, (claimableRewardsRawByMint.get(mint) ?? 0) + raw);
                const decimals = KNOWN_TOKEN_DECIMALS[mint] ?? null;
                const symbol = inferTokenSymbol(mint);
                const nonLiq = inferNonLiquidityPositionLabel(symbol);
                if (!strategyMeta) {
                  farmToPositionMeta.set(String(userFarm.farm), {
                    positionType: nonLiq.positionType,
                    position: nonLiq.position,
                    strategy: null
                  });
                }
                claimableByPosition.push({
                  position: strategyMeta ? strategyMeta.pairLabel : nonLiq.position,
                  positionType: strategyMeta ? "Liquidity" : nonLiq.positionType,
                  strategy: strategyMeta?.strategy ?? null,
                  farm: String(userFarm.farm),
                  mint,
                  symbol,
                  amountRaw: String(raw),
                  amountUi: toUiAmount(raw, decimals)
                });
              }
            }
          }
          fetched = true;
          if (!farmsRpcUsed) farmsRpcUsed = rpcUrl;
          break;
        } catch (err) {
          sdkErrors.push(`claimable farms ${rpcUrl} (attempt ${attempt + 1}): ${normalizeErr(err)}`);
          await sleep(500);
        }
      }
      if (fetched) break;
    }
  }

  const errors: string[] = [];
  if (kvaultPositionsRes.status === "rejected") errors.push(`kvault positions: ${normalizeErr(kvaultPositionsRes.reason)}`);
  if (kvaultRewardsRes.status === "rejected") errors.push(`kvault rewards: ${normalizeErr(kvaultRewardsRes.reason)}`);
  if (farmsTransactionsRes.status === "rejected") errors.push(`farms transactions: ${normalizeErr(farmsTransactionsRes.reason)}`);
  if (sdkPositions.length === 0 && sdkErrors.length > 0) errors.push(`kliquidity sdk: ${sdkErrors.join(" | ")}`);

  const claimableRewards = [...claimableRewardsRawByMint.entries()]
    .map(([mint, raw]) => {
      const decimals = KNOWN_TOKEN_DECIMALS[mint] ?? null;
      const symbol = inferTokenSymbol(mint);
      const uiAmount = toUiAmount(raw, decimals);
      return {
        mint,
        symbol,
        amountRaw: String(raw),
        amountUi: uiAmount
      };
    })
    .sort((a, b) => (b.amountUi ?? 0) - (a.amountUi ?? 0));
  const claimableRewardsByPosition = claimableByPosition.sort((a, b) => (b.amountUi ?? 0) - (a.amountUi ?? 0));

  const txResult = (farmsTransactions as { result?: unknown[] } | null)?.result;
  const claimTxs = (Array.isArray(txResult) ? txResult : [])
    .filter((t) => (t as { instruction?: string }).instruction === "claim")
    .map((t) => t as { token?: string; tokenAmount?: string; usdAmount?: string; createdOn?: string; farm?: string });

  const claimedByMint = new Map<string, { mint: string; symbol: string; amountUi: number; amountUsd: number }>();
  const claimedByPositionType = new Map<string, number>();
  const earliestLiquidityClaimTsByStrategy = new Map<string, number>();
  const claimedByPositionTypeSymbol = new Map<
    string,
    { positionType: string; position: string; strategy: string | null; mint: string; symbol: string; amountUsd: number; amountUi: number }
  >();
  for (const tx of claimTxs) {
    const mint = tx.token ?? "unknown";
    const symbol = inferTokenSymbol(mint);
    const amountUi = Number(tx.tokenAmount ?? 0);
    const amountUsd = Number(tx.usdAmount ?? 0);
    const prev = claimedByMint.get(mint) ?? { mint, symbol, amountUi: 0, amountUsd: 0 };
    prev.amountUi += Number.isFinite(amountUi) ? amountUi : 0;
    prev.amountUsd += Number.isFinite(amountUsd) ? amountUsd : 0;
    claimedByMint.set(mint, prev);

    const farm = tx.farm ?? "";
    const fallbackType = inferNonLiquidityPositionLabel(symbol).positionType;
    const fallbackPosition = inferNonLiquidityPositionLabel(symbol).position;
    const farmMeta = farmToPositionMeta.get(farm);
    const positionType = farmMeta?.positionType ?? fallbackType;
    const position = farmMeta?.position ?? fallbackPosition;
    const strategy = farmMeta?.strategy ?? null;
    if (positionType === "Liquidity" && strategy && tx.createdOn) {
      const ts = Number(new Date(tx.createdOn).getTime());
      if (Number.isFinite(ts) && ts > 0) {
        const prev = earliestLiquidityClaimTsByStrategy.get(strategy);
        if (prev == null || ts < prev) earliestLiquidityClaimTsByStrategy.set(strategy, ts);
      }
    }
    claimedByPositionType.set(positionType, (claimedByPositionType.get(positionType) ?? 0) + (Number.isFinite(amountUsd) ? amountUsd : 0));
    const key = `${positionType}:${position}:${mint}`;
    const prevTyped = claimedByPositionTypeSymbol.get(key) ?? {
      positionType,
      position,
      strategy,
      mint,
      symbol,
      amountUsd: 0,
      amountUi: 0
    };
    prevTyped.amountUsd += Number.isFinite(amountUsd) ? amountUsd : 0;
    prevTyped.amountUi += Number.isFinite(amountUi) ? amountUi : 0;
    claimedByPositionTypeSymbol.set(key, prevTyped);
  }
  const claimedRewards = [...claimedByMint.values()].sort((a, b) => b.amountUsd - a.amountUsd);
  const claimedRewardsByPositionType = [...claimedByPositionType.entries()]
    .map(([positionType, amountUsd]) => ({ positionType, amountUsd }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
  const claimedRewardsByPositionTypeSymbol = [...claimedByPositionTypeSymbol.values()].sort((a, b) => b.amountUsd - a.amountUsd);

  const annualizeApyPct = (pnlUsd: number | null, costBasisUsd: number | null, daysObserved: number | null): number | null => {
    if (pnlUsd == null || costBasisUsd == null || daysObserved == null) return null;
    if (!Number.isFinite(pnlUsd) || !Number.isFinite(costBasisUsd) || !Number.isFinite(daysObserved)) return null;
    if (costBasisUsd <= 0 || daysObserved <= 0) return null;
    const gross = 1 + pnlUsd / costBasisUsd;
    if (!(gross > 0)) return null;
    return (gross ** (365 / daysObserved) - 1) * 100;
  };
  const simpleAprPct = (pnlUsd: number | null, costBasisUsd: number | null, daysObserved: number | null): number | null => {
    if (pnlUsd == null || costBasisUsd == null || daysObserved == null) return null;
    if (!Number.isFinite(pnlUsd) || !Number.isFinite(costBasisUsd) || !Number.isFinite(daysObserved)) return null;
    if (costBasisUsd <= 0 || daysObserved <= 0) return null;
    return ((pnlUsd / costBasisUsd) * (365 / daysObserved)) * 100;
  };

  const strategyValuations = await Promise.all(
    sdkPositions.map(async (position) => {
      const strategy = position.strategy;
      const pnlUrl = `${kaminoBase}/v2/strategies/${strategy}/shareholders/${wallet}/pnl?env=${encodeURIComponent(kaminoEnv)}`;
      const feesUrl = `${kaminoBase}/v2/strategies/${strategy}/shareholders/${wallet}/fees-and-rewards/latest-position?env=${encodeURIComponent(
        kaminoEnv
      )}`;
      const pnlHistoryUrl = `${kaminoBase}/v2/strategies/${strategy}/shareholders/${wallet}/pnl/history?env=${encodeURIComponent(
        kaminoEnv
      )}`;

      const [pnlRes, feesRes, pnlHistoryRes] = await Promise.allSettled([fetchJson(pnlUrl), fetchJson(feesUrl), fetchJson(pnlHistoryUrl)]);
      const rowErrors: string[] = [];

      let valueUsd: number | null = null;
      let pnlUsd: number | null = null;
      let feesAndRewardsUsd: number | null = null;
      let feesAndRewardsUsdFarmsStaked: number | null = null;
      let costBasisUsd: number | null = null;
      let sharePriceUsd: number | null = null;
      let tokenAPriceUsd: number | null = null;
      let tokenBPriceUsd: number | null = null;
      let valueUsdFarmsStaked: number | null = null;
      let pnlUsdFarmsStaked: number | null = null;
      let costBasisUsdFarmsStaked: number | null = null;
      let depositsFromHistoryUsd: number | null = null;
      let withdrawalsFromHistoryUsd: number | null = null;
      let netDepositsFromHistoryUsd: number | null = null;
      let tokenAAmountUiFarmsStaked: number | null = null;
      let tokenBAmountUiFarmsStaked: number | null = null;
      let tokenAValueUsdFarmsStaked: number | null = null;
      let tokenBValueUsdFarmsStaked: number | null = null;
      let daysObserved: number | null = null;
      const sharesInFarms = strategySharesByAddress.get(strategy) ?? null;

      if (pnlRes.status === "fulfilled") {
        const pnlData = pnlRes.value as {
          totalPnl?: { usd?: string | number };
          totalCostBasis?: { usd?: string | number };
        };
        pnlUsd = parseMaybeNumber(pnlData.totalPnl?.usd);
        costBasisUsd = parseMaybeNumber(pnlData.totalCostBasis?.usd);
        valueUsd = sumKnown([costBasisUsd, pnlUsd]);
      } else {
        rowErrors.push(`pnl: ${normalizeErr(pnlRes.reason)}`);
      }

      if (feesRes.status === "fulfilled") {
        const feesData = feesRes.value as Record<string, unknown>;
        const feeKeys = [
          "feesAEarnedUsd",
          "feesBEarnedUsd",
          "rewards0EarnedUsd",
          "rewards1EarnedUsd",
          "rewards2EarnedUsd",
          "kaminoRewards0EarnedUsd",
          "kaminoRewards1EarnedUsd",
          "kaminoRewards2EarnedUsd"
        ];
        feesAndRewardsUsd = sumKnown(feeKeys.map((k) => parseMaybeNumber(feesData[k])));
      } else {
        rowErrors.push(`fees: ${normalizeErr(feesRes.reason)}`);
      }

      if (pnlHistoryRes.status === "fulfilled") {
        const history = ((pnlHistoryRes.value as { history?: unknown[] }).history ?? []) as Array<{
          timestamp?: string | number;
          type?: string;
          investment?: { usd?: string | number };
          sharePrice?: { usd?: string | number };
          tokenPrice?: { a?: string | number; b?: string | number };
        }>;
        const parseTs = (value: string | number | undefined): number => {
          if (value == null) return NaN;
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) {
            // Kamino may return unix ms directly.
            return n > 10_000_000_000 ? n : n * 1000;
          }
          const iso = Number(new Date(String(value)).getTime());
          return Number.isFinite(iso) ? iso : NaN;
        };
        const historyWithTs = history
          .map((row) => ({ row, ts: parseTs(row.timestamp) }))
          .filter((x) => Number.isFinite(x.ts) && x.ts > 0);
        const buyRows = history.filter((row) => String((row as { type?: string }).type ?? "").toLowerCase() === "buy");
        const sellRows = history.filter((row) => String((row as { type?: string }).type ?? "").toLowerCase() === "sell");
        const sumInvestmentUsd = (rows: Array<{ investment?: { usd?: string | number } }>) =>
          rows.reduce((acc, row) => acc + (parseMaybeNumber(row.investment?.usd) ?? 0), 0);
        depositsFromHistoryUsd = sumInvestmentUsd(buyRows);
        withdrawalsFromHistoryUsd = sumInvestmentUsd(sellRows);
        netDepositsFromHistoryUsd = depositsFromHistoryUsd - withdrawalsFromHistoryUsd;
        const firstTsMs = historyWithTs.length ? Math.min(...historyWithTs.map((x) => x.ts)) : NaN;
        const lastRow = historyWithTs.length
          ? historyWithTs.reduce((acc, cur) => (cur.ts > acc.ts ? cur : acc)).row
          : history.length > 0
            ? history[history.length - 1]
            : null;
        const nowMs = Date.now();
        daysObserved =
          Number.isFinite(firstTsMs) && firstTsMs > 0 ? Math.max(1 / 24, (nowMs - firstTsMs) / (24 * 60 * 60 * 1000)) : null;
        sharePriceUsd = parseMaybeNumber(lastRow?.sharePrice?.usd);
        tokenAPriceUsd = parseMaybeNumber(lastRow?.tokenPrice?.a);
        tokenBPriceUsd = parseMaybeNumber(lastRow?.tokenPrice?.b);
      } else {
        rowErrors.push(`pnl history: ${normalizeErr(pnlHistoryRes.reason)}`);
      }

      if (sharesInFarms && sharePriceUsd && valueUsd && valueUsd > 0) {
        valueUsdFarmsStaked = sharesInFarms * sharePriceUsd;
        // Keep PnL/fees from Kamino shareholder endpoints unscaled; scaling can overstate these.
        // Use farms-staked value only for current position value.
        pnlUsdFarmsStaked = pnlUsd;
        feesAndRewardsUsdFarmsStaked = feesAndRewardsUsd;
        costBasisUsdFarmsStaked =
          valueUsdFarmsStaked != null && pnlUsdFarmsStaked != null ? valueUsdFarmsStaked - pnlUsdFarmsStaked : costBasisUsd;
      }

      if (
        sharesInFarms != null &&
        position.sharesIssuedUi != null &&
        position.sharesIssuedUi > 0 &&
        position.totalTokenAUi != null &&
        position.totalTokenBUi != null
      ) {
        const shareRatio = sharesInFarms / position.sharesIssuedUi;
        tokenAAmountUiFarmsStaked = position.totalTokenAUi * shareRatio;
        tokenBAmountUiFarmsStaked = position.totalTokenBUi * shareRatio;
        if (tokenAPriceUsd != null) tokenAValueUsdFarmsStaked = tokenAAmountUiFarmsStaked * tokenAPriceUsd;
        if (tokenBPriceUsd != null) tokenBValueUsdFarmsStaked = tokenBAmountUiFarmsStaked * tokenBPriceUsd;
      }

      const apyPnlUsd = pnlUsdFarmsStaked ?? pnlUsd;
      const apyCostBasisUsd = costBasisUsdFarmsStaked ?? costBasisUsd;
      const unrealizedApyPct = simpleAprPct(apyPnlUsd, apyCostBasisUsd, daysObserved);

      return {
        strategy,
        pairLabel: position.pairLabel,
        tokenAMint: position.tokenAMint,
        tokenBMint: position.tokenBMint,
        tokenASymbol: position.tokenASymbol,
        tokenBSymbol: position.tokenBSymbol,
        tokenAPriceUsd,
        tokenBPriceUsd,
        sharesInFarms,
        sharePriceUsd,
        valueUsd,
        pnlUsd,
        costBasisUsd,
        valueUsdFarmsStaked,
        pnlUsdFarmsStaked,
        costBasisUsdFarmsStaked,
        tokenAAmountUiFarmsStaked,
        tokenBAmountUiFarmsStaked,
        tokenAValueUsdFarmsStaked,
        tokenBValueUsdFarmsStaked,
        feesAndRewardsUsdFarmsStaked,
        depositsFromHistoryUsd,
        withdrawalsFromHistoryUsd,
        netDepositsFromHistoryUsd,
        feesAndRewardsUsd,
        daysObserved,
        unrealizedApyPct,
        endpoints: {
          pnlUrl,
          feesUrl,
          pnlHistoryUrl
        },
        error: rowErrors.length > 0 ? rowErrors.join(" | ") : null
      };
    })
  );

  const claimedPriceBySymbol = new Map(
    claimedRewards
      .filter((r) => Number(r.amountUi) > 0 && Number(r.amountUsd) > 0)
      .map((r) => [r.symbol, Number(r.amountUsd) / Number(r.amountUi)] as const)
  );
  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);
  const claimedLiquidityRewardsByStrategy = new Map<string, number>();
  for (const row of claimedRewardsByPositionTypeSymbol) {
    if (row.positionType !== "Liquidity") continue;
    if (!row.strategy) continue;
    const usd = Number(row.amountUsd ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    claimedLiquidityRewardsByStrategy.set(row.strategy, (claimedLiquidityRewardsByStrategy.get(row.strategy) ?? 0) + usd);
  }

  const strategyValuationsWithRewards = strategyValuations.map((v) => {
    const strategyId = String(v.strategy ?? "");
    const claimableRows = claimableRewardsByPosition.filter((r) => r.positionType === "Liquidity" && r.strategy === strategyId);
    const unclaimedRewardsUsd = claimableRows.reduce((acc, row) => {
      const amount = Number(row.amountUi ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return acc;
      if (stableSymbols.has(row.symbol)) return acc + amount;
      if (row.symbol === v.tokenASymbol && Number.isFinite(Number(v.tokenAPriceUsd))) return acc + amount * Number(v.tokenAPriceUsd);
      if (row.symbol === v.tokenBSymbol && Number.isFinite(Number(v.tokenBPriceUsd))) return acc + amount * Number(v.tokenBPriceUsd);
      const px = claimedPriceBySymbol.get(row.symbol);
      return acc + (px != null && Number.isFinite(px) ? amount * px : 0);
    }, 0);
    const claimedRewardsUsd = claimedLiquidityRewardsByStrategy.get(strategyId) ?? 0;
    const totalRewardsUsd = claimedRewardsUsd + unclaimedRewardsUsd;
    const apyPnlUsd = v.pnlUsdFarmsStaked ?? v.pnlUsd ?? null;
    const apyCostBasisUsd = v.costBasisUsdFarmsStaked ?? v.costBasisUsd ?? null;
    const feesPnlUsd = v.feesAndRewardsUsdFarmsStaked ?? v.feesAndRewardsUsd ?? null;
    const priceAndRatioPnlUsd = apyPnlUsd != null && feesPnlUsd != null ? apyPnlUsd - feesPnlUsd : null;
    const aprPlusRewardsPnlUsd =
      apyPnlUsd != null && priceAndRatioPnlUsd != null
        ? apyPnlUsd - priceAndRatioPnlUsd + totalRewardsUsd
        : feesPnlUsd != null
          ? feesPnlUsd + totalRewardsUsd
          : null;
    const historyNetDepositsUsd = v.netDepositsFromHistoryUsd ?? null;
    const nowMs = Date.now();
    const claimFallbackDays = (() => {
      const ts = earliestLiquidityClaimTsByStrategy.get(strategyId);
      if (ts == null || !Number.isFinite(ts) || ts <= 0) return null;
      return Math.max(1 / 24, (nowMs - ts) / (24 * 60 * 60 * 1000));
    })();
    const daysObserved = v.daysObserved ?? claimFallbackDays ?? null;
    const apyDaysObserved = daysObserved;
    const unrealizedApyPct = v.unrealizedApyPct ?? simpleAprPct(apyPnlUsd, apyCostBasisUsd, apyDaysObserved);
    const unrealizedApyWithRewardsPct = simpleAprPct(
      aprPlusRewardsPnlUsd,
      apyCostBasisUsd,
      apyDaysObserved
    );
    const feesApyPct = annualizeApyPct(feesPnlUsd, apyCostBasisUsd, apyDaysObserved);
    const rewardsApyPct = annualizeApyPct(totalRewardsUsd, apyCostBasisUsd, apyDaysObserved);
    const totalApyPct = annualizeApyPct(aprPlusRewardsPnlUsd, apyCostBasisUsd, apyDaysObserved);
    return {
      ...v,
      daysObserved,
      unrealizedApyPct,
      unrealizedApyWithRewardsPct,
      feesApyPct,
      rewardsApyPct,
      totalApyPct,
      rewardsClaimedUsdLiquidity: claimedRewardsUsd,
      rewardsUnclaimedUsdLiquidity: unclaimedRewardsUsd,
      rewardsTotalUsdLiquidity: totalRewardsUsd,
      feesPnlUsd,
      priceAndRatioPnlUsd,
      historyNetDepositsUsd,
      unreconciledCostBasisUsd:
        apyCostBasisUsd != null && historyNetDepositsUsd != null ? apyCostBasisUsd - historyNetDepositsUsd : null
    };
  });

  return {
    source: "kaminoLiquidity",
    ok: errors.length < 4,
    endpointUsed: kvaultPositionsUrl,
    data: {
      endpoints: {
        kvaultPositionsUrl,
        kvaultRewardsUrl,
        farmsTransactionsUrl
      },
      kvaultPositions,
      kvaultRewards,
      farmsTransactions,
      sdkRpcUsed,
      farmsRpcUsed,
      sdkStrategyPositions: sdkPositions,
      strategySharesByAddress: Object.fromEntries(strategySharesByAddress.entries()),
      rewards: {
        claimable: claimableRewards,
        claimableByPosition: claimableRewardsByPosition,
        claimed: claimedRewards,
        claimedByPositionType: claimedRewardsByPositionType,
        claimedByPositionTypeSymbol: claimedRewardsByPositionTypeSymbol,
        claimTxCount: claimTxs.length
      },
      strategyValuations: strategyValuationsWithRewards
    },
    error: errors.length > 0 ? errors.join(" | ") : null
  };
}

async function getSpotPositions(connection: Connection, wallet: PublicKey) {
  const [lamports, tokenAccountsLegacyResp, tokenAccounts2022Resp] = await Promise.all([
    connection.getBalance(wallet),
    connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM_ID })
  ]);

  const allParsedAccounts = [...tokenAccountsLegacyResp.value, ...tokenAccounts2022Resp.value];
  const splTokensBase: SpotTokenPosition[] = allParsedAccounts
    .map((it) => {
      const parsed = it.account.data.parsed.info;
      const tokenAmount = parsed.tokenAmount;
      const amountUi = Number(tokenAmount.uiAmount ?? 0);

      return {
        mint: String(parsed.mint),
        amountRaw: String(tokenAmount.amount),
        decimals: Number(tokenAmount.decimals ?? 0),
        amountUi,
        symbol: inferTokenSymbol(String(parsed.mint))
      } satisfies SpotTokenPosition;
    })
    .filter((t) => t.amountUi > 0);

  const rpcUrlForMetadata = process.env.HELIUS_RPC_URL ?? process.env.SOLANA_RPC_URL ?? "";
  const shouldTryMetadata = process.env.ENABLE_TOKEN_METADATA !== "false" && rpcUrlForMetadata.length > 0;
  const splTokens = shouldTryMetadata
    ? await Promise.all(
        splTokensBase.map(async (t) => {
          const metadata = await fetchDasAssetMetadata(rpcUrlForMetadata, t.mint);
          const known = KNOWN_TOKEN_SYMBOLS[t.mint];
          const symbolFromMetadata = metadata.symbol?.trim() || null;
          return {
            ...t,
            symbol: known ?? symbolFromMetadata ?? t.symbol,
            metadata
          };
        })
      )
    : splTokensBase.map((t) => ({
        ...t,
        metadata: {
          source: "none" as const,
          name: null,
          symbol: null,
          description: null,
          interface: null,
          tokenStandard: null,
          isNft: null,
          confidence: "low" as const
        }
      }));

  return {
    nativeSol: lamports / LAMPORTS_PER_SOL,
    splTokens
  };
}

export async function fetchWalletPositions(walletStr: string): Promise<WalletPositions> {
  const wallet = new PublicKey(walletStr);
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const [slot, spot, jupiterPerps, kaminoLend, kaminoLiquidity] = await Promise.all([
    connection.getSlot("confirmed"),
    getSpotPositions(connection, wallet),
    getJupiterPerpsDetails(walletStr),
    getKaminoLendDetails(walletStr),
    getKaminoLiquidityDetails(walletStr)
  ]);

  const result: WalletPositions = {
    wallet: walletStr,
    slot,
    rpc,
    spot,
    jupiterPerps,
    kaminoLend,
    kaminoLiquidity
  };

  return result;
}

export function buildSummary(result: WalletPositions) {
  const kaminoLiquidityData = (result.kaminoLiquidity.data ?? {}) as {
    sdkStrategyPositions?: Array<{ pairLabel?: string; strategy?: string }>;
    rewards?: {
      claimable?: Array<{ mint: string; symbol: string; amountRaw: string; amountUi: number | null }>;
      claimableByPosition?: Array<{
        position: string;
        positionType: string;
        strategy: string | null;
        farm: string;
        mint: string;
        symbol: string;
        amountRaw: string;
        amountUi: number | null;
      }>;
      claimed?: Array<{ mint: string; symbol: string; amountUi: number; amountUsd: number }>;
      claimedByPositionType?: Array<{ positionType: string; amountUsd: number }>;
      claimedByPositionTypeSymbol?: Array<{
        positionType: string;
        position: string;
        strategy: string | null;
        mint: string;
        symbol: string;
        amountUsd: number;
        amountUi: number;
      }>;
      claimTxCount?: number;
    };
    strategyValuations?: Array<{
      strategy?: string;
      tokenAMint?: string;
      tokenBMint?: string;
      tokenASymbol?: string;
      tokenBSymbol?: string;
      tokenAPriceUsd?: number | null;
      tokenBPriceUsd?: number | null;
      tokenAValueUsdFarmsStaked?: number | null;
      tokenBValueUsdFarmsStaked?: number | null;
      valueUsd?: number | null;
      pnlUsd?: number | null;
      valueUsdFarmsStaked?: number | null;
      pnlUsdFarmsStaked?: number | null;
      pairLabel?: string;
    }>;
  };
  const kaminoPairs = (kaminoLiquidityData.sdkStrategyPositions ?? [])
    .map((p) => ({ pair: p.pairLabel ?? "unknown", strategy: p.strategy ?? "unknown" }))
    .filter((p) => p.pair !== "unknown");

  const jupRaw = ((result.jupiterPerps.data as { raw?: { elements?: unknown[] } })?.raw ?? {}) as {
    elements?: Array<{ type?: string; value?: number; data?: { isolated?: { positions?: unknown[] } } }>;
  };
  const leverageElement = (jupRaw.elements ?? []).find((e) => e?.type === "leverage");
  const leveragePositions = (leverageElement?.data?.isolated?.positions ?? []) as Array<{
    value?: number;
    pnlValue?: number;
  }>;
  const jupiterPerpsValueUsd = leveragePositions.reduce((acc, p) => acc + (p.value ?? 0), 0);
  const jupiterPerpsPnlUsd = leveragePositions.reduce((acc, p) => acc + (p.pnlValue ?? 0), 0);
  const jupiterPerpsSummary = leverageElement
    ? {
        valueUsd: jupiterPerpsValueUsd || (leverageElement.value ?? 0),
        pnlUsd: jupiterPerpsPnlUsd,
        positionCount: leveragePositions.length
      }
    : null;

  const kaminoLendData = (result.kaminoLend.data ?? {}) as {
    positionsByMarket?: Array<{
      obligations?: unknown[];
      marketName?: string;
      market?: string;
      reserveMetrics?: Array<{ reserve: string; symbol: string; mint: string | null; assetPriceUsd: number | null }>;
    }>;
  };
  const lendMarketsWithPositions = (kaminoLendData.positionsByMarket ?? []).filter((m) =>
    Array.isArray(m.obligations) ? m.obligations.length > 0 : false
  );
  const totalObligations = lendMarketsWithPositions.reduce(
    (acc, m) => acc + (Array.isArray(m.obligations) ? m.obligations.length : 0),
    0
  );
  const obligationRows = lendMarketsWithPositions.flatMap((market) => {
    if (!Array.isArray(market.obligations)) return [];
    return market.obligations.map((ob) => {
      const net = Number((ob as { refreshedStats?: { netAccountValue?: string | number } }).refreshedStats?.netAccountValue ?? 0);
      const address =
        (ob as { obligationAddress?: string; state?: { owner?: string } }).obligationAddress ??
        (ob as { state?: { owner?: string } }).state?.owner ??
        "unknown";
      const analytics = (
        ob as {
          analytics?: {
            pnlUsd?: number | null;
            investedUsd?: number | null;
            daysObserved?: number | null;
            daysCapitalWeighted?: number | null;
            unrealizedApyPct?: number | null;
            rewardsClaimedUsd?: number | null;
            unrealizedApyWithRewardsPct?: number | null;
            currentSupplyApyPct?: number | null;
            currentBorrowApyPct?: number | null;
            currentNetInterestApyPct?: number | null;
            currentSupplyContributionNetApyPct?: number | null;
            currentBorrowCostNetApyPct?: number | null;
            currentSupplyApySource?: string | null;
            onycLiveApyPct?: number | null;
            currentBorrowRewardCreditApyPctLive?: number | null;
            currentCombinedBorrowApyPctLive?: number | null;
            currentRolling2hBorrowApyPct?: number | null;
            rolling2hBorrowApySeries?: Array<{
              ts: number;
              fees2hUsd: number;
              borrowUsd: number;
              apyPct: number | null;
            }>;
            interestPaidRawSeries?: Array<{
              ts: number;
              usdFees: number;
            }>;
            combinedBorrowApyPctEst?: number | null;
            borrowRewardCreditApyPctEst?: number | null;
            reserveApyBreakdown?: Array<{
              side: "supply" | "borrow";
              reserve: string;
              symbol: string;
              apyPct: number | null;
            }>;
            transactions?: unknown[];
          };
        }
      ).analytics;
      return {
        obligation: address,
        market: market.marketName ?? market.market ?? "unknown",
        netValueUsd: Number.isFinite(net) ? net : 0,
        pnlUsd: parseMaybeNumber(analytics?.pnlUsd),
        investedUsd: parseMaybeNumber(analytics?.investedUsd),
        daysObserved: parseMaybeNumber(analytics?.daysObserved),
        daysCapitalWeighted: parseMaybeNumber(analytics?.daysCapitalWeighted),
        unrealizedApyPct: parseMaybeNumber(analytics?.unrealizedApyPct),
        rewardsClaimedUsd: parseMaybeNumber(analytics?.rewardsClaimedUsd),
        unrealizedApyWithRewardsPct: parseMaybeNumber(analytics?.unrealizedApyWithRewardsPct),
        currentSupplyApyPct: parseMaybeNumber(analytics?.currentSupplyApyPct),
        currentBorrowApyPct: parseMaybeNumber(analytics?.currentBorrowApyPct),
        currentNetInterestApyPct: parseMaybeNumber(analytics?.currentNetInterestApyPct),
        currentSupplyContributionNetApyPct: parseMaybeNumber(analytics?.currentSupplyContributionNetApyPct),
        currentBorrowCostNetApyPct: parseMaybeNumber(analytics?.currentBorrowCostNetApyPct),
        currentSupplyApySource:
          typeof (analytics as { currentSupplyApySource?: unknown } | undefined)?.currentSupplyApySource === "string"
            ? String((analytics as { currentSupplyApySource?: string }).currentSupplyApySource)
            : null,
        onycLiveApyPct: parseMaybeNumber(analytics?.onycLiveApyPct),
        currentBorrowRewardCreditApyPctLive: parseMaybeNumber(analytics?.currentBorrowRewardCreditApyPctLive),
        currentCombinedBorrowApyPctLive: parseMaybeNumber(analytics?.currentCombinedBorrowApyPctLive),
        currentRolling2hBorrowApyPct: parseMaybeNumber(analytics?.currentRolling2hBorrowApyPct),
        rolling2hBorrowApySeries: Array.isArray((analytics as { rolling2hBorrowApySeries?: unknown[] } | undefined)?.rolling2hBorrowApySeries)
          ? ((analytics as { rolling2hBorrowApySeries?: unknown[] }).rolling2hBorrowApySeries ?? [])
          : [],
        interestPaidRawSeries: Array.isArray((analytics as { interestPaidRawSeries?: unknown[] } | undefined)?.interestPaidRawSeries)
          ? ((analytics as { interestPaidRawSeries?: unknown[] }).interestPaidRawSeries ?? [])
          : [],
        combinedBorrowApyPctEst: parseMaybeNumber(analytics?.combinedBorrowApyPctEst),
        borrowRewardCreditApyPctEst: parseMaybeNumber(analytics?.borrowRewardCreditApyPctEst),
        reserveApyBreakdown: Array.isArray((analytics as { reserveApyBreakdown?: unknown[] } | undefined)?.reserveApyBreakdown)
          ? ((analytics as { reserveApyBreakdown?: unknown[] }).reserveApyBreakdown ?? [])
          : [],
        transactions: Array.isArray((analytics as { transactions?: unknown[] } | undefined)?.transactions)
          ? ((analytics as { transactions?: unknown[] }).transactions ?? [])
          : []
      };
    });
  });
  const kaminoLendNetValueUsd = lendMarketsWithPositions.reduce((acc, market) => {
    if (!Array.isArray(market.obligations)) return acc;
    return (
      acc +
      market.obligations.reduce<number>((acc2, ob) => {
        const stats = (ob as { refreshedStats?: { netAccountValue?: string | number } }).refreshedStats;
        const v = Number(stats?.netAccountValue ?? 0);
        return Number.isFinite(v) ? acc2 + v : acc2;
      }, 0)
    );
  }, 0);
  const lendTokenPrices = (() => {
    const byMint = new Map<string, { symbol: string; mint: string; priceUsd: number }>();
    const bySymbol = new Map<string, { symbol: string; mint: string | null; priceUsd: number }>();
    for (const market of lendMarketsWithPositions) {
      const rows = Array.isArray(market.reserveMetrics) ? market.reserveMetrics : [];
      for (const row of rows) {
        const p = Number(row.assetPriceUsd ?? NaN);
        if (!Number.isFinite(p) || p <= 0) continue;
        const symbol = String(row.symbol ?? "");
        const symbolKey = symbol.toUpperCase();
        if (row.mint && !byMint.has(row.mint)) byMint.set(row.mint, { symbol, mint: row.mint, priceUsd: p });
        if (symbol && !bySymbol.has(symbolKey)) bySymbol.set(symbolKey, { symbol, mint: row.mint ?? null, priceUsd: p });
      }
    }
    const txPriceBuckets = new Map<string, { symbol: string; prices: number[] }>();
    for (const ob of obligationRows) {
      const txs = Array.isArray(ob.transactions) ? ob.transactions : [];
      for (const tx of txs) {
        const symbol = String((tx as { liquidityToken?: unknown }).liquidityToken ?? "");
        const amount = Number((tx as { liquidityTokenAmount?: unknown }).liquidityTokenAmount ?? NaN);
        const usd = Number((tx as { liquidityUsdValue?: unknown }).liquidityUsdValue ?? NaN);
        if (!symbol || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(usd) || usd <= 0) continue;
        const px = usd / amount;
        if (!Number.isFinite(px) || px <= 0) continue;
        const key = symbol.toUpperCase();
        const bucket = txPriceBuckets.get(key) ?? { symbol, prices: [] };
        bucket.prices.push(px);
        txPriceBuckets.set(key, bucket);
      }
    }
    for (const [symbolKey, bucket] of txPriceBuckets.entries()) {
      if (bySymbol.has(symbolKey) || bucket.prices.length === 0) continue;
      bucket.prices.sort((a, b) => a - b);
      const mid = Math.floor(bucket.prices.length / 2);
      const median =
        bucket.prices.length % 2 === 1 ? bucket.prices[mid] : (bucket.prices[mid - 1] + bucket.prices[mid]) / 2;
      if (Number.isFinite(median) && median > 0) {
        bySymbol.set(symbolKey, { symbol: bucket.symbol, mint: null, priceUsd: median });
      }
    }
    return {
      byMint: [...byMint.values()],
      bySymbol: [...bySymbol.values()]
    };
  })();

  const knownTotals = {
    totalValueUsd: (jupiterPerpsSummary?.valueUsd ?? 0) + kaminoLendNetValueUsd,
    totalPnlUsd: jupiterPerpsSummary?.pnlUsd ?? 0
  };

  const liquidityValuations = kaminoLiquidityData.strategyValuations ?? [];
  const kaminoLiquidityValueUsd = sumKnown(liquidityValuations.map((v) => parseMaybeNumber(v.valueUsd)));
  const kaminoLiquidityPnlUsd = sumKnown(liquidityValuations.map((v) => parseMaybeNumber(v.pnlUsd)));
  const kaminoLiquidityValueUsdFarmsStaked = sumKnown(liquidityValuations.map((v) => parseMaybeNumber(v.valueUsdFarmsStaked)));
  const kaminoLiquidityPnlUsdFarmsStaked = sumKnown(liquidityValuations.map((v) => parseMaybeNumber(v.pnlUsdFarmsStaked)));
  const claimableRewards = kaminoLiquidityData.rewards?.claimable ?? [];
  const claimedRewards = kaminoLiquidityData.rewards?.claimed ?? [];
  const claimableByPosition = kaminoLiquidityData.rewards?.claimableByPosition ?? [];
  const hasLiquidityValuation = liquidityValuations.length > 0 && kaminoLiquidityValueUsd > 0;
  const hasLiquidityValuationFarmsStaked = liquidityValuations.some((v) => parseMaybeNumber(v.valueUsdFarmsStaked) != null);

  const strategyByAddress = new Map(
    liquidityValuations
      .map((v) => [v.strategy ?? "", v] as const)
      .filter((v) => v[0] !== "")
  );
  const claimedPriceBySymbol = new Map(
    claimedRewards
      .filter((r) => Number(r.amountUi) > 0 && Number(r.amountUsd) > 0)
      .map((r) => [r.symbol, Number(r.amountUsd) / Number(r.amountUi)] as const)
  );
  const stableSymbols = new Set(["USDC", "USDG", "USDS"]);

  function estimateClaimableRowUsd(row: {
    symbol?: string;
    amountUi?: number | null;
    strategy?: string | null;
  }): number | null {
    const amount = Number(row.amountUi ?? NaN);
    if (!Number.isFinite(amount)) return null;
    const symbol = row.symbol ?? "";
    if (stableSymbols.has(symbol)) return amount;

    const strategy = row.strategy ? strategyByAddress.get(row.strategy) : null;
    if (strategy) {
      if (symbol === strategy.tokenASymbol) {
        const p = parseMaybeNumber(strategy.tokenAPriceUsd);
        if (p != null) return amount * p;
      }
      if (symbol === strategy.tokenBSymbol) {
        const p = parseMaybeNumber(strategy.tokenBPriceUsd);
        if (p != null) return amount * p;
      }
    }

    const claimedPrice = claimedPriceBySymbol.get(symbol);
    if (claimedPrice != null && Number.isFinite(claimedPrice)) return amount * claimedPrice;
    return null;
  }

  const claimableRewardsValueUsd = sumKnown(claimableByPosition.map((row) => estimateClaimableRowUsd(row)));

  const allTotals = {
    totalValueUsd: knownTotals.totalValueUsd + (hasLiquidityValuation ? kaminoLiquidityValueUsd : 0),
    totalPnlUsd: knownTotals.totalPnlUsd + (hasLiquidityValuation ? kaminoLiquidityPnlUsd : 0)
  };
  const allTotalsFarmsStaked = {
    totalValueUsd: knownTotals.totalValueUsd + (hasLiquidityValuationFarmsStaked ? kaminoLiquidityValueUsdFarmsStaked : 0),
    totalPnlUsd: knownTotals.totalPnlUsd + (hasLiquidityValuationFarmsStaked ? kaminoLiquidityPnlUsdFarmsStaked : 0)
  };

  return {
    wallet: result.wallet,
    slot: result.slot,
    spot: {
      nativeSol: result.spot.nativeSol,
      tokenCount: result.spot.splTokens.length,
      tokens: result.spot.splTokens
        .map((t) => ({
          symbol: t.symbol ?? inferTokenSymbol(t.mint),
          mint: t.mint,
          amountUi: t.amountUi,
          amountRaw: t.amountRaw,
          decimals: t.decimals,
          metadata: t.metadata ?? null
        }))
        .sort((a, b) => b.amountUi - a.amountUi)
    },
    jupiterPerps: {
      ok: result.jupiterPerps.ok,
      summary: jupiterPerpsSummary
    },
    kaminoLend: {
      ok: result.kaminoLend.ok,
      marketsWithPositions: lendMarketsWithPositions.length,
      totalObligations,
      netValueUsd: kaminoLendNetValueUsd,
      tokenPrices: lendTokenPrices,
      obligations: obligationRows
    },
    kaminoLiquidity: {
      ok: result.kaminoLiquidity.ok,
      strategyPairs: kaminoPairs,
      valueUsd: hasLiquidityValuation ? kaminoLiquidityValueUsd : null,
      pnlUsd: hasLiquidityValuation ? kaminoLiquidityPnlUsd : null,
      valueUsdFarmsStaked: hasLiquidityValuationFarmsStaked ? kaminoLiquidityValueUsdFarmsStaked : null,
      pnlUsdFarmsStaked: hasLiquidityValuationFarmsStaked ? kaminoLiquidityPnlUsdFarmsStaked : null,
      rewards: {
        claimable: claimableRewards,
        claimableByPosition: kaminoLiquidityData.rewards?.claimableByPosition ?? [],
        claimed: claimedRewards,
        claimedByPositionType: kaminoLiquidityData.rewards?.claimedByPositionType ?? [],
        claimedByPositionTypeSymbol: kaminoLiquidityData.rewards?.claimedByPositionTypeSymbol ?? [],
        claimTxCount: kaminoLiquidityData.rewards?.claimTxCount ?? 0,
        claimableValueUsd: claimableRewardsValueUsd
      },
      strategyValuations: liquidityValuations
    },
    totals: {
      knownValueUsd: knownTotals.totalValueUsd,
      knownPnlUsd: knownTotals.totalPnlUsd,
      valueUsd: allTotals.totalValueUsd,
      pnlUsd: allTotals.totalPnlUsd,
      valueUsdWithClaimableRewards: allTotals.totalValueUsd + claimableRewardsValueUsd,
      valueUsdFarmsStaked: hasLiquidityValuationFarmsStaked ? allTotalsFarmsStaked.totalValueUsd : null,
      pnlUsdFarmsStaked: hasLiquidityValuationFarmsStaked ? allTotalsFarmsStaked.totalPnlUsd : null,
      valueUsdFarmsStakedWithClaimableRewards: hasLiquidityValuationFarmsStaked
        ? allTotalsFarmsStaked.totalValueUsd + claimableRewardsValueUsd
        : null,
      note: hasLiquidityValuation
        ? "Totals include Kamino liquidity valuation from strategy shareholder PnL endpoints."
        : "Totals exclude Kamino liquidity USD/PnL when valuation data is unavailable."
    }
  };
}

async function main() {
  const walletStr = parseWalletArg();
  const outputMode = parseOutputMode();
  const result = await fetchWalletPositions(walletStr);

  if (outputMode === "summary") {
    console.log(JSON.stringify(buildSummary(result), null, 2));
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
