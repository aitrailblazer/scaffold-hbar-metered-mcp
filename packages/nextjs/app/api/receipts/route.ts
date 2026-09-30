import { NextResponse } from "next/server";
import { type UsageReceipt, listRecentReceipts } from "~~/lib/receipts";

/**
 * Receipt feed for the home page. Returns locally recorded receipts plus,
 * when HCS_RECEIPT_TOPIC_ID is set, recent messages from that topic on the
 * testnet mirror node. Mirror reads need no operator key and fail open.
 */
export async function GET() {
  const topicId = (process.env.HCS_RECEIPT_TOPIC_ID ?? "").trim();
  const mirrorBase = (process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com").replace(
    /\/$/,
    "",
  );
  const local = listRecentReceipts();

  const onChain: UsageReceipt[] = [];
  if (/^0\.0\.\d+$/.test(topicId)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${mirrorBase}/api/v1/topics/${topicId}/messages?limit=20&order=desc`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as {
            messages?: Array<{ message?: string; consensus_timestamp?: string }>;
          };
          for (const m of data.messages ?? []) {
            try {
              const decoded = Buffer.from(m.message ?? "", "base64").toString("utf8");
              const parsed = JSON.parse(decoded) as Partial<UsageReceipt>;
              if (parsed && typeof parsed.tool === "string" && typeof parsed.paymentTxId === "string") {
                onChain.push({
                  tool: parsed.tool,
                  payer: typeof parsed.payer === "string" ? parsed.payer : "",
                  amount: typeof parsed.amount === "number" ? parsed.amount : 0,
                  paymentTxId: parsed.paymentTxId,
                  timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
                });
              }
            } catch {
              continue;
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.error("[api/receipts] mirror read failed, serving local receipts only:", err);
    }
  }

  return NextResponse.json({ receipts: local, onChain, topicId: topicId || null });
}
