/**
 * HCS usage receipts for the scaffold-hbar-metered-mcp template.
 *
 * After each paid tool call the server records a JSON receipt:
 * { tool, payer, amount, paymentTxId, timestamp }.
 *
 * Receipts are always kept in a small in memory ring buffer so the home
 * page feed works with zero configuration. When HEDERA_OPERATOR_ID and
 * HEDERA_OPERATOR_KEY are set, the receipt is also submitted to the
 * configured HCS topic for a tamper-evident public record. When they are
 * absent, the payload is logged and serving continues. Submitting never
 * fails a tool call.
 *
 * Testnet only. There are no mainnet code paths in this module.
 */

export type UsageReceipt = {
  tool: string;
  payer: string;
  amount: number;
  paymentTxId: string;
  timestamp: string;
  receiptTxId?: string;
};

const MAX_RECEIPTS = 100;

const recentReceipts: UsageReceipt[] = [];

export function listRecentReceipts(): UsageReceipt[] {
  return [...recentReceipts].reverse();
}

export function clearRecentReceipts(): void {
  recentReceipts.length = 0;
}

function rememberReceipt(receipt: UsageReceipt): void {
  recentReceipts.push(receipt);
  if (recentReceipts.length > MAX_RECEIPTS) {
    recentReceipts.splice(0, recentReceipts.length - MAX_RECEIPTS);
  }
}

function hcsConfigured(): boolean {
  return Boolean(process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY);
}

async function submitToHcsTopic(topicId: string, payload: string): Promise<string | undefined> {
  const operatorId = process.env.HEDERA_OPERATOR_ID ?? "";
  const operatorKey = process.env.HEDERA_OPERATOR_KEY ?? "";
  if (!operatorId || !operatorKey || !topicId) return undefined;
  try {
    const sdk = await import("@hiero-ledger/sdk");
    const client = sdk.Client.forTestnet();
    client.setOperator(operatorId, operatorKey);
    try {
      const tx = await new sdk.TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(payload)
        .execute(client);
      const receipt = await tx.getReceipt(client);
      void receipt;
      return tx.transactionId?.toString();
    } finally {
      client.close();
    }
  } catch (err) {
    console.error("[hcs-receipt] submit failed, continuing without on chain receipt:", err);
    return undefined;
  }
}

/** Record a receipt locally and best effort to HCS. Never throws. */
export async function recordReceipt(input: Omit<UsageReceipt, "timestamp">): Promise<UsageReceipt> {
  const receipt: UsageReceipt = {
    ...input,
    timestamp: new Date().toISOString(),
  };
  if (hcsConfigured()) {
    const receiptTxId = await submitToHcsTopic(
      (process.env.HCS_RECEIPT_TOPIC_ID ?? "").trim(),
      JSON.stringify(receipt),
    );
    if (receiptTxId) receipt.receiptTxId = receiptTxId;
  } else {
    console.log("[hcs-receipt] operator not configured, local receipt only:", JSON.stringify(receipt));
  }
  rememberReceipt(receipt);
  return receipt;
}
