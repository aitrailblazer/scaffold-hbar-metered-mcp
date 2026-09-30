import { z } from "zod";

/**
 * Metering core for the scaffold-hbar-metered-mcp template.
 *
 * Every paid MCP tool call settles as a plain HBAR transfer on Hedera
 * testnet. The client sends the transfer from its own wallet, then passes
 * the resulting transaction id with the tool call. The server verifies the
 * transfer against the testnet mirror node (read only, no operator key
 * needed), executes the tool once, and records the payment id so it cannot
 * be reused.
 *
 * Testnet only. There are no mainnet code paths in this module.
 */

export const TESTNET_MIRROR_BASE = "https://testnet.mirrornode.hedera.com";

export const DEFAULT_PRICE_TINYBAR = 10_000;

export const MAX_PAYMENT_AGE_SEC = 30 * 60;

export const MAX_SPENT_ENTRIES = 2000;

export const TX_ID_RE = /^0\.0\.\d+@\d+\.\d+$/;

export const ACCOUNT_ID_RE = /^0\.0\.\d+$/;

export type MeterConfig = {
  treasury: string;
  priceTinybar: number;
  topicId: string;
  mirrorBase: string;
};

export function getMeterConfig(): MeterConfig {
  const priceRaw = process.env.METER_PRICE_TINYBAR ?? String(DEFAULT_PRICE_TINYBAR);
  const priceTinybar = Number.parseInt(priceRaw, 10);
  return {
    treasury: (process.env.METER_TREASURY_ACCOUNT ?? "").trim(),
    priceTinybar: Number.isSafeInteger(priceTinybar) && priceTinybar > 0 ? priceTinybar : DEFAULT_PRICE_TINYBAR,
    topicId: (process.env.HCS_RECEIPT_TOPIC_ID ?? "").trim(),
    mirrorBase: (process.env.HEDERA_MIRROR_TESTNET_URL ?? TESTNET_MIRROR_BASE).replace(/\/$/, ""),
  };
}

export class MeterError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** In memory registry of spent payment transaction ids. Fine for a template. */
const spentPayments = new Map<string, number>();

export function isSpent(paymentTxId: string): boolean {
  return spentPayments.has(paymentTxId);
}

export function markSpent(paymentTxId: string): void {
  spentPayments.set(paymentTxId, Date.now());
  if (spentPayments.size > MAX_SPENT_ENTRIES) {
    const oldest = [...spentPayments.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) spentPayments.delete(oldest[0]);
  }
}

export function spentCount(): number {
  return spentPayments.size;
}

export function clearSpent(): void {
  spentPayments.clear();
}

type MirrorTransaction = {
  transaction_id?: string;
  result?: string;
  consensus_timestamp?: string;
  transfers?: Array<{ account?: string; amount?: number }>;
};

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new MeterError("MIRROR_LOOKUP_FAILED", `Mirror node request failed with status ${res.status}.`, 502);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof MeterError) throw err;
    throw new MeterError("MIRROR_LOOKUP_FAILED", "Mirror node request failed or timed out.", 502);
  } finally {
    clearTimeout(timer);
  }
}

function ageSeconds(consensusTimestamp: string | undefined, nowSec: number): number | null {
  if (!consensusTimestamp) return null;
  const parts = consensusTimestamp.split(".");
  const sec = Number(parts[0]);
  if (!Number.isFinite(sec)) return null;
  return nowSec - sec;
}

/**
 * Verify that paymentTxId settles at least priceTinybar to the treasury.
 * Returns the payer account id. Throws MeterError when unpaid or invalid.
 */
export async function verifyPayment(
  paymentTxId: string,
  config: MeterConfig,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<{ payer: string }> {
  if (!TX_ID_RE.test(paymentTxId)) {
    throw new MeterError(
      "INVALID_TX_ID",
      "paymentTxId must look like 0.0.123@1727712000.123456789.",
      400,
    );
  }
  if (!config.treasury || !ACCOUNT_ID_RE.test(config.treasury)) {
    throw new MeterError(
      "TREASURY_NOT_CONFIGURED",
      "Server treasury is not configured. Set METER_TREASURY_ACCOUNT and restart.",
      500,
    );
  }
  if (isSpent(paymentTxId)) {
    throw new MeterError("PAYMENT_ALREADY_SPENT", "This payment transaction was already used.", 409);
  }

  const data = (await fetchJson(
    `${config.mirrorBase}/api/v1/transactions/${paymentTxId}`,
  )) as { transactions?: MirrorTransaction[] };
  const tx = (data.transactions ?? []).find(t => t.transaction_id === paymentTxId);
  if (!tx) {
    throw new MeterError(
      "PAYMENT_NOT_FOUND",
      "Payment transaction not found on the testnet mirror node yet. Wait a few seconds and retry.",
      402,
    );
  }
  if (tx.result && tx.result !== "SUCCESS") {
    throw new MeterError("PAYMENT_NOT_SUCCESS", `Payment transaction result is ${tx.result}.`, 402);
  }
  const age = ageSeconds(tx.consensus_timestamp, nowSec);
  if (age !== null && age > MAX_PAYMENT_AGE_SEC) {
    throw new MeterError("PAYMENT_TOO_OLD", "Payment transaction is older than 30 minutes.", 402);
  }

  let credited = 0;
  let payer = "";
  for (const transfer of tx.transfers ?? []) {
    if (transfer.account === config.treasury && typeof transfer.amount === "number" && transfer.amount > 0) {
      credited += transfer.amount;
    }
    if (typeof transfer.amount === "number" && transfer.amount < 0 && !payer) {
      payer = transfer.account ?? "";
    }
  }
  if (credited < config.priceTinybar) {
    throw new MeterError(
      "PAYMENT_INSUFFICIENT",
      `Treasury ${config.treasury} received ${credited} tinybar, need at least ${config.priceTinybar}.`,
      402,
    );
  }
  return { payer };
}

/** Shared tool parameter shapes (zod raw shapes, as @modelcontextprotocol/sdk expects). */
export const PingShape = {} as const;

export const AccountBalanceShape = {
  accountId: z.string().regex(ACCOUNT_ID_RE, "accountId must look like 0.0.123."),
};

export const TopicMessagesShape = {
  topicId: z.string().regex(ACCOUNT_ID_RE, "topicId must look like 0.0.456."),
  limit: z.number().int().min(1).max(20).default(5),
};

export const EchoShape = {
  message: z.string().min(1).max(500),
};

const PingParams = z.object(PingShape).strict();
const AccountBalanceParams = z.object(AccountBalanceShape);
const TopicMessagesParams = z.object(TopicMessagesShape);
const EchoParams = z.object(EchoShape);

export type ToolName = "ping" | "account_balance" | "topic_messages" | "echo";

export type ToolDef = {
  name: ToolName;
  description: string;
  free: boolean;
  shape: Record<string, z.ZodTypeAny>;
  params: z.ZodTypeAny;
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "ping",
    description: "Free liveness check. No payment needed.",
    free: true,
    shape: { ...PingShape },
    params: PingParams,
  },
  {
    name: "account_balance",
    description: "Look up the HBAR balance of a Hedera testnet account via the mirror node.",
    free: false,
    shape: { ...AccountBalanceShape },
    params: AccountBalanceParams,
  },
  {
    name: "topic_messages",
    description: "Read recent messages from a Hedera testnet HCS topic via the mirror node.",
    free: false,
    shape: { ...TopicMessagesShape },
    params: TopicMessagesParams,
  },
  {
    name: "echo",
    description: "Return the caller's message with its length. Metered like any paid tool.",
    free: false,
    shape: { ...EchoShape },
    params: EchoParams,
  },
];

export function getToolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find(t => t.name === name);
}

function decodeMessage(base64: string): string {
  try {
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return base64;
  }
}

/** Execute a tool after payment was verified. Throws MeterError on failure. */
export async function executeTool(
  name: ToolName,
  params: unknown,
  config: MeterConfig,
): Promise<Record<string, unknown>> {
  if (name === "ping") {
    return { ok: true, network: "testnet", timestamp: new Date().toISOString() };
  }
  if (name === "account_balance") {
    const { accountId } = AccountBalanceParams.parse(params);
    const data = (await fetchJson(`${config.mirrorBase}/api/v1/accounts/${accountId}`)) as {
      account?: string;
      balance?: { balance?: number };
    };
    if (!data.account) {
      throw new MeterError("ACCOUNT_NOT_FOUND", `Account ${accountId} not found on testnet.`, 404);
    }
    const tinybar = data.balance?.balance ?? 0;
    return { accountId: data.account, balanceTinybar: tinybar, balanceHbar: tinybar / 100_000_000 };
  }
  if (name === "topic_messages") {
    const { topicId, limit } = TopicMessagesParams.parse(params);
    const data = (await fetchJson(
      `${config.mirrorBase}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`,
    )) as { messages?: Array<{ consensus_timestamp?: string; sequence_number?: number; message?: string }> };
    const messages = (data.messages ?? []).map(m => ({
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      message: decodeMessage(m.message ?? ""),
    }));
    return { topicId, count: messages.length, messages };
  }
  const { message } = EchoParams.parse(params);
  return { message, length: message.length };
}
