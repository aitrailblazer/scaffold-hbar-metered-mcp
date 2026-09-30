# scaffold-hbar-metered-mcp

A metered MCP server on Hedera. Every MCP tool call settles in HBAR on Hedera testnet, and every paid call writes a tamper-evident usage receipt to an HCS topic.

This template meters MCP tool calls directly. It is intentionally different from per-request HTTP payment schemes: the client sends a small HBAR transfer to the configured treasury account, calls the tool with the payment transaction id, the server verifies the transfer against the Hedera testnet mirror node, executes the tool, and logs an HCS receipt.

## What is inside

- `packages/nextjs`: Next.js app with an MCP route at `app/api/mcp/route.ts` (built on `@modelcontextprotocol/sdk`), a receipt feed at `app/api/receipts/route.ts`, and a setup-flow home page.
- `packages/hardhat`: kept from the scaffold-hbar baseline (HTS demo contracts, compile and tests pass). No new contract was added: metering settles in native HBAR and receipts live on HCS, so an on chain registry would add deploy cost without changing trust. The server still verifies every payment against the mirror node.
- `template.json`: manifest for `create-scaffold-hbar` 0.4.1.
- `.env.example`: all configuration. No `.env` is committed, ever.

Tools exposed by the MCP route:

| Tool | Cost | What it does |
| --- | --- | --- |
| `ping` | free | Liveness check, no payment needed |
| `account_balance` | paid | HBAR balance of a testnet account via the mirror node |
| `topic_messages` | paid | Recent messages of a testnet HCS topic via the mirror node |
| `echo` | paid | Returns your message with its length |

## Prerequisites

- Node.js 20.18.3 or later
- Yarn (this repo uses Yarn workspaces) or npm if you scaffolded with the CLI
- A Hedera testnet account with a little testnet HBAR (see setup)

## Quickstart

```bash
yarn install
cp .env.example .env
# edit .env: set METER_TREASURY_ACCOUNT to your testnet account
yarn next:start
```

Open [http://localhost:3000](http://localhost:3000) and follow the setup flow: configure, try the free ping, pay for a metered call, view recent receipts.

## How metering works

1. `GET /api/mcp` advertises the treasury account, the price per call in tinybar, and the tool list.
2. The client sends `priceTinybar` (default 10000) in HBAR to the treasury on Hedera testnet, from any wallet. No facilitator, no API keys.
3. The client calls `POST /api/mcp` with `{ tool, params, paymentTxId }`.
4. The server fetches the transaction from the testnet mirror node (`https://testnet.mirrornode.hedera.com`), checks the result is `SUCCESS`, the timestamp is under 30 minutes old, and the treasury was credited at least the price. Mirror node reads need no operator key.
5. Unpaid, unknown, insufficient, stale, or already spent transaction ids are rejected (`402 PAYMENT_REQUIRED`, `409 PAYMENT_ALREADY_SPENT`, and friends). Each payment works exactly once; the spent registry is in memory, which is fine for the template.
6. On success the server runs the tool and records a receipt `{ tool, payer, amount, paymentTxId, timestamp }`.

## Testnet setup

1. Create a testnet account at [portal.hedera.com](https://portal.hedera.com) and fund it from the [faucet](https://portal.hedera.com/faucet).
2. Put that account id in `METER_TREASURY_ACCOUNT`. This is the account your users pay.
3. Optional but recommended: create an HCS topic for receipts and set `HCS_RECEIPT_TOPIC_ID`. With `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` set, each paid call submits its receipt to that topic. Without them, receipts are logged and kept in memory and everything else still works. Never commit keys.

## How to verify receipts on Hashscan

- Payments: `https://hashscan.io/testnet/transaction/<paymentTxId>`
- Receipt topic: `https://hashscan.io/testnet/topic/<topicId>`
- Payer accounts: `https://hashscan.io/testnet/account/<accountId>`

The home page links every receipt to HashScan. A real testnet payment plus HCS receipt is the bounty proof item; it needs a funded testnet account from the faucet, which is a human step.

## API shape

```bash
# Manifest and pricing
curl http://localhost:3000/api/mcp

# Free tool
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"tool":"ping","params":{}}'

# Paid tool (after sending HBAR to the treasury)
curl -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"tool":"account_balance","params":{"accountId":"0.0.123"},"paymentTxId":"0.0.123@1727712000.123456789"}'

# Receipt feed
curl http://localhost:3000/api/receipts
```

## Scripts

```bash
yarn install        # install all workspaces
yarn lint           # lint nextjs and hardhat
yarn next:build     # production build of the frontend
yarn next:start     # dev server at http://localhost:3000
yarn hardhat:compile
yarn hardhat:test
```

## Links

- [Scaffold-HBAR docs](https://docs.hedera.com/solutions/tools/scaffold-hbar/index)
- [Scaffold-HBAR template bounty](https://hedera.com/blog/scaffold-hbar-template-bounty/)
- [Hedera Portal faucet](https://portal.hedera.com/faucet)
- [HashScan testnet](https://hashscan.io/testnet/dashboard)
- [Hedera testnet mirror node](https://testnet.mirrornode.hedera.com)
