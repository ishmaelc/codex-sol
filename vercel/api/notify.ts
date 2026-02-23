import { buildSummary, fetchWalletPositions } from "../../src/index.js";
import { bearerToken, fmtPct, fmtUsd, json } from "./_utils.js";

type LendObligation = {
  market?: string;
  obligation?: string;
  netValueUsd?: number | null;
  pnlUsd?: number | null;
  currentNetInterestApyPct?: number | null;
  currentSupplyContributionNetApyPct?: number | null;
  currentBorrowCostNetApyPct?: number | null;
};

function summarizeMessage(summary: any, wallet: string): string {
  const obligations = Array.isArray(summary?.kaminoLend?.obligations) ? (summary.kaminoLend.obligations as LendObligation[]) : [];
  const onre = obligations
    .filter((o) => String(o.market ?? "").toLowerCase().includes("onre"))
    .sort((a, b) => Number(b.netValueUsd ?? 0) - Number(a.netValueUsd ?? 0));

  const lines: string[] = [];
  lines.push(`Wallet Status (${wallet.slice(0, 4)}...${wallet.slice(-4)})`);
  lines.push(`Portfolio Total: ${fmtUsd(summary?.totals?.valueUsdFarmsStaked ?? summary?.totals?.valueUsd)}`);
  lines.push(`Claimable Rewards: ${fmtUsd(summary?.kaminoLiquidity?.rewards?.claimableValueUsd)}`);

  for (const row of onre.slice(0, 4)) {
    lines.push(
      [
        `${row.market ?? "Position"} ${row.obligation ? row.obligation.slice(0, 4) + "..." : ""}`.trim(),
        `Net APY ${fmtPct(row.currentNetInterestApyPct)}`,
        `ONyc APY ${fmtPct(row.currentSupplyContributionNetApyPct)}`,
        `Borrow APY ${fmtPct(row.currentBorrowCostNetApyPct)}`,
        `Net ${fmtUsd(row.netValueUsd)}`,
        `PnL ${fmtUsd(row.pnlUsd)}`
      ].join(" | ")
    );
  }

  return lines.join("\n");
}

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const expectedToken = String(process.env.NOTIFY_TOKEN ?? "").trim();
  if (expectedToken) {
    const received = bearerToken(req);
    if (!received || received !== expectedToken) {
      return json(res, 401, { error: "Unauthorized" });
    }
  }

  const wallet = String(process.env.WALLET_ADDRESS ?? "").trim();
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!wallet) return json(res, 500, { error: "Missing env WALLET_ADDRESS" });
  if (!botToken) return json(res, 500, { error: "Missing env TELEGRAM_BOT_TOKEN" });
  if (!chatId) return json(res, 500, { error: "Missing env TELEGRAM_CHAT_ID" });

  try {
    const positions = await fetchWalletPositions(wallet);
    const summary = buildSummary(positions);
    const text = summarizeMessage(summary, wallet);

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!tgRes.ok) {
      const body = await tgRes.text().catch(() => "");
      return json(res, 502, { error: `Telegram send failed (${tgRes.status})`, body: body.slice(0, 500) });
    }

    return json(res, 200, { ok: true, sent: true });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
