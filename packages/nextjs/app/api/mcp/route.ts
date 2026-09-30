import { NextResponse } from "next/server";
import { TOOL_DEFS, executeTool, getMeterConfig, getToolDef, markSpent, verifyPayment } from "~~/lib/metering";
import { recordReceipt } from "~~/lib/receipts";

/**
 * Metered MCP endpoint for the template.
 *
 * GET returns the tool manifest with pricing so clients and the home page
 * can show the pay-to account and price before paying.
 *
 * POST accepts { tool, params, paymentTxId }:
 * - free tools run immediately,
 * - paid tools require a fresh testnet HBAR payment to the treasury,
 *   verified against the mirror node, then run once,
 * - every paid call records a usage receipt (local plus HCS when configured).
 */

export async function GET() {
  const config = getMeterConfig();
  return NextResponse.json({
    network: "testnet",
    treasury: config.treasury || null,
    priceTinybar: config.priceTinybar,
    priceHbar: config.priceTinybar / 100_000_000,
    receiptTopicId: config.topicId || null,
    treasuryConfigured: Boolean(config.treasury),
    tools: TOOL_DEFS.map(t => ({
      name: t.name,
      description: t.description,
      free: t.free,
      priceTinybar: t.free ? 0 : config.priceTinybar,
    })),
  });
}

type McpRequestBody = {
  tool?: unknown;
  params?: unknown;
  paymentTxId?: unknown;
};

export async function POST(req: Request) {
  let body: McpRequestBody;
  try {
    body = (await req.json()) as McpRequestBody;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Request body must be JSON." }, { status: 400 });
  }

  if (typeof body.tool !== "string") {
    return NextResponse.json(
      { error: "UNKNOWN_TOOL", message: "Provide a tool name from GET /api/mcp." },
      { status: 400 },
    );
  }
  const def = getToolDef(body.tool);
  if (!def) {
    return NextResponse.json({ error: "UNKNOWN_TOOL", message: `Unknown tool "${body.tool}".` }, { status: 400 });
  }

  let parsedParams: unknown = body.params ?? {};
  try {
    parsedParams = def.params.parse(parsedParams);
  } catch {
    return NextResponse.json(
      { error: "INVALID_PARAMS", message: `Invalid params for tool "${def.name}".` },
      { status: 400 },
    );
  }

  const config = getMeterConfig();

  if (def.free) {
    try {
      const result = await executeTool(def.name, parsedParams, config);
      return NextResponse.json({ tool: def.name, free: true, result });
    } catch (err) {
      return toolError(err);
    }
  }

  if (typeof body.paymentTxId !== "string" || body.paymentTxId.length === 0) {
    return NextResponse.json(
      {
        error: "PAYMENT_REQUIRED",
        message: `Tool "${def.name}" costs ${config.priceTinybar} tinybar. Send HBAR to ${config.treasury || "the configured treasury"} on testnet, then retry with paymentTxId.`,
        treasury: config.treasury || null,
        priceTinybar: config.priceTinybar,
      },
      { status: 402 },
    );
  }

  try {
    const { payer } = await verifyPayment(body.paymentTxId, config);
    const result = await executeTool(def.name, parsedParams, config);
    markSpent(body.paymentTxId);
    const receipt = await recordReceipt({
      tool: def.name,
      payer,
      amount: config.priceTinybar,
      paymentTxId: body.paymentTxId,
    });
    return NextResponse.json({ tool: def.name, result, receipt });
  } catch (err) {
    return toolError(err);
  }
}

function toolError(err: unknown) {
  if (err && typeof err === "object" && "code" in err && "status" in err) {
    const e = err as { code: string; message: string; status: number };
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  console.error("[api/mcp]", err);
  return NextResponse.json({ error: "TOOL_FAILED", message: "Tool execution failed." }, { status: 500 });
}
