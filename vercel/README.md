# Vercel Scaffold (Separate from Express App)

This folder contains a Vercel-friendly serverless scaffold that reuses the existing portfolio logic in `src/index.ts` without changing your current Express app in `local-dev/server.ts`.

## What is included

- `vercel/api/positions.ts`
  - Serverless version of `/api/positions`
  - Supports `?wallet=<pubkey>&mode=summary|full`
- `vercel/api/notify.ts`
  - Example Telegram notifier endpoint
  - Intended for Vercel Cron (`GET` or `POST`)
- `vercel/vercel.json`
  - Hourly cron calling `/api/notify`

## Deploy pattern

Recommended for first pass:

1. Create a Vercel project from this repo.
2. Set **Project Root** to repo root (not `vercel/`).
3. In Vercel, use the API routes under `vercel/api/*`.
4. Copy `vercel/vercel.json` to repo root as `vercel.json` when you are ready to enable Vercel cron.

Why repo root:

- These routes import `../../src/index.js` and reuse your existing logic and dependencies.
- If you deploy only the `vercel/` subfolder as project root, imports to `src/` will not be included.

## Env vars (Vercel)

- `SOLANA_RPC_URL`
- `JUPITER_API_KEY` (if your current setup uses it)
- `WALLET_ADDRESS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `NOTIFY_TOKEN` (optional but recommended)
- Any other Kamino/Jupiter env vars you already rely on

## Notes

- This is intentionally isolated so your existing local Express app continues to work unchanged.
- Next cleanup step (optional): extract shared route helpers if you want less duplication between Express and Vercel handlers.
