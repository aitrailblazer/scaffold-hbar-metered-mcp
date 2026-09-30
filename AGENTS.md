# Agent instructions: scaffold-hbar-metered-mcp

This repo is a public MIT template: a metered MCP server on Hedera testnet. Every paid MCP tool call settles in HBAR and writes an HCS usage receipt. Keep it small, keep it testnet only, keep secrets out.

## Layout

- `packages/nextjs`: the product. MCP route, receipt feed, setup-flow home page.
  - `lib/metering.ts`: pricing config, spent-tx registry, mirror node payment verification, tool definitions and handlers.
  - `lib/receipts.ts`: in memory receipt buffer plus best effort HCS submit.
  - `app/api/mcp/route.ts`: `GET` manifest, `POST` tool calls. Built on `@modelcontextprotocol/sdk` (`McpServer` with the same tool handlers).
  - `app/api/receipts/route.ts`: local receipts plus best effort mirror node topic read.
  - `app/page.tsx`: four step setup flow (configure, free ping, paid call, receipts).
- `packages/hardhat`: baseline HTS demo contracts, untouched. No new contract: metering settles in native HBAR and receipts live on HCS, so an on chain registry would add cost without changing trust. Do not add one casually.
- `template.json`: manifest for `create-scaffold-hbar`. Keep name, version, capabilities, envVars in sync with `.env.example` and `README.md`.
- `.env.example`: the only env file. Never create or commit `.env`.

## Rules

- Testnet only. No mainnet code paths, URLs, or defaults. Mirror base is `https://testnet.mirrornode.hedera.com`.
- No em dashes anywhere: not in code, docs, comments, or UI. Use commas, colons, or periods. Before finishing, search the repo for the em dash character and fix every hit.
- No secrets in the repo. No `.env`, no private keys, no operator keys in code or fixtures.
- Do not import proprietary code. Only public patterns: `@hiero-ledger/sdk`, `@modelcontextprotocol/sdk`, `zod`, and the mirror node REST API.
- Keep the MCP tool list in sync in three places: `TOOL_DEFS` in `lib/metering.ts`, the `McpServer` registration in `app/api/mcp/route.ts` (it builds from `TOOL_DEFS`, so this is automatic), and the tool table in `README.md` plus the dropdown in `app/page.tsx`.
- Payment verification lives in `verifyPayment` (`lib/metering.ts`): format check, treasury configured check, spent check, mirror lookup, `SUCCESS` result, 30 minute freshness, treasury credited at least the price. Every payment id is marked spent after exactly one use. `markSpent` must run only after the tool succeeds; a failed tool must not burn the payment.
- HCS submit (`lib/receipts.ts`) is best effort and never fails a tool call. Operator key absent means log and continue.
- Mirror node fetches need no key but can be slow or fail: 10 second timeout, fail with a 502 style error, never hang the route.

## Commands (repo root, Yarn workspaces)

```bash
yarn install
yarn lint               # next lint plus hardhat lint
yarn next:check-types   # tsc --noEmit for the frontend
yarn next:build         # production build, must succeed with no .env
yarn hardhat:compile
yarn hardhat:test
yarn next:start         # dev server at http://localhost:3000
```

Build and boot must succeed with no `.env` present: treasury unconfigured shows a warning in UI and paid calls fail closed with `TREASURY_NOT_CONFIGURED`, while `ping`, the manifest, and the home page keep working.

## Verifying a change end to end

1. Boot with no `.env`: `GET /api/mcp` shows `treasuryConfigured: false`, `POST ping` returns 200, paid tools return `402 PAYMENT_REQUIRED` (or `500 TREASURY_NOT_CONFIGURED` with a payment id, which is also fail closed).
2. Set `METER_TREASURY_ACCOUNT` to a funded testnet account and restart: unpaid calls return 402 with treasury and price; a real payment returns the tool result plus a receipt.
3. Reusing a payment id returns `409 PAYMENT_ALREADY_SPENT`.
4. `GET /api/receipts` lists the call; with operator env and a topic id, the receipt also lands on HCS and is visible on HashScan.

## Bounty checklist (for the human owner)

- [ ] Funded testnet account from the Portal faucet for the Hashscan proof
- [ ] One real payment plus HCS receipt linked in the submission
- [ ] Fresh-scaffold check: `npm create scaffold-hbar@latest -- --template aitrailblazer/scaffold-hbar-metered-mcp`, then install, lint, build, boot
- [ ] Push to `main` on `github.com/aitrailblazer/scaffold-hbar-metered-mcp`
