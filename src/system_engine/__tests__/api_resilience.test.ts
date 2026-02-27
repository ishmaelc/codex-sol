import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { handlePositionsQuery, handleAlertsQuery } from "../runtime/api_handlers.js";

function qs(raw: string): URLSearchParams {
  return new URLSearchParams(raw);
}

test("/api/alerts degrades to 200 when builder throws", async () => {
  const result = await handleAlertsQuery(qs("wallet=4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr"), {
    getAlertsPayload: async () => {
      throw new Error("boom");
    },
    timeoutMs: 50,
    nowIso: () => "2026-02-27T00:00:00.000Z"
  });

  assert.equal(result.status, 200);
  const body = result.body as any;
  assert.equal(Boolean(body?.meta?.degraded), true);
  assert.equal(body?.attention?.level, "none");
  assert.ok(Array.isArray(body?.attention?.reasons));
});

test("/api/positions summary returns fallback on timeout", async () => {
  const result = await handlePositionsQuery(qs("wallet=4ogWhtiSEAaXZCDD9BPAnRa2DY18pxvF9RbiUUdRJSvr&mode=summary"), {
    fetchWalletPositionsFn: async () => await new Promise<any>(() => {}),
    buildSummaryFn: (x: any) => x,
    computeSolSystemFn: (x: any) => x,
    buildPositionsSummaryInputsFn: (x: any) => x,
    buildSolSystemInputsFromSummaryFn: (x: any) => x,
    timeoutMs: 25
  });

  assert.equal(result.status, 200);
  const body = result.body as any;
  assert.equal(Boolean(body?.meta?.degraded), true);
  assert.ok(body?.solSystem, "positions fallback must include solSystem");
});

test("/api/positions missing wallet returns 400 JSON payload", async () => {
  const result = await handlePositionsQuery(qs("mode=summary"));
  assert.equal(result.status, 400);
  const body = result.body as any;
  assert.equal(body?.error, "MISSING_WALLET");
});

test("/api/alerts missing wallet returns 400 JSON payload", async () => {
  const result = await handleAlertsQuery(qs(""));
  assert.equal(result.status, 400);
  const body = result.body as any;
  assert.equal(body?.error, "MISSING_WALLET");
});

test("runtime handlers and alerts getter do not perform filesystem writes", () => {
  const handlersSrc = fs.readFileSync(path.resolve(process.cwd(), "src/system_engine/runtime/api_handlers.ts"), "utf8");
  const alertsGetterSrc = fs.readFileSync(path.resolve(process.cwd(), "src/system_engine/alerts/get_alerts_payload.ts"), "utf8");

  const forbiddenWriteTokens = ["writeFileSync", "writeFile(", "appendFile", "mkdirSync", "createWriteStream", "runPortfolioEngine("];
  for (const token of forbiddenWriteTokens) {
    assert.equal(handlersSrc.includes(token), false, `api_handlers.ts must be runtime read-only: found ${token}`);
    assert.equal(alertsGetterSrc.includes(token), false, `get_alerts_payload.ts must be runtime read-only: found ${token}`);
  }
});
