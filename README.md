# Solana Wallet Positions (TypeScript)

Pulls a wallet's:
- Spot balances from Solana RPC (`SOL` + SPL tokens)
- Jupiter Perps details (via Jupiter Portfolio API)
- Kamino Lend details
- Kamino Liquidity details

## Setup

```bash
npm install
cp .env.example .env
```

## Run

```bash
npm run start -- <WALLET_ADDRESS>
```

Output is printed as JSON.

## Dashboard

Start local web UI:

```bash
npm run server
```

`npm run server` runs in watch mode (auto-restarts on backend changes).
Use `npm run server:once` for a single-run server process.

Open:

`http://localhost:8787`

The dashboard calls:
- `/api/positions?wallet=<WALLET>&mode=summary`
- `/api/positions?wallet=<WALLET>&mode=full`

## Config

- `JUPITER_API_KEY` is required for Jupiter Portfolio API (`x-api-key` header).
- `KAMINO_BASE_URL` defaults to `https://api.kamino.finance`.
- `KAMINO_ENV` defaults to `mainnet-beta`.
- `KAMINO_SDK_RPC_URLS` is an optional comma-separated RPC list used to resolve Kamino on-chain liquidity strategies.
- `JUPITER_PERPS_ENDPOINTS` is optional legacy fallback only.
- `HELIUS_RPC_URL` (optional) can be set to a Helius RPC URL for token metadata enrichment (`getAsset`) used to classify unpriced tokens.
- `ENABLE_TOKEN_METADATA` defaults to `true`; set to `false` to disable metadata lookups.

## Protocol endpoints used

- Jupiter: `https://api.jup.ag/portfolio/v1/positions/{wallet}`
- Kamino Lend markets: `https://api.kamino.finance/v2/kamino-market?env=mainnet-beta`
- Kamino Lend obligations: `https://api.kamino.finance/kamino-market/{market}/users/{wallet}/obligations?env=mainnet-beta`
- Kamino Liquidity: `https://api.kamino.finance/kvaults/users/{wallet}/positions?env=mainnet-beta`

## Kamino liquidity details returned

`kaminoLiquidity.data` now includes:
- `kvaultPositions`, `kvaultRewards`, `farmsTransactions`
- `sdkStrategyPositions` (on-chain Kamino strategy positions, including pair labels like `NX8-USDC`, `SOL-USDG` when detected)
