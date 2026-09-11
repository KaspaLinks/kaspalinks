"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { savePrivateRecoveryFile } from "@/lib/private-recovery-download";
import type { PrototypeManifest } from "@/lib/giveaway-prize-v3-prototype";
import {
  createPrototypeRecoveryKey,
  signPrototypeRefund,
  verifyPrototypeRecoveryKey,
} from "./browser";

type Trial = { id: string; manifest: PrototypeManifest };
type Detail = Trial & {
  terms: { fundingSompi: string; open: { address: string }; frozen: { address: string } };
  chain: { daa: string; blueScore: string };
  open: { amount: string }[];
  frozen: { amount: string }[];
};
const endpoint = "/api/toccata-lab/prize-covenant";
const kas = (value: string) => {
  const n = BigInt(value);
  return `${n / 100_000_000n}.${(n % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "") || "0"} KAS`;
};
function headers(): Record<string, string> {
  const token = sessionStorage.getItem("kaspa-actions:creator-token");
  const username = sessionStorage.getItem("kaspa-actions:creator-username");
  if (token && username)
    return {
      "content-type": "application/json",
      "x-creator-username": username,
      authorization: `Bearer ${token}`,
    };
  const initData = window.Telegram?.WebApp?.initData;
  return {
    "content-type": "application/json",
    ...(initData ? { "x-telegram-mini-app-init-data": initData } : {}),
  };
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Request failed.");
  return data as T;
}
export default function PrototypeClient() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chainFresh, setChainFresh] = useState(false);
  const [addresses, setAddresses] = useState("");
  const [prize, setPrize] = useState("20000000");
  const [recovery, setRecovery] = useState<{ id: string; privateKeyHex: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [refundAddress, setRefundAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [txId, setTxId] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const refresh = useCallback(async (id?: string) => {
    if (id) {
      setChainFresh(false);
      setDetail(await api<Detail>(`${endpoint}?id=${encodeURIComponent(id)}`));
      setChainFresh(true);
    } else {
      const data = await api<{ prototypes: Trial[] }>(endpoint);
      setTrials(data.prototypes);
    }
  }, []);
  useEffect(() => {
    void run(() => refresh());
  }, [refresh, run]);
  const selectedId = detail?.id;
  useEffect(() => {
    if (!selectedId) return;
    const update = () => {
      if (document.visibilityState !== "visible") {
        setChainFresh(false);
        return;
      }
      void run(() => refresh(selectedId));
    };
    const timer = window.setInterval(update, 20_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [selectedId, refresh, run]);
  const create = () =>
    run(async () => {
      const key = await createPrototypeRecoveryKey();
      const created = await api<Trial>(endpoint, {
        action: "create",
        input: {
          creatorPublicKeyHex: key.publicKeyHex,
          prizeSompi: prize,
          addresses: addresses.split(/\s+/).filter(Boolean),
        },
      });
      setTrials((current) => [created, ...current]);
      setRecovery({ id: created.id, privateKeyHex: key.privateKeyHex });
      setSaved(false);
      setTxId(null);
      await refresh(created.id);
    });
  const submit = (action: "freeze" | "draw") =>
    run(async () => {
      if (!detail) return;
      const result = await api<{ transactionId: string; winnerAddress: string | null }>(endpoint, {
        action,
        id: detail.id,
      });
      setTxId(result.transactionId);
      setMessage("Submitted. Refresh after the transaction confirms.");
      await refresh(detail.id);
    });
  const recover = (phase: "open" | "frozen") =>
    run(async () => {
      if (!detail || recovery?.id !== detail.id)
        throw new Error("Import this prototype's recovery file first.");
      const prepared = await api<{ transactionSafeJson: string }>(endpoint, {
        action: "prepare-refund",
        id: detail.id,
        phase,
        refundAddress,
      });
      const transactionSafeJson = await signPrototypeRefund({
        ...prepared,
        privateKeyHex: recovery.privateKeyHex,
        publicKeyHex: detail.manifest.creatorPublicKeyHex,
        refundAddress,
      });
      const result = await api<{ transactionId: string }>(endpoint, {
        action: "broadcast-refund",
        id: detail.id,
        phase,
        refundAddress,
        transactionSafeJson,
      });
      setTxId(result.transactionId);
      setMessage("Refund submitted. Refresh after confirmation.");
      await refresh(detail.id);
    });
  const daa = BigInt(detail?.chain.daa ?? "0");
  const refundable = detail ? daa > BigInt(detail.manifest.refundDaa) : false;
  return (
    <main
      className="main giveaway-lab-page covenant-prototype-page"
      style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}
    >
      <Link href="/toccata-lab/giveaway?view=manage">← Giveaways</Link>
      <h1>Prize covenant · Mainnet prototype</h1>
      <p>
        Real KAS. Fixed test participants. The platform attests the list and entropy block; the
        covenant enforces the payout.
      </p>
      <p>
        Two transaction fees of 0.01 KAS each are reserved. Wallet funding has its own fee. Recovery
        unlocks after roughly one hour.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {txId && (
        <p>
          <a href={`https://explorer.kaspa.org/txs/${txId}`} target="_blank" rel="noreferrer">
            View submitted transaction
          </a>
        </p>
      )}
      {!detail ? (
        <section className="card">
          <h2>Create a trial</h2>
          <label htmlFor="prize">Prize</label>
          <select
            id="prize"
            value={prize}
            disabled={busy}
            onChange={(e) => setPrize(e.target.value)}
          >
            <option value="20000000">0.2 KAS</option>
            <option value="50000000">0.5 KAS</option>
            <option value="100000000">1 KAS</option>
          </select>
          <label htmlFor="entrants" style={{ display: "block", marginTop: 16 }}>
            2–8 payout addresses · one per line
          </label>
          <textarea
            id="entrants"
            rows={6}
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            disabled={busy}
            style={{ width: "100%" }}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !addresses.trim()}
            onClick={() => void create()}
          >
            Prepare trial
          </button>
          <h2>Your trials</h2>
          {trials.map((trial) => (
            <p key={trial.id}>
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run(() => refresh(trial.id))}
              >
                {trial.id.slice(-8)} · {kas(trial.manifest.prizeSompi)}
              </button>
            </p>
          ))}
          <Link href="/sign-in">Creator sign-in</Link>
        </section>
      ) : (
        <section className="card">
          <button className="btn" disabled={busy} onClick={() => setDetail(null)}>
            All trials
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(() => refresh(detail.id))}
          >
            Refresh chain state
          </button>
          <h2>1. Save recovery</h2>
          {recovery?.id === detail.id && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await savePrivateRecoveryFile(
                    new File(
                      [
                        JSON.stringify(
                          {
                            format: "kaspalinks-covenant-prototype-v3",
                            id: detail.id,
                            privateKeyHex: recovery.privateKeyHex,
                            manifest: detail.manifest,
                            terms: detail.terms,
                          },
                          null,
                          2,
                        ),
                      ],
                      `covenant-${detail.id}-recovery.json`,
                      { type: "application/json" },
                    ),
                    false,
                  );
                })
              }
            >
              Save recovery file
            </button>
          )}
          <label style={{ display: "block", marginTop: 12 }}>
            Import prototype recovery
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 30_000) throw new Error("Recovery file is too large.");
                  const data = JSON.parse(await file.text());
                  if (
                    data.format !== "kaspalinks-covenant-prototype-v3" ||
                    data.id !== detail.id ||
                    !/^[0-9a-f]{64}$/.test(data.privateKeyHex)
                  )
                    throw new Error("Choose the recovery file for this trial.");
                  await verifyPrototypeRecoveryKey(
                    data.privateKeyHex,
                    detail.manifest.creatorPublicKeyHex,
                  );
                  setRecovery({ id: data.id, privateKeyHex: data.privateKeyHex });
                  setSaved(true);
                });
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={saved && recovery?.id === detail.id}
              disabled={recovery?.id !== detail.id}
              onChange={(e) => setSaved(e.target.checked)}
            />{" "}
            I saved this trial's recovery file privately.
          </label>
          <h2>2. Fund</h2>
          {chainFresh &&
          saved &&
          recovery?.id === detail.id &&
          daa < BigInt(detail.manifest.closesAtDaa) &&
          detail.open.length === 0 &&
          detail.frozen.length === 0 ? (
            <>
              <p>
                Send exactly <strong>{kas(detail.terms.fundingSompi)}</strong> in one payment.
              </p>
              <p style={{ overflowWrap: "anywhere" }}>{detail.terms.open.address}</p>
              <button
                className="btn"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(detail.terms.open.address);
                    setMessage("Funding address copied.");
                  })
                }
              >
                Copy funding address
              </button>
            </>
          ) : (
            <p>
              {detail.open.length > 0
                ? "Unspent open-state output detected."
                : detail.frozen.length > 0
                  ? "Unspent frozen-state output detected."
                  : "Save recovery first. Funding is available only before entries close."}
            </p>
          )}
          <h2>3. Freeze and draw</h2>
          <p>Each step costs 0.01 KAS from the reserved fees.</p>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              refundable ||
              !detail.open.some((entry) => entry.amount === detail.terms.fundingSompi) ||
              daa <= BigInt(detail.manifest.closesAtDaa)
            }
            onClick={() => void submit("freeze")}
          >
            Freeze participants
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              refundable ||
              !detail.frozen.some(
                (entry) =>
                  BigInt(entry.amount) ===
                  BigInt(detail.manifest.prizeSompi) + BigInt(detail.manifest.drawFeeSompi),
              ) ||
              BigInt(detail.chain.blueScore) < BigInt(detail.manifest.entropyTargetBlueScore) + 100n
            }
            onClick={() => void submit("draw")}
          >
            Draw and pay winner
          </button>
          <details style={{ marginTop: 20 }}>
            <summary>Recovery and committed details</summary>
            <p>
              Recovery signs only in this browser. Fee: 0.01 KAS. The recovery file is never
              uploaded.
            </p>
            <label htmlFor="refund-address">Refund destination</label>
            <input
              id="refund-address"
              value={refundAddress}
              onChange={(e) => setRefundAddress(e.target.value)}
              style={{ width: "100%" }}
            />
            {(["open", "frozen"] as const).map((phase) => (
              <button
                key={phase}
                className="btn"
                disabled={
                  busy ||
                  !refundable ||
                  detail[phase].length === 0 ||
                  recovery?.id !== detail.id ||
                  !refundAddress
                }
                onClick={() => void recover(phase)}
              >
                Refund {phase} output
              </button>
            ))}
            <p>
              Close DAA: {detail.manifest.closesAtDaa}
              <br />
              Refund DAA: {detail.manifest.refundDaa}
              <br />
              Entropy target blue score: {detail.manifest.entropyTargetBlueScore}
            </p>
            <ol>
              {detail.manifest.entries.map((e) => (
                <li key={e.hash} style={{ overflowWrap: "anywhere" }}>
                  {e.address}
                </li>
              ))}
            </ol>
            <p>
              Missing outputs do not prove a payout. Check submitted transactions in the explorer.
            </p>
          </details>
        </section>
      )}
    </main>
  );
}
