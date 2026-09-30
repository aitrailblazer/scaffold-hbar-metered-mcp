"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextPage } from "next";

type ManifestTool = {
  name: string;
  description: string;
  free: boolean;
  priceTinybar: number;
};

type Manifest = {
  network: string;
  treasury: string | null;
  priceTinybar: number;
  priceHbar: number;
  receiptTopicId: string | null;
  treasuryConfigured: boolean;
  tools: ManifestTool[];
};

type Receipt = {
  tool: string;
  payer: string;
  amount: number;
  paymentTxId: string;
  timestamp: string;
  receiptTxId?: string;
};

const hashscanTx = (txId: string) => `https://hashscan.io/testnet/transaction/${txId}`;
const hashscanTopic = (topicId: string) => `https://hashscan.io/testnet/topic/${topicId}`;
const hashscanAccount = (accountId: string) => `https://hashscan.io/testnet/account/${accountId}`;

const Home: NextPage = () => {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState("");
  const [pingResult, setPingResult] = useState("");
  const [tool, setTool] = useState("account_balance");
  const [accountId, setAccountId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [message, setMessage] = useState("hello hedera");
  const [paymentTxId, setPaymentTxId] = useState("");
  const [callResult, setCallResult] = useState("");
  const [callError, setCallError] = useState("");
  const [calling, setCalling] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [onChain, setOnChain] = useState<Receipt[]>([]);

  const loadManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp");
      if (!res.ok) throw new Error(`status ${res.status}`);
      setManifest((await res.json()) as Manifest);
    } catch {
      setManifestError("Could not reach the MCP route. Is the dev server running?");
    }
  }, []);

  const loadReceipts = useCallback(async () => {
    try {
      const res = await fetch("/api/receipts");
      if (!res.ok) return;
      const data = (await res.json()) as { receipts: Receipt[]; onChain: Receipt[] };
      setReceipts(data.receipts ?? []);
      setOnChain(data.onChain ?? []);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void loadManifest();
    void loadReceipts();
  }, [loadManifest, loadReceipts]);

  const tryPing = async () => {
    setPingResult("Calling ping...");
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "ping", params: {} }),
      });
      setPingResult(JSON.stringify(await res.json(), null, 2));
    } catch {
      setPingResult("Ping failed. Check the dev server.");
    }
  };

  const callMeteredTool = async () => {
    setCalling(true);
    setCallResult("");
    setCallError("");
    const params =
      tool === "account_balance" ? { accountId } : tool === "topic_messages" ? { topicId, limit: 5 } : { message };
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool, params, paymentTxId: paymentTxId.trim() || undefined }),
      });
      const data = (await res.json()) as { error?: string; message?: string } & Record<string, unknown>;
      if (!res.ok) {
        setCallError(`${data.error ?? "CALL_FAILED"}: ${data.message ?? `status ${res.status}`}`);
      } else {
        setCallResult(JSON.stringify(data, null, 2));
        void loadReceipts();
      }
    } catch {
      setCallError("CALL_FAILED: could not reach the server.");
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="flex items-center flex-col grow px-5 pb-16">
      <div className="w-full max-w-3xl mt-8">
        <h1 className="text-3xl font-bold mb-2">Metered MCP on Hedera</h1>
        <p className="text-base-content/70 mb-6">
          Every MCP tool call settles in HBAR on Hedera testnet. Pay a small amount per call, the server verifies the
          transfer on the mirror node, runs the tool, and writes a usage receipt to HCS.
        </p>

        {manifestError && (
          <div className="alert alert-error mb-4">
            <span>{manifestError}</span>
          </div>
        )}
        {manifest && !manifest.treasuryConfigured && (
          <div className="alert alert-warning mb-4">
            <span>
              Treasury is not configured. Copy .env.example, set METER_TREASURY_ACCOUNT, and restart the server before
              paid calls can succeed.
            </span>
          </div>
        )}

        <section className="bg-base-100 rounded-xl shadow p-6 mb-4 border border-base-300">
          <h2 className="text-xl font-semibold mb-1">1. Configure</h2>
          <p className="text-sm text-base-content/70 mb-4">
            Values below come from the live server. Change them in your .env file and restart.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-medium">Treasury account</dt>
              <dd className="font-mono">{manifest?.treasury ?? "not set"}</dd>
            </div>
            <div>
              <dt className="font-medium">Price per paid call</dt>
              <dd className="font-mono">
                {manifest ? `${manifest.priceTinybar} tinybar (${manifest.priceHbar} HBAR)` : "loading..."}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Receipt topic</dt>
              <dd className="font-mono">{manifest?.receiptTopicId ?? "not set"}</dd>
            </div>
            <div>
              <dt className="font-medium">Network</dt>
              <dd className="font-mono">Hedera testnet only</dd>
            </div>
          </dl>
          <p className="text-sm text-base-content/70 mt-4">
            Get testnet HBAR from the{" "}
            <a className="link" href="https://portal.hedera.com/faucet" target="_blank" rel="noreferrer">
              Hedera Portal faucet
            </a>
            .
          </p>
        </section>

        <section className="bg-base-100 rounded-xl shadow p-6 mb-4 border border-base-300">
          <h2 className="text-xl font-semibold mb-1">2. Try a free ping</h2>
          <p className="text-sm text-base-content/70 mb-4">The ping tool needs no payment.</p>
          <button className="btn btn-primary btn-sm" onClick={tryPing}>
            Call ping
          </button>
          {pingResult && (
            <pre className="mt-4 text-xs bg-base-200 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {pingResult}
            </pre>
          )}
        </section>

        <section className="bg-base-100 rounded-xl shadow p-6 mb-4 border border-base-300">
          <h2 className="text-xl font-semibold mb-1">3. Pay for a metered call</h2>
          <p className="text-sm text-base-content/70 mb-4">
            Send {manifest?.priceTinybar ?? ""} tinybar to{" "}
            <span className="font-mono">{manifest?.treasury ?? "the treasury"}</span> from any testnet wallet, paste the
            payment transaction id, then call the tool. Each transaction id works exactly once.
          </p>
          <div className="grid grid-cols-1 gap-3">
            <label className="form-control">
              <span className="label-text font-medium mb-1">Tool</span>
              <select className="select select-bordered select-sm" value={tool} onChange={e => setTool(e.target.value)}>
                <option value="account_balance">account_balance (paid)</option>
                <option value="topic_messages">topic_messages (paid)</option>
                <option value="echo">echo (paid)</option>
              </select>
            </label>
            {tool === "account_balance" && (
              <label className="form-control">
                <span className="label-text font-medium mb-1">Account id</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  placeholder="0.0.123"
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                />
              </label>
            )}
            {tool === "topic_messages" && (
              <label className="form-control">
                <span className="label-text font-medium mb-1">Topic id</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  placeholder="0.0.456"
                  value={topicId}
                  onChange={e => setTopicId(e.target.value)}
                />
              </label>
            )}
            {tool === "echo" && (
              <label className="form-control">
                <span className="label-text font-medium mb-1">Message</span>
                <input
                  className="input input-bordered input-sm"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
              </label>
            )}
            <label className="form-control">
              <span className="label-text font-medium mb-1">Payment transaction id</span>
              <input
                className="input input-bordered input-sm font-mono"
                placeholder="0.0.123@1727712000.123456789"
                value={paymentTxId}
                onChange={e => setPaymentTxId(e.target.value)}
              />
            </label>
            <div>
              <button className="btn btn-primary btn-sm" onClick={callMeteredTool} disabled={calling}>
                {calling ? "Calling..." : "Pay and call"}
              </button>
            </div>
          </div>
          {callError && (
            <div className="alert alert-error mt-4">
              <span className="text-sm font-mono break-all">{callError}</span>
            </div>
          )}
          {callResult && (
            <pre className="mt-4 text-xs bg-base-200 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {callResult}
            </pre>
          )}
        </section>

        <section className="bg-base-100 rounded-xl shadow p-6 border border-base-300">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-semibold">4. Recent receipts</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => void loadReceipts()}>
              Refresh
            </button>
          </div>
          <p className="text-sm text-base-content/70 mb-4">
            Paid calls recorded by this server instance. Verify any payment on HashScan.
          </p>
          {receipts.length === 0 ? (
            <p className="text-sm text-base-content/60">No paid calls yet. Make one above.</p>
          ) : (
            <ul className="space-y-3">
              {receipts.map(r => (
                <li key={r.paymentTxId} className="text-sm border border-base-300 rounded-lg p-3">
                  <div className="font-mono font-medium">{r.tool}</div>
                  <div className="font-mono text-xs text-base-content/70 break-all">
                    payer {r.payer} · {r.amount} tinybar · {r.timestamp}
                  </div>
                  <div className="mt-1 space-x-3 text-xs">
                    <a className="link font-mono" href={hashscanTx(r.paymentTxId)} target="_blank" rel="noreferrer">
                      payment
                    </a>
                    {r.payer && (
                      <a className="link font-mono" href={hashscanAccount(r.payer)} target="_blank" rel="noreferrer">
                        payer
                      </a>
                    )}
                    {r.receiptTxId && (
                      <a className="link font-mono" href={hashscanTx(r.receiptTxId)} target="_blank" rel="noreferrer">
                        HCS receipt
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {manifest?.receiptTopicId && (
            <p className="text-sm mt-4">
              <a className="link" href={hashscanTopic(manifest.receiptTopicId)} target="_blank" rel="noreferrer">
                View the receipt topic on HashScan
              </a>{" "}
              ({onChain.length} receipt messages visible via mirror node).
            </p>
          )}
        </section>
      </div>
    </div>
  );
};

export default Home;
