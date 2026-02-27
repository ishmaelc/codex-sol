#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function stableSortedStrings(values) {
  return [...new Set(values.map((v) => String(v)))].sort((a, b) => a.localeCompare(b));
}

function normalizeSystems(systems) {
  if (!Array.isArray(systems)) return [];
  return [...systems]
    .map((s) => ({
      systemId: String(s?.systemId ?? s?.id ?? ""),
      healthOverall: String(s?.health?.overall ?? ""),
      guardLevel: String(s?.capitalGuard?.level ?? ""),
      guardTriggers: stableSortedStrings(Array.isArray(s?.capitalGuard?.triggers) ? s.capitalGuard.triggers : [])
    }))
    .sort((a, b) => a.systemId.localeCompare(b.systemId));
}

function buildHashInput(payload) {
  const attention = payload?.attention ?? {};
  return {
    level: String(attention.level ?? "none"),
    triggers: stableSortedStrings(Array.isArray(attention.triggers) ? attention.triggers : []),
    systems: normalizeSystems(payload?.systems)
  };
}

function computeHash(hashInput) {
  return crypto.createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
}

function readState(filepath) {
  try {
    const text = fs.readFileSync(filepath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeState(filepath, state) {
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function buildTelegramMessage(payload) {
  const attention = payload.attention ?? {};
  const level = String(attention.level ?? "none").toUpperCase();
  const triggers = stableSortedStrings(Array.isArray(attention.triggers) ? attention.triggers : []);
  const systems = Array.isArray(attention.systems) ? [...attention.systems].map(String).sort((a, b) => a.localeCompare(b)) : [];

  const lines = [`DeFi Risk Alert: ${level}`];
  if (triggers.length > 0) lines.push(`Triggers: ${triggers.join(", ")}`);
  if (systems.length > 0) lines.push(`Systems: ${systems.join(", ")}`);
  if (process.env.CONSOLE_URL && String(process.env.CONSOLE_URL).trim()) {
    lines.push(`Console: ${String(process.env.CONSOLE_URL).trim()}`);
  }
  return lines.join("\n");
}

async function sendTelegram({ botToken, chatId, text }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram send failed: HTTP ${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
  }
}

function buildAlertsRequestUrl(rawUrl, walletFromEnv) {
  const url = new URL(rawUrl);
  const walletInUrl = String(url.searchParams.get("wallet") ?? "").trim();
  const wallet = String(walletFromEnv ?? "").trim();
  if (!walletInUrl && wallet) {
    url.searchParams.set("wallet", wallet);
  }
  return url;
}

async function main() {
  const alertsUrl = requireEnv("ALERTS_URL");
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const wallet = process.env.ALERTS_WALLET;
  const stateFile = path.resolve(process.env.ALERTS_STATE_FILE || ".alerts_state.json");
  const requestUrl = buildAlertsRequestUrl(alertsUrl, wallet);

  const res = await fetch(requestUrl, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && body.includes("MISSING_WALLET")) {
      throw new Error(
        "Failed to fetch alerts payload: missing wallet. Set ALERTS_WALLET secret or include ?wallet=<pubkey> in ALERTS_URL."
      );
    }
    throw new Error(`Failed to fetch ALERTS_URL: HTTP ${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
  }

  const payload = await res.json();
  if (!payload || typeof payload !== "object" || !payload.attention || typeof payload.attention.level !== "string") {
    throw new Error("Invalid alerts payload shape: expected attention.level");
  }

  if (payload.attention.level === "none") {
    console.log("[alerts_runner] attention.level=none; no alert sent.");
    return;
  }

  const hashInput = buildHashInput(payload);
  const nextHash = computeHash(hashInput);
  const previous = readState(stateFile);
  if (previous?.hash === nextHash) {
    console.log("[alerts_runner] alert hash unchanged; no alert sent.");
    return;
  }

  const text = buildTelegramMessage(payload);
  await sendTelegram({ botToken, chatId, text });

  writeState(stateFile, {
    hash: nextHash,
    ts: new Date().toISOString(),
    level: String(payload.attention.level)
  });

  console.log("[alerts_runner] alert sent and state updated.");
}

main().catch((err) => {
  console.error(`[alerts_runner] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
