import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("degraded status block stays display-only (no math/sort recomputation)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");

  const start = src.indexOf("// DEGRADED_STATUS_START");
  const end = src.indexOf("// DEGRADED_STATUS_END");

  assert.notEqual(start, -1, "missing DEGRADED_STATUS_START marker");
  assert.notEqual(end, -1, "missing DEGRADED_STATUS_END marker");
  assert.ok(end > start, "degraded status markers out of order");

  const block = src.slice(start, end);
  const forbiddenPatterns = ["Math.", ".sort("];
  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `degraded status block must not contain: ${pattern}`);
  }

  assert.equal(block.includes("meta?.degraded"), true, "degraded status must be driven by summary.meta.degraded");
  assert.equal(block.includes("DEGRADED (cached)"), true, "degraded status must render DEGRADED (cached) text");
  assert.equal(block.includes("fallback:"), true, "degraded details must include fallback source text");
});

test("main UI contains no Hedge Drift section text", () => {
  const indexPath = path.resolve(process.cwd(), "public/index.html");
  const appPath = path.resolve(process.cwd(), "public/app.js");
  const indexSrc = fs.readFileSync(indexPath, "utf8");
  const appSrc = fs.readFileSync(appPath, "utf8");

  assert.equal(indexSrc.includes("Hedge Drift"), false, "index.html should not render Hedge Drift text");
  assert.equal(appSrc.includes("Hedge Drift"), false, "app.js should not render Hedge Drift text");
  assert.equal(indexSrc.includes("Open Orca Regime + Pool Rankings"), false, "top Orca link should be removed");
  assert.equal(appSrc.includes("Portfolio Alerts"), true, "Portfolio alerts title should be present");
  assert.equal(appSrc.includes("Systems Overview"), true, "Systems overview title should be present");
  assert.equal(appSrc.includes("Wallet Snapshot"), true, "Wallet snapshot title should be present");
});

test("wallet snapshot headlines are alerts-driven (no positions summary dependency)", () => {
  const appPath = path.resolve(process.cwd(), "public/app.js");
  const appSrc = fs.readFileSync(appPath, "utf8");
  const start = appSrc.indexOf("function renderWalletHeadlines()");
  const end = appSrc.indexOf("function renderSystemConsoles()");

  assert.notEqual(start, -1, "missing renderWalletHeadlines function");
  assert.notEqual(end, -1, "missing renderSystemConsoles function");
  assert.ok(end > start, "wallet headlines function markers out of order");

  const block = appSrc.slice(start, end);
  assert.equal(block.includes("state.positionsSummary"), false, "wallet headlines must not read positions summary");
  assert.equal(block.includes("state.alerts.data"), true, "wallet headlines must be driven by alerts payload");
  assert.equal(block.includes("Attention Level"), true, "wallet headlines should render alerts-driven labels");
});
