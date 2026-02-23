import { PublicKey } from "@solana/web3.js";

export function json(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function getQuery(req: any): URLSearchParams {
  const host = req.headers?.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return url.searchParams;
}

export function requireWallet(wallet: string): string | null {
  const trimmed = String(wallet ?? "").trim();
  if (!trimmed) return "Missing query param: wallet";
  try {
    new PublicKey(trimmed);
    return null;
  } catch {
    return "Invalid Solana wallet address";
  }
}

export function bearerToken(req: any): string | null {
  const raw = String(req.headers?.authorization ?? "");
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  return raw.slice(7).trim();
}

export function fmtUsd(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(n);
}

export function fmtPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}%`;
}
