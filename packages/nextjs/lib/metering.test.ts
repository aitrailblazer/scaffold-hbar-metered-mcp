import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TX_ID_RE,
  clearSpent,
  isSpent,
  markSpent,
  normalizeTxIdForMirror,
} from "./metering.ts";

/**
 * Regression tests for payment transaction id handling.
 * The testnet mirror node path lookup needs dash form
 * (0.0.7-1727712000-123456789) while wallets hand out @ form
 * (0.0.7@1727712000.123456789). Both must verify the same payment.
 */
describe("payment transaction ids", () => {
  it("accepts @ form and dash form, rejects garbage", () => {
    assert.match("0.0.90@1790795985.489000306", TX_ID_RE);
    assert.match("0.0.90-1790795985-489000306", TX_ID_RE);
    assert.doesNotMatch("not-a-tx-id", TX_ID_RE);
    assert.doesNotMatch("0.0.90@notatime", TX_ID_RE);
    assert.doesNotMatch("", TX_ID_RE);
  });

  it("normalizes @ form to the mirror dash form", () => {
    assert.equal(normalizeTxIdForMirror("0.0.90@1790795985.489000306"), "0.0.90-1790795985-489000306");
    assert.equal(normalizeTxIdForMirror("0.0.90-1790795985-489000306"), "0.0.90-1790795985-489000306");
  });

  it("marks a payment spent exactly once", () => {
    clearSpent();
    const txId = "0.0.1@1.1";
    assert.equal(isSpent(txId), false);
    markSpent(txId);
    assert.equal(isSpent(txId), true);
    clearSpent();
    assert.equal(isSpent(txId), false);
  });
});
