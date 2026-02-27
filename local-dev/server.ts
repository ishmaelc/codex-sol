import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { buildSummary, fetchWalletPositions } from "../src/index.js";
import { computeSolSystem } from "../src/sol_system.js";
import { buildPositionsSummaryInputs, buildSolSystemInputsFromSummary } from "../src/system_engine/positions/build_summary.js";
import { createLocalAlertsHandler } from "../src/system_engine/alerts/local_alerts_handler.js";

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

app.get("/api/positions", async (req, res) => {
  const wallet = String(req.query.wallet ?? "").trim();
  const mode = String(req.query.mode ?? "summary").trim().toLowerCase();
  const debug = String(req.query.debug ?? "").trim() === "1";

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
    const summaryInputs = buildPositionsSummaryInputs({
      ...summary,
      jupiterPerps: positions.jupiterPerps
    }, { debug: mode === "summary" && debug });
    const solSystem = computeSolSystem(buildSolSystemInputsFromSummary(summaryInputs));

    const payload = { ...summary, solSystem };
    positionsCache.set(cacheKey, { ts: now, payload });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/alerts", createLocalAlertsHandler());

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const directRunTarget = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === directRunTarget) {
  app.listen(port, () => {
    console.log(`dashboard server listening on http://localhost:${port}`);
  });
}
