"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getKaswareProvider,
  readKaswareBalance,
  readKaswareNetwork,
  sendKaspaPayment,
  WalletAdapterError,
} from "@kaspa-actions/wallet-adapter";

import { createToccataLabKeyPair } from "@/lib/toccata-lab-keys";
import { encodeClaimableFragmentPayload } from "@/lib/claimable-share";
import {
  readEncryptedLocalJson,
  removeEncryptedLocalJson,
  writeEncryptedLocalJson,
} from "@/lib/claimable-vault";
import {
  formatSompiForToccataLab,
  planToccataCanaryExpiry,
  planToccataCanarySpendFromKas,
  TOCCATA_CANARY_DEFAULT_FEE_SOMPI,
  type ToccataCanaryExpiryUnit,
} from "@/lib/toccata-lab-fee";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";

import {
  buildBatchActivationSpendInBrowser,
  buildClaimableSpendInBrowser,
} from "../claimable-browser";
type Capabilities = { missing: string[]; ready: boolean; version: string };

type FundingMatch = {
  amountSompi: string;
  blockTime: null | number;
  outputIndex: number;
  transactionId: string;
};

type BatchLink = {
  amountKas: string;
  amountSompi: string;
  claimCode: string;
  claimPublicKey: string;
  description: string;
  feeKas: string;
  feeSompi: string;
  fundingAddress: string;
  fundingMatch: FundingMatch | null;
  id: string;
  netClaimKas: string;
  redeemScriptHex: string;
  refundCode: string;
  refundLockTime: string;
  refundPublicKey: string;
  scriptPublicKeyHex: string;
  status: "awaiting_activation" | "funded" | "spent";
  title: string;
};

type BatchRecord = {
  activation: {
    activationCode: string;
    activationPublicKey: string;
    activationFeeSompi: string;
    fundingAddress: string;
    fundingAmountSompi: string;
    fundingMatch: FundingMatch | null;
    redeemScriptHex: string;
    refundCode: string;
    refundPublicKey: string;
    status: "awaiting_funding" | "funded" | "activated" | "refunded";
  };
  createdAt: string;
  createdAtMs: number;
  id: string;
  links: BatchLink[];
  title: string;
  validFor: string;
  version: 2;
};

type ScriptResponse = {
  scripts: Array<{
    fundingAddress: string;
    redeemScriptHex: string;
    scriptPublicKey: { script: string; version: number };
  }>;
};

const STORAGE_KEY = "kaspalinks.claimable-batch-lab.v1";
const CLAIM_PREFIX = "lab-claim=";
const REFUND_PREFIX = "lab-manage=";
const MAX_BATCH_SIZE = 10;
const BATCH_ACTIVATION_FEE_SOMPI = 1_000_000n;
const FUNDING_SAFE_CHANGE_SOMPI = 20_000_000n;

export function BatchClaimableLabClient({
  capabilities,
  enabled,
}: {
  capabilities: Capabilities;
  enabled: boolean;
}) {
  const [amountKas, setAmountKas] = useState("1");
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [count, setCount] = useState("10");
  const [description, setDescription] = useState(
    "A Kaspa reward for the first person to claim it.",
  );
  const [error, setError] = useState("");
  const [expiryUnit, setExpiryUnit] = useState<ToccataCanaryExpiryUnit>("hours");
  const [expiryValue, setExpiryValue] = useState("24");
  const [feeKas, setFeeKas] = useState(formatSompiForToccataLab(TOCCATA_CANARY_DEFAULT_FEE_SOMPI));
  const [generating, setGenerating] = useState(false);
  const [linkTitles, setLinkTitles] = useState(() => defaultLinkTitles(10));
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [fundingWithKasware, setFundingWithKasware] = useState(false);
  const [isTouchOnly, setIsTouchOnly] = useState<null | boolean>(null);
  const [refundAddress, setRefundAddress] = useState("");
  const [title, setTitle] = useState("Community claim drop");

  useEffect(() => {
    void readEncryptedLocalJson<BatchRecord>(STORAGE_KEY).then(({ value }) => {
      if (value?.version === 2 && Array.isArray(value.links)) setBatch(value);
    });
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    setIsTouchOnly(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const summary = useMemo(() => {
    if (!batch) return null;
    const funded = batch.links.filter((link) => link.status === "funded").length;
    const spent = batch.links.filter((link) => link.status === "spent").length;
    return {
      funded,
      spent,
      waiting: batch.links.length - funded - spent,
      activation: batch.activation.status,
    };
  }, [batch]);

  const batchFundingAmountKas = useMemo(
    () => (batch ? formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi)) : ""),
    [batch],
  );
  const batchFundingWalletUri = useMemo(
    () =>
      batch
        ? buildWalletLaunchUri({
            amountKas: batchFundingAmountKas,
            recipientAddress: batch.activation.fundingAddress,
          })
        : "",
    [batch, batchFundingAmountKas],
  );

  function persist(next: BatchRecord | null) {
    setBatch(next);
    if (!next) {
      removeEncryptedLocalJson(STORAGE_KEY);
      return;
    }
    void writeEncryptedLocalJson(STORAGE_KEY, next).catch(() => {
      setError(
        "Could not encrypt the local batch recovery record. Keep the exported recovery file safe.",
      );
    });
  }

  function changeLinkCount(nextCount: string) {
    const parsedCount = Number.parseInt(nextCount, 10);
    setCount(nextCount);
    if (!Number.isInteger(parsedCount) || parsedCount < 2 || parsedCount > MAX_BATCH_SIZE) return;
    setLinkTitles((current) => resizeLinkTitles(current, parsedCount));
  }

  function changeLinkTitle(index: number, nextTitle: string) {
    setLinkTitles((current) =>
      current.map((title, currentIndex) => (currentIndex === index ? nextTitle : title)),
    );
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!enabled) {
      setError("The private batch claim lab is disabled on this deployment.");
      return;
    }
    if (!capabilities.ready) {
      setError("The Toccata SDK capability gate is not ready.");
      return;
    }
    if (!readCreatorAuthHeaders()) {
      setError("Sign in as a creator first so every child link can be registered safely.");
      return;
    }

    const linkCount = Number.parseInt(count, 10);
    if (!Number.isInteger(linkCount) || linkCount < 2 || linkCount > MAX_BATCH_SIZE) {
      setError(`Choose between 2 and ${MAX_BATCH_SIZE} links for this private lab.`);
      return;
    }

    const normalizedLinkTitles = linkTitles.slice(0, linkCount).map((value, index) => {
      const normalized = value.trim().slice(0, 80);
      return normalized || `Claim link #${index + 1}`;
    });

    setGenerating(true);
    try {
      const daaResponse = await fetch("/api/toccata-lab/dag-info");
      const daaBody = (await daaResponse.json()) as {
        virtualDaaScore?: string;
        error?: { message: string };
      };
      if (!daaResponse.ok || !daaBody.virtualDaaScore) {
        throw new Error(daaBody.error?.message ?? "Could not read the current Kaspa DAA score.");
      }

      const spendPlan = planToccataCanarySpendFromKas({ amountKas, feeKas });
      const expiryPlan = planToccataCanaryExpiry({
        currentDaaScore: daaBody.virtualDaaScore,
        durationValue: expiryValue,
        unit: expiryUnit,
      });
      if (!spendPlan.meetsMinimumOutput) {
        throw new Error(`Net claim output must stay above ${spendPlan.minimumOutputKas} KAS.`);
      }

      const keyPairs = Array.from({ length: linkCount }, () => ({
        claim: createToccataLabKeyPair(),
        refund: createToccataLabKeyPair(),
      }));
      const scriptResponse = await fetch("/api/toccata-lab/batch-scripts", {
        body: JSON.stringify({
          links: keyPairs.map(({ claim, refund }) => ({
            linkPublicKey: claim.xOnlyPublicKey,
            refundPublicKey: refund.xOnlyPublicKey,
          })),
          refundLockTime: expiryPlan.refundLockTime.toString(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const scriptBody = (await scriptResponse.json()) as
        | ScriptResponse
        | { error?: { message?: string } };
      if (
        !scriptResponse.ok ||
        !("scripts" in scriptBody) ||
        scriptBody.scripts.length !== linkCount
      ) {
        throw new Error(
          "error" in scriptBody
            ? (scriptBody.error?.message ?? "Could not derive batch funding addresses.")
            : "Could not derive batch funding addresses.",
        );
      }

      const activation = createToccataLabKeyPair();
      const batchRefund = createToccataLabKeyPair();
      const allocatorResponse = await fetch("/api/toccata-lab/batch-allocator-script", {
        body: JSON.stringify({
          activationPublicKey: activation.xOnlyPublicKey,
          outputs: scriptBody.scripts.map((script) => ({
            amountSompi: spendPlan.utxoSompi.toString(),
            scriptPublicKeyHex: serializeScriptPublicKey(script.scriptPublicKey),
          })),
          refundLockTime: expiryPlan.refundLockTime.toString(),
          refundPublicKey: batchRefund.xOnlyPublicKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const allocatorBody = (await allocatorResponse.json()) as {
        allocator?: { fundingAddress: string; redeemScriptHex: string };
        error?: { message?: string };
      };
      if (!allocatorResponse.ok || !allocatorBody.allocator) {
        throw new Error(
          allocatorBody.error?.message ?? "Could not create the batch funding contract.",
        );
      }

      const createdAt = new Date();
      const batchId = `batch-${createdAt.getTime().toString(36)}-${randomToken().slice(0, 8)}`;
      const normalizedTitle = title.trim().slice(0, 80) || "Community claim drop";
      const normalizedDescription =
        description.trim().slice(0, 180) || "Claim this Kaspa reward to your own wallet.";
      const next: BatchRecord = {
        activation: {
          activationCode: activation.privateKey,
          activationFeeSompi: BATCH_ACTIVATION_FEE_SOMPI.toString(),
          activationPublicKey: activation.xOnlyPublicKey,
          fundingAddress: allocatorBody.allocator.fundingAddress,
          fundingAmountSompi: (
            spendPlan.utxoSompi * BigInt(linkCount) +
            BATCH_ACTIVATION_FEE_SOMPI
          ).toString(),
          fundingMatch: null,
          redeemScriptHex: allocatorBody.allocator.redeemScriptHex,
          refundCode: batchRefund.privateKey,
          refundPublicKey: batchRefund.xOnlyPublicKey,
          status: "awaiting_funding",
        },
        createdAt: createdAt.toISOString(),
        createdAtMs: createdAt.getTime(),
        id: batchId,
        links: scriptBody.scripts.map((script, index) => ({
          amountKas: spendPlan.utxoKas,
          amountSompi: spendPlan.utxoSompi.toString(),
          claimCode: keyPairs[index]!.claim.privateKey,
          claimPublicKey: keyPairs[index]!.claim.xOnlyPublicKey,
          description: normalizedDescription,
          feeKas: spendPlan.feeKas,
          feeSompi: spendPlan.feeSompi.toString(),
          fundingAddress: script.fundingAddress,
          fundingMatch: null,
          id: `${batchId}-${String(index + 1).padStart(2, "0")}`,
          netClaimKas: spendPlan.netOutputKas,
          redeemScriptHex: script.redeemScriptHex,
          refundCode: keyPairs[index]!.refund.privateKey,
          refundLockTime: expiryPlan.refundLockTime.toString(),
          refundPublicKey: keyPairs[index]!.refund.xOnlyPublicKey,
          scriptPublicKeyHex: serializeScriptPublicKey(script.scriptPublicKey),
          status: "awaiting_activation",
          title: normalizedLinkTitles[index]!,
        })),
        title: normalizedTitle,
        validFor: expiryPlan.durationLabel,
        version: 2,
      };
      for (const link of next.links) {
        await registerBatchClaimableLink(link);
      }
      persist(next);
      setNotice(
        `The batch contract was generated locally. Fund its one-time address with the exact total, then activate the committed child outputs before exporting claim URLs.`,
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the batch.");
    } finally {
      setGenerating(false);
    }
  }

  async function checkFunding() {
    if (!batch) return;
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/toccata-lab/funding-status", {
        body: JSON.stringify({
          amountSompi: batch.activation.fundingAmountSompi,
          fundingAddress: batch.activation.fundingAddress,
          notBefore: batch.createdAtMs,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        funded?: boolean;
        match?: FundingMatch | null;
        outputStatus?: "funded_unspent" | "spent" | "unfunded";
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not check batch funding.");
      const next = {
        ...batch,
        activation:
          body.funded && body.match
            ? {
                ...batch.activation,
                fundingMatch: body.match,
                status:
                  body.outputStatus === "spent" ? ("activated" as const) : ("funded" as const),
              }
            : batch.activation,
      };
      persist(next);
      setNotice(
        body.funded && body.match
          ? "Funding detected. Activate the batch to create the individual claim outputs."
          : "No exact batch funding output found yet.",
      );
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Could not check batch funding.");
    } finally {
      setChecking(false);
    }
  }

  function openBatchFundingWallet() {
    if (!batchFundingWalletUri || !batch) return;
    setError("");
    setNotice(
      `Opening Kaspium with ${batchFundingAmountKas} KAS and the one-time batch address. Return here after sending; funding will be checked automatically.`,
    );
    window.setTimeout(() => void checkFunding(), 2_500);
    window.setTimeout(() => void checkFunding(), 7_000);
    window.location.assign(batchFundingWalletUri);
  }

  async function fundBatchWithKasware() {
    if (!batch || batch.activation.status !== "awaiting_funding") return;

    setError("");
    setNotice("");
    setFundingWithKasware(true);
    try {
      const provider = getKaswareProvider();
      if (!provider) {
        throw new WalletAdapterError(
          "KasWare was not detected. Install the extension or open this page on mobile for Kaspium.",
          { code: "KASWARE_UNAVAILABLE" },
        );
      }

      const network = await readKaswareNetwork(provider);
      if (network !== "mainnet") {
        throw new WalletAdapterError(
          network === "unknown"
            ? "Could not verify KasWare's network. Switch KasWare to mainnet and retry."
            : `Switch KasWare to mainnet before funding. It is currently on ${network}.`,
          { code: "KASWARE_WRONG_NETWORK" },
        );
      }

      const fundingAmountSompi = BigInt(batch.activation.fundingAmountSompi);
      try {
        const balance = await readKaswareBalance(provider);
        if (balance) {
          const confirmed = BigInt(balance.confirmed);
          if (confirmed < fundingAmountSompi) {
            throw new WalletAdapterError(
              "KasWare's confirmed balance is lower than the exact batch funding total.",
              { code: "KASWARE_INSUFFICIENT_BALANCE" },
            );
          }
          if (confirmed - fundingAmountSompi < FUNDING_SAFE_CHANGE_SOMPI) {
            setNotice(
              "Your remaining KasWare change may be too small for Kaspa's storage-mass rule. If funding is rejected, use a wallet with a larger consolidated balance.",
            );
          }
        }
      } catch (balanceError) {
        if (balanceError instanceof WalletAdapterError) throw balanceError;
      }

      let result: Awaited<ReturnType<typeof sendKaspaPayment>> | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await sendKaspaPayment(provider, {
            amountSompi: fundingAmountSompi,
            toAddress: batch.activation.fundingAddress,
          });
          break;
        } catch (attemptError) {
          const message =
            attemptError instanceof Error ? attemptError.message : String(attemptError);
          const transient = /not connected|websocket|rpc server/i.test(message);
          if (attempt < 3 && transient) {
            setNotice("KasWare is connecting to the network — retrying…");
            await new Promise((resolve) => window.setTimeout(resolve, 1_200));
            continue;
          }
          throw attemptError;
        }
      }
      if (!result) {
        throw new WalletAdapterError("KasWare did not complete the batch funding transaction.", {
          code: "KASWARE_FUNDING_FAILED",
        });
      }

      setNotice(
        `KasWare sent the batch funding transaction ${compactTransactionId(result.txId)}. Checking the one-time address now.`,
      );
      window.setTimeout(() => void checkFunding(), 1_500);
      window.setTimeout(() => void checkFunding(), 5_000);
    } catch (fundingError) {
      setError(
        fundingError instanceof Error
          ? fundingError.message
          : "KasWare did not complete the batch funding transaction.",
      );
    } finally {
      setFundingWithKasware(false);
    }
  }

  async function copyBatchFundingAddress() {
    if (!batch) return;
    try {
      await navigator.clipboard.writeText(batch.activation.fundingAddress);
      setError("");
      setNotice("Batch funding address copied.");
    } catch {
      setError("Could not copy the batch funding address.");
    }
  }

  async function activateBatch() {
    if (!batch?.activation.fundingMatch || batch.activation.status !== "funded") return;
    setChecking(true);
    setError("");
    try {
      const spend = await buildBatchActivationSpendInBrowser({
        activationPrivateKey: batch.activation.activationCode,
        expectedFundingAddress: batch.activation.fundingAddress,
        feeSompi: batch.activation.activationFeeSompi,
        fundingAmountSompi: batch.activation.fundingAmountSompi,
        fundingOutputIndex: batch.activation.fundingMatch.outputIndex,
        fundingTransactionId: batch.activation.fundingMatch.transactionId,
        outputs: batch.links.map((link) => ({
          amountSompi: link.amountSompi,
          redeemScriptHex: link.redeemScriptHex,
        })),
        redeemScriptHex: batch.activation.redeemScriptHex,
      });
      const response = await fetch("/api/toccata-lab/batch-activate", {
        body: JSON.stringify({
          expectedTransactionId: spend.transactionId,
          transactionSafeJson: spend.transactionSafeJson,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        broadcast?: { transactionId: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.broadcast)
        throw new Error(body.error?.message ?? "Could not activate the batch.");
      const next = {
        ...batch,
        activation: { ...batch.activation, status: "activated" as const },
        links: batch.links.map((link, index) => ({
          ...link,
          fundingMatch: {
            amountSompi: link.amountSompi,
            blockTime: null,
            outputIndex: index,
            transactionId: body.broadcast!.transactionId,
          },
          status: "funded" as const,
        })),
      };
      persist(next);
      setNotice(
        `Batch activation was accepted. ${next.links.length} individual claim outputs are ready; you can now export the claim URLs.`,
      );
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Could not activate the batch.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function refundUnactivatedBatch() {
    if (!batch?.activation.fundingMatch || batch.activation.status !== "funded") return;
    setChecking(true);
    setError("");
    try {
      const refundLockTime = batch.links[0]?.refundLockTime;
      if (!refundLockTime) throw new Error("Batch refund lock time is unavailable.");
      const spend = await buildClaimableSpendInBrowser({
        destinationAddress: refundAddress,
        expectedFundingAddress: batch.activation.fundingAddress,
        feeSompi: batch.activation.activationFeeSompi,
        fundingAmountSompi: batch.activation.fundingAmountSompi,
        fundingOutputIndex: batch.activation.fundingMatch.outputIndex,
        fundingTransactionId: batch.activation.fundingMatch.transactionId,
        lockTime: refundLockTime,
        mode: "refund",
        privateKey: batch.activation.refundCode,
        redeemScriptHex: batch.activation.redeemScriptHex,
      });
      const response = await fetch("/api/toccata-lab/batch-refund", {
        body: JSON.stringify({
          expectedTransactionId: spend.transactionId,
          refundLockTime,
          transactionSafeJson: spend.transactionSafeJson,
        }),
        headers: readCreatorAuthHeaders() ?? { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        broadcast?: { transactionId: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.broadcast)
        throw new Error(body.error?.message ?? "Could not refund the batch.");
      persist({ ...batch, activation: { ...batch.activation, status: "refunded" } });
      setNotice("The unactivated batch refund was accepted. No claim URLs were distributed.");
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : "Could not refund the batch.");
    } finally {
      setChecking(false);
    }
  }

  function downloadFundingPlan() {
    if (!batch) return;
    downloadCsv(
      "kaspa-links-batch-funding.csv",
      ["batch_name", "funding_address", "exact_total_kas", "activation_fee_kas", "status"],
      [
        [
          batch.title,
          batch.activation.fundingAddress,
          formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi)),
          formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi)),
          batch.activation.status,
        ],
      ],
    );
  }

  function downloadClaimLinks() {
    if (!batch) return;
    const funded = batch.links.filter((link) => link.status === "funded" && link.fundingMatch);
    downloadCsv(
      "kaspa-links-batch-claim-links.csv",
      ["number", "title", "claim_url", "amount_kas", "valid_for"],
      funded.map((link, index) => [
        index + 1,
        link.title,
        buildClaimUrl(link, batch),
        link.netClaimKas,
        batch.validFor,
      ]),
    );
  }

  function downloadRecoveryFile() {
    if (!batch) return;
    const funded = batch.links.filter((link) => link.status === "funded" && link.fundingMatch);
    downloadCsv(
      "kaspa-links-batch-private-recovery.csv",
      ["warning", "number", "title", "private_refund_url", "status"],
      funded.map((link, index) => [
        "KEEP PRIVATE - this URL can refund unclaimed KAS after expiry",
        index + 1,
        link.title,
        buildRefundUrl(link, batch),
        link.status,
      ]),
    );
  }

  function openIndividualRefund(link: BatchLink) {
    const activeBatch = batch;
    if (!activeBatch) return;
    const refundUrl = buildRefundUrl(link, activeBatch);
    if (!refundUrl) return;
    window.open(refundUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="main-wide toccata-lab-page">
      <section className="hero toccata-lab-hero">
        <span className="hero-eyebrow">Private lab</span>
        <h1 className="hero-title">Batch claim links.</h1>
        <p className="hero-sub">
          Fund one contract address once, then activate the exact child claim outputs in your
          browser. This test tool is protected and unlisted; it is not part of the public creator
          flow.
        </p>
      </section>

      <section className="batch-lab-warning" role="note">
        <span className="batch-lab-warning-label">Before you fund</span>
        <strong>Every claim link is separate digital cash.</strong>
        <p>
          Claim and recovery URLs carry bearer codes. Your browser creates them and the server never
          receives them. The batch contract fixes every child amount and destination before you pay.
        </p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {!error && notice ? <p className="success-text">{notice}</p> : null}

      <div className="batch-lab-grid">
        <section className="card batch-lab-panel">
          <header className="batch-lab-panel-heading">
            <span className="batch-lab-step">1</span>
            <div>
              <span className="label">Configure</span>
              <h2 className="form-section-heading">Create a claim drop</h2>
              <p>Choose the shared settings, then give each claim link a clear name.</p>
            </div>
          </header>
          <form className="claimable-lab-form" onSubmit={createBatch}>
            <div className="batch-lab-form-section">
              <div>
                <label className="label" htmlFor="batch-title">
                  Drop name
                </label>
                <input
                  id="batch-title"
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
              </div>
              <div>
                <label className="label" htmlFor="batch-description">
                  Description
                </label>
                <textarea
                  id="batch-description"
                  maxLength={180}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  value={description}
                />
              </div>
            </div>

            <div className="batch-lab-form-section">
              <span className="batch-lab-section-title">Distribution</span>
              <div className="grid-two">
                <div>
                  <label className="label" htmlFor="batch-count">
                    Number of links
                  </label>
                  <select
                    id="batch-count"
                    onChange={(event) => changeLinkCount(event.target.value)}
                    value={count}
                  >
                    <option value="2">2 links</option>
                    <option value="5">5 links</option>
                    <option value="10">10 links</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="batch-amount">
                    KAS per link
                  </label>
                  <input
                    id="batch-amount"
                    inputMode="decimal"
                    onChange={(event) => setAmountKas(event.target.value.replace(",", "."))}
                    value={amountKas}
                  />
                </div>
              </div>
            </div>

            <fieldset className="batch-link-name-list">
              <legend className="batch-lab-section-title">Individual link names</legend>
              <p className="muted">These names appear on the claim pages and in your export.</p>
              {linkTitles.slice(0, Number.parseInt(count, 10)).map((linkTitle, index) => (
                <label
                  className="batch-link-name-row"
                  htmlFor={`batch-link-title-${index + 1}`}
                  key={index}
                >
                  <span className="batch-link-number">{index + 1}</span>
                  <input
                    id={`batch-link-title-${index + 1}`}
                    maxLength={80}
                    onChange={(event) => changeLinkTitle(index, event.target.value)}
                    value={linkTitle}
                  />
                </label>
              ))}
            </fieldset>
            <div className="batch-lab-form-section">
              <span className="batch-lab-section-title">Timing and network fee</span>
              <div className="grid-two">
                <div>
                  <label className="label" htmlFor="batch-expiry">
                    Claim window
                  </label>
                  <input
                    id="batch-expiry"
                    inputMode="numeric"
                    onChange={(event) => setExpiryValue(event.target.value)}
                    value={expiryValue}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="batch-unit">
                    Unit
                  </label>
                  <select
                    id="batch-unit"
                    onChange={(event) =>
                      setExpiryUnit(event.target.value as ToccataCanaryExpiryUnit)
                    }
                    value={expiryUnit}
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="minutes">Minutes</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="batch-fee">
                  Claim/refund fee per link
                </label>
                <input
                  id="batch-fee"
                  inputMode="decimal"
                  onChange={(event) => setFeeKas(event.target.value.replace(",", "."))}
                  value={feeKas}
                />
              </div>
            </div>

            <p className="notice notice-warn batch-lab-exact-notice">
              Fund the generated address with the exact total. Extra KAS cannot be distributed to
              the fixed child links.
            </p>
            <button
              className="btn btn-primary"
              disabled={!enabled || !capabilities.ready || generating}
              type="submit"
            >
              {generating ? "Generating contracts..." : "Generate batch"}
            </button>
          </form>
        </section>

        <section className="card batch-lab-panel batch-lab-status-panel">
          <header className="batch-lab-panel-heading">
            <span className="batch-lab-step">2</span>
            <div>
              <span className="label">Fund and activate</span>
              <h2 className="form-section-heading">Batch status</h2>
              <p>One payment funds the batch. Activation then creates each claim output.</p>
            </div>
          </header>
          {batch && summary ? (
            <>
              <div className="batch-lab-stats">
                <div>
                  <span className="label">Waiting</span>
                  <strong>{summary.waiting}</strong>
                </div>
                <div>
                  <span className="label">Funded</span>
                  <strong>{summary.funded}</strong>
                </div>
                <div>
                  <span className="label">Spent</span>
                  <strong>{summary.spent}</strong>
                </div>
              </div>
              <p className="batch-lab-summary">
                <span>{batch.links.length} links</span>
                <span>{batch.links[0]?.amountKas} KAS each</span>
                <span>Valid for {batch.validFor}</span>
              </p>
              <div className="batch-lab-funding-callout">
                <span className="label">One-time batch address</span>
                <code className="batch-lab-address">{batch.activation.fundingAddress}</code>
                <div className="batch-lab-funding-amount">
                  <span>Exact total</span>
                  <strong>
                    {formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi))} KAS
                  </strong>
                </div>
                <p className="muted">
                  Includes {formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi))}{" "}
                  KAS activation fee. {batchActivationStatusText(batch.activation.status)}
                </p>
                <div className="batch-lab-wallet-options">
                  {isTouchOnly === null ? (
                    <button className="btn btn-primary" disabled type="button">
                      Preparing wallet…
                    </button>
                  ) : isTouchOnly ? (
                    <button
                      className="btn btn-primary"
                      disabled={batch.activation.status !== "awaiting_funding"}
                      onClick={openBatchFundingWallet}
                      type="button"
                    >
                      Open in Kaspium
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={
                        fundingWithKasware || batch.activation.status !== "awaiting_funding"
                      }
                      onClick={() => void fundBatchWithKasware()}
                      type="button"
                    >
                      {fundingWithKasware ? "Opening KasWare…" : "Fund with KasWare"}
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => void copyBatchFundingAddress()}
                    type="button"
                  >
                    Copy address
                  </button>
                </div>
                <p className="batch-lab-wallet-note">
                  The wallet receives the exact total and one-time funding address. You still review
                  and approve the transaction inside Kaspium or KasWare.
                </p>
              </div>

              <div className="batch-lab-action-group">
                <span className="batch-lab-section-title">Confirm and activate</span>
                <div className="batch-lab-actions">
                  <button className="btn" onClick={downloadFundingPlan} type="button">
                    Funding plan
                  </button>
                  <button
                    className="btn"
                    disabled={checking}
                    onClick={() => void checkFunding()}
                    type="button"
                  >
                    {checking ? "Checking funding..." : "Check funding"}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={checking || batch.activation.status !== "funded"}
                    onClick={() => void activateBatch()}
                    type="button"
                  >
                    {checking && batch.activation.status === "funded"
                      ? "Activating batch..."
                      : "Activate batch"}
                  </button>
                </div>
              </div>

              <div className="batch-lab-action-group">
                <span className="batch-lab-section-title">Export after activation</span>
                <div className="batch-lab-actions">
                  <button
                    className="btn"
                    disabled={summary.funded === 0}
                    onClick={downloadClaimLinks}
                    type="button"
                  >
                    Claim URLs
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={summary.funded === 0}
                    onClick={downloadRecoveryFile}
                    type="button"
                  >
                    Private recovery file
                  </button>
                </div>
              </div>
              {batch.activation.status === "funded" ? (
                <div className="batch-lab-refund">
                  <span className="label">Fallback after expiry</span>
                  <p className="muted">
                    If you decide not to activate this drop, wait until its claim window ends and
                    recover the whole unactivated batch to your own address.
                  </p>
                  <label className="label" htmlFor="batch-refund-address">
                    Refund address
                  </label>
                  <input
                    id="batch-refund-address"
                    onChange={(event) => setRefundAddress(event.target.value)}
                    placeholder="kaspa:..."
                    value={refundAddress}
                  />
                  <button
                    className="btn btn-danger"
                    disabled={checking || refundAddress.trim().length === 0}
                    onClick={() => void refundUnactivatedBatch()}
                    type="button"
                  >
                    Refund unactivated batch after expiry
                  </button>
                </div>
              ) : null}
              <div className="batch-lab-link-section">
                <span className="batch-lab-section-title">Individual claim outputs</span>
                <ul className="batch-lab-link-list">
                  {batch.links.map((link, index) => (
                    <li className="batch-lab-link-item" key={link.id}>
                      <span className="batch-link-number">{index + 1}</span>
                      <div className="batch-lab-link-copy">
                        <strong>{link.title}</strong>
                        <code title={link.fundingAddress}>
                          {compactAddress(link.fundingAddress)}
                        </code>
                      </div>
                      <span className={`batch-lab-link-status is-${link.status}`}>
                        {humanStatus(link.status)}
                      </span>
                      <button
                        className="batch-lab-recovery-button"
                        disabled={!link.fundingMatch || link.status === "spent"}
                        onClick={() => openIndividualRefund(link)}
                        type="button"
                      >
                        Refund
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <button className="btn batch-lab-clear" onClick={() => persist(null)} type="button">
                Clear local batch
              </button>
            </>
          ) : (
            <div className="batch-lab-empty">
              <strong>No batch created yet</strong>
              <p>
                Configure your drop on the left. Its private recovery data stays in this browser.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function buildClaimUrl(link: BatchLink, batch: BatchRecord): string {
  if (!link.fundingMatch) return "";
  return `${window.location.origin}/claim?link=${encodeURIComponent(link.id)}#${CLAIM_PREFIX}${encodePayload(
    {
      amountKas: link.amountKas,
      amountSompi: link.amountSompi,
      claimCode: link.claimCode,
      claimPublicKey: link.claimPublicKey,
      createdAt: batch.createdAt,
      createdAtMs: batch.createdAtMs,
      description: link.description,
      feeKas: link.feeKas,
      feeSompi: link.feeSompi,
      fundingAddress: link.fundingAddress,
      fundingMatch: link.fundingMatch,
      id: link.id,
      netClaimKas: link.netClaimKas,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      title: link.title,
      validFor: batch.validFor,
      version: 1,
    },
  )}`;
}

function readCreatorAuthHeaders(): Record<string, string> | null {
  const token = window.sessionStorage.getItem("kaspa-actions:creator-token") ?? "";
  const username = window.sessionStorage.getItem("kaspa-actions:creator-username") ?? "";
  if (!token || !username) return null;
  return {
    "content-type": "application/json",
    "x-creator-token": token,
    "x-creator-username": username,
  };
}

async function registerBatchClaimableLink(link: BatchLink): Promise<void> {
  const headers = readCreatorAuthHeaders();
  if (!headers) throw new Error("Creator session is required to register batch links.");
  const response = await fetch("/api/creator/claimable-links", {
    body: JSON.stringify({
      amountSompi: link.amountSompi,
      claimPublicKey: link.claimPublicKey,
      description: link.description,
      feeSompi: link.feeSompi,
      fundingAddress: link.fundingAddress,
      linkKey: link.id,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      refundPublicKey: link.refundPublicKey,
      title: link.title,
    }),
    headers,
    method: "POST",
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Could not register ${link.title}.`);
  }
}

function buildRefundUrl(link: BatchLink, batch: BatchRecord): string {
  if (!link.fundingMatch) return "";
  return `${window.location.origin}/claim/refund#${REFUND_PREFIX}${encodePayload({
    amountKas: link.amountKas,
    amountSompi: link.amountSompi,
    createdAt: batch.createdAt,
    createdAtMs: batch.createdAtMs,
    description: link.description,
    feeKas: link.feeKas,
    feeSompi: link.feeSompi,
    fundingAddress: link.fundingAddress,
    fundingMatch: link.fundingMatch,
    id: link.id,
    netClaimKas: link.netClaimKas,
    redeemScriptHex: link.redeemScriptHex,
    refundCode: link.refundCode,
    refundLockTime: link.refundLockTime,
    refundPublicKey: link.refundPublicKey,
    title: link.title,
    validFor: batch.validFor,
    version: 1,
  })}`;
}

function encodePayload(payload: unknown): string {
  return encodeClaimableFragmentPayload(payload);
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<number | string>>) {
  const escape = (value: number | string) => `"${String(value).replaceAll('"', '""')}"`;
  const text = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function compactAddress(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function compactTransactionId(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function humanStatus(status: BatchLink["status"]): string {
  return status === "awaiting_activation"
    ? "Awaiting batch activation"
    : status === "funded"
      ? "Funded"
      : "Spent";
}

function batchActivationStatusText(status: BatchRecord["activation"]["status"]): string {
  switch (status) {
    case "awaiting_funding":
      return "Waiting for the exact funding output.";
    case "funded":
      return "Funding found. Activate the batch next.";
    case "activated":
      return "Activation accepted; the individual claim outputs are ready.";
    case "refunded":
      return "The unactivated batch was refunded.";
  }
}

function serializeScriptPublicKey(value: { script: string; version: number }): string {
  return value.version.toString(16).padStart(4, "0") + value.script.toLowerCase();
}

function defaultLinkTitles(count: number): string[] {
  const examples = [
    "X giveaway",
    "Discord community",
    "Telegram community",
    "Community reward",
    "Creator drop",
    "Stream reward",
    "Early supporter reward",
    "Newsletter giveaway",
    "Partner community",
    "Final giveaway slot",
  ];
  return Array.from({ length: count }, (_, index) => examples[index] ?? `Claim link #${index + 1}`);
}

function resizeLinkTitles(current: string[], count: number): string[] {
  const defaults = defaultLinkTitles(count);
  return Array.from({ length: count }, (_, index) => current[index] ?? defaults[index]!);
}
