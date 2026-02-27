# CLAUDE.md

## Project Overview

Solana portfolio analytics and monitoring system. Tracks wallet positions across DeFi protocols (Jupiter, Kamino, Orca), computes system health scores, generates alerts, and serves a web dashboard.

## Project Philosophy (Non-Negotiable)

This is a **deterministic, centralized DeFi risk engine**. Stability > features.

- Think in **systems**, not positions
- **Preserve capital > maximize yield**
- No duplicated risk math anywhere
- All scoring must originate in `src/system_engine/`
- UI is **display-only** — no calculations in the UI
- If two scores diverge anywhere, treat it as a bug
- Ratios always clamped `[0, 1]`
- Missing inputs → neutral scoring (`0.5`), never zero
- No heuristic guessing
- **Small incremental changes only**

## Tech Stack

- **Language:** TypeScript 5.7 (strict mode, ES2022, ES modules)
- **Runtime:** Node.js 22+
- **Key protocols:** Jupiter, Kamino, Orca (Whirlpools)
- **Web:** Express 5 (local dashboard), Vercel (serverless)
- **Testing:** Node.js built-in `test` module + `tsx`
- **Validation:** Zod for runtime schema validation
- **Math:** decimal.js for precise arithmetic

## Architecture

### Canonical Runtime Truth

**`/api/alerts` is the primary runtime truth source.** It includes:
- Portfolio attention score
- `capitalGuard` rollups
- Per-system `scoreObj`
- Per-system snapshot
- Per-system `debugMath`

All Portfolio and Systems Overview UI must be driven from this endpoint only.

### Secondary / Optional Endpoint

**`/api/positions?mode=summary`** — used **only** for SOL deep-dive debugging:
- Frequently times out (falls back to `systems_index`)
- SOL-only data
- Must **never** drive Portfolio or Systems Overview

### UI Structure

| Tab | Driven By | Notes |
|-----|-----------|-------|
| Portfolio | `/api/alerts` | Alerts, Systems Overview, Wallet Snapshot, Orca Snapshot |
| Orca | Orca data | Pool rankings, regime |
| Operator | `/api/alerts` (`systems[]`) | System selector (SOL/NX8). Optional SOL deep dive via positions |
| Wallet | `/api/positions` | Tokens, positions, rewards — inventory only, no risk math |

**UI must never mix alerts + positions data in the same component.**

### Project Structure

```
src/
  index.ts                  # Main CLI entry — wallet position fetching
  sol_system.ts             # SOL system scoring and snapshots
  portfolio/                # Portfolio analysis (engine, scoring, systems)
    systems/sol_system.ts   # SOL hedged system definition
    systems/nx8_system.ts   # NX8 system definition
  system_engine/            # ALL risk math lives here
    runtime/                # Read-only API handlers (no FS writes)
    health/                 # Health band computation
    capital_guard/          # Capital protection logic
    alerts/                 # Alert generation
    __tests__/              # 21 test files
  orca_scanner/             # Orca pool ranking and regime analysis
local-dev/server.ts         # Express dashboard (port 8787)
vercel/api/                 # Serverless Vercel endpoints
public/                     # Static dashboard UI + compiled JS (display only)
scripts/                    # GitHub Actions runners and build validators
.github/workflows/          # Automated data refresh (6h) and alerts (30m)
```

## Commands

```bash
npm run test              # Run all tests (Node built-in test runner)
npm run build             # TypeScript compile → dist/
npm run dev               # Start local dev server (port 8787)
npm run server            # Watch mode server
npm run start -- <WALLET> # CLI: fetch wallet positions
npm run orca:refresh      # Refresh Orca data → public/data/orca/
```

## Execution Rules

**Never do without explicit instruction:**
- Modify score weights
- Recompute hedge/liq/range in the UI
- Add drift logic
- Mix endpoint sources in a single component
- Redesign architecture
- Merge endpoints
- Heuristic "guess hedge target"
- Refactor scores

**Always do:**
- Update tests when changing UI data wiring
- Preserve deterministic ordering
- Put all new logic inside `src/system_engine/`
- Keep UI rendering-only

## Key Conventions

**Naming:**
- `camelCase` — variables, functions
- `PascalCase` — types, interfaces
- `SCREAMING_SNAKE_CASE` — constants
- `snake_case` — file names (e.g., `api_handlers.ts`, `compute_health.ts`)

**Code patterns:**
- Pure functions with single responsibility
- Discriminated unions with `ok` flag for protocol fetch results
- Zod for all external data validation
- Avoid type assertions; use type guards
- Immutable snapshots for system state
- Score objects shape: `{ value: 0-1, score: 0-100, label: string }`

**Error handling:**
- Try/catch for all external API calls
- Return degraded state with `meta.degraded` flag on failures
- Timeout wrappers around external calls
- Fallback values for optional data

**Architecture invariants:**
- Runtime handlers (`system_engine/runtime/`) are read-only — no filesystem writes
- Each system (SOL, NX8) isolated in its own file under `portfolio/systems/`
- Health, capital guard, and alerts are separate modules (no cross-concern coupling)

## Known Issues & Active Invariant Bugs

1. `/api/positions` frequently times out — system falls back to `systems_index`
2. **NX8 range freshness invariant violation (must fix):**
   - `bounds: null` but `hasRangeBuffer: true` and `rangeBufferRatio: 0`
   - This combination is invalid and triggers false critical alerts
   - **Fix:** if `rangeLower == null OR rangeUpper == null` → set `hasRangeBuffer = false`, `rangeBufferRatio = null`, range score component = `0.5` (neutral)
3. Portfolio "critical" state often driven by NX8 while SOL is acceptable — needs attribution labeling

## Phased Work Plan

**Phase 1 — Stabilize Runtime Truth** (no engine changes)
- Ensure Systems Overview + Operator use alerts only
- Remove residual positions summary dependencies from Portfolio
- Split status pills: `ALERTS: LIVE/ERROR` | `POSITIONS: LIVE/DEGRADED`

**Phase 2 — Fix NX8 Range Freshness Invariant** (engine change)
- Implement invariant: null bounds → `hasRangeBuffer=false`, `rangeBufferRatio=null`, neutral score
- Add regression test: null bounds ⇒ no `range_exit_risk` trigger

**Phase 3 — Improve Observability** (no math)
- Add "Driver: NX8" attribution labeling in Portfolio Alerts
- Show which system triggered attention

**Phase 4 — Performance Hardening** (longer term)
- Make alerts endpoint fully independent of wallet RPC fetch
- Precompute and cache `systems_index` deterministically
- Make positions summary optional-only

## Environment Setup

```bash
cp .env.example .env   # Then fill in required values
npm install
```

Required env vars: `JUPITER_API_KEY`, `SOLANA_RPC_URL`, `KAMINO_SDK_RPC_URLS`
Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HELIUS_RPC_URL`

## Testing

Tests live in `src/system_engine/__tests__/*.test.ts`. Use Node built-in assertions (`assert/strict`).

Add new tests alongside any new system engine logic. Display-only behavior tests are marked explicitly. Always run `npm test` and `npx tsc --noEmit` before committing engine changes.

## Build Outputs (Required for Deployment)

Vercel build runs `npm run orca:refresh && npm run assert:build-outputs`. Required outputs:
- `public/data/orca/regime_state.json`
- `public/data/orca/pool_rankings.json`
- `public/data/orca/shortlist.json`
- `public/data/orca/plans.json`
- `public/data/orca/allocation.json`
- `public/data/orca/alerts.json`
- `public/data/orca/performance.json`
- `public/data/portfolio/systems_index.json`
