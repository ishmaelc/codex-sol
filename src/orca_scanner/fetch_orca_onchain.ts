import { Connection, PublicKey } from "@solana/web3.js";
import type { OnchainPoolEnrichment, OrcaApiPool } from "./types.js";

type EnrichOptions = {
  rpcUrl?: string;
  commitment?: "processed" | "confirmed" | "finalized";
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function approxDepth(pool: OrcaApiPool): { d1: number; d2: number; note: string } {
  const tvl = Math.max(0, pool.tvlUsd);
  const vol = Math.max(0, pool.stats24h.volume);
  const tickSpacing = Math.max(1, pool.tickSpacing || 1);
  const liquidityMag = pool.liquidity > 0 ? Math.log10(pool.liquidity + 1) : 0;
  const turnover = tvl > 0 ? vol / tvl : 0;

  // Heuristic depth proxy when we don't parse Orca tick arrays on-chain in this repo.
  // Uses TVL, observed turnover, raw liquidity magnitude, and tick spacing concentration.
  const concentration = clamp(16 / tickSpacing, 0.2, 3);
  const liquidityFactor = clamp(liquidityMag / 8, 0.35, 1.5);
  const turnoverFactor = clamp(0.8 + Math.log10(1 + turnover * 10), 0.6, 1.8);
  const base = tvl * 0.015 * concentration * liquidityFactor * turnoverFactor;

  return {
    d1: Math.max(0, base),
    d2: Math.max(0, base * 1.9),
    note:
      "Approximation (TVL/liquidity/tick-spacing heuristic). Tick arrays are not parsed yet in this implementation."
  };
}

export async function enrichPoolsOnchain(
  pools: OrcaApiPool[],
  opts: EnrichOptions = {}
): Promise<Map<string, OnchainPoolEnrichment>> {
  const rpcEndpoint = (opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com").trim();
  const connection = new Connection(rpcEndpoint, opts.commitment ?? "confirmed");
  const out = new Map<string, OnchainPoolEnrichment>();

  const keys: Array<{ address: string; pubkey: PublicKey }> = [];
  for (const pool of pools) {
    try {
      keys.push({ address: pool.address, pubkey: new PublicKey(pool.address) });
    } catch {
      const heuristic = approxDepth(pool);
      out.set(pool.address, {
        poolAddress: pool.address,
        validated: false,
        validationNote: "Invalid pool public key",
        rpcEndpoint,
        depthUsd1Pct: heuristic.d1,
        depthUsd2Pct: heuristic.d2,
        depthMethod: "heuristic_no_tick_arrays",
        depthNote: heuristic.note
      });
    }
  }

  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(
      batch.map((x) => x.pubkey),
      opts.commitment ?? "confirmed"
    );
    for (let j = 0; j < batch.length; j += 1) {
      const poolRef = batch[j];
      const pool = pools.find((p) => p.address === poolRef.address);
      if (!pool) continue;
      const info = infos[j];
      const heuristic = approxDepth(pool);
      if (!info) {
        out.set(pool.address, {
          poolAddress: pool.address,
          validated: false,
          validationNote: "Pool account not found on RPC",
          rpcEndpoint,
          depthUsd1Pct: heuristic.d1,
          depthUsd2Pct: heuristic.d2,
          depthMethod: "heuristic_no_tick_arrays",
          depthNote: heuristic.note
        });
        continue;
      }
      out.set(pool.address, {
        poolAddress: pool.address,
        validated: true,
        rpcEndpoint,
        accountOwner: info.owner.toBase58(),
        lamports: info.lamports,
        depthUsd1Pct: heuristic.d1,
        depthUsd2Pct: heuristic.d2,
        depthMethod: "heuristic_no_tick_arrays",
        depthNote: heuristic.note
      });
    }
  }

  return out;
}
