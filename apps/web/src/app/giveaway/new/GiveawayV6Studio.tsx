"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { CreatorSignInGate } from "../../CreatorSignInGate";
import { useCreatorSession } from "../../use-creator-session";
import { FundingQrCode } from "@/lib/funding-qr";
import {
  buildGiveawayV6Budget,
  GIVEAWAY_V6_ENTRY_FEE_SOMPI,
  GIVEAWAY_V6_PARTICIPANT_CAPS,
  type GiveawayV6ParticipantCap,
} from "@/lib/giveaway-v6-budget";
import { validateRecipientAddress } from "../../new-link/helpers";

type Surface = "browser" | "telegram";
type StudioView = "create" | "manage";
type Prize = "0.2" | "0.5" | "1";

type StudioGiveaway = {
  activation: {
    activateUrl: null | string;
    submittedAt: null | string;
    transactionId: null | string;
  };
  amountKas: string;
  closesAt: string;
  createdAt: string;
  description: null | string;
  funding: {
    address: string;
    amountKas: string;
    amountSompi: string;
    paymentUri: string;
    status: "AWAITING_FUNDING" | "BOUND";
  };
  frozenEntryCount: null | number;
  participantCap: number;
  phase: "AWAITING_ACTIVATION" | "DRAWN" | "FROZEN" | "OPEN" | "RETURNED";
  publicId: string;
  publicUrl: string;
  registrationCount: number;
  shareReady: boolean;
  terminalTransactionId: null | string;
  title: string;
  winnerScriptPublicKeyHex: null | string;
};

type CreateResponse = {
  giveaway: {
    amountKas: string;
    closesAt: string;
    createdAt: string;
    description: null | string;
    participantCap: number;
    publicId: string;
    publicUrl: string;
    shareReady: false;
    status: "AWAITING_FUNDING";
    title: string;
  };
  funding: Omit<StudioGiveaway["funding"], "status"> & {
    breakdown: {
      activationFeeSompi: string;
      executionReserveSompi: string;
      maximumEntryFeesSompi: string;
      maximumNetworkCostSompi: string;
      minimumReturnSompi: string;
      prizeSompi: string;
      settlementFeesSompi: string;
    };
  };
};

type FundingResponse = {
  activation: { activateUrl?: string; status: StudioGiveaway["phase"] };
  funding: { status: StudioGiveaway["funding"]["status"] };
  giveaway: { publicId: string; shareReady: boolean };
};

type ActivationResponse = {
  activation: {
    chainStatus: StudioGiveaway["phase"];
    deliveryStatus: "CONFIRMED" | "SUBMITTED";
    transactionId: null | string;
  };
  giveaway: { publicId: string; shareReady: boolean };
};

const PRIZES: Prize[] = ["0.2", "0.5", "1"];
const DURATIONS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
] as const;
const PRIZE_SOMPI: Record<Prize, bigint> = {
  "0.2": 20_000_000n,
  "0.5": 50_000_000n,
  "1": 100_000_000n,
};

function formatSompi(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function durationLabel(seconds: number): string {
  if (seconds % 3_600 === 0) return `${seconds / 3_600} ${seconds === 3_600 ? "hour" : "hours"}`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

type GiveawayV6Budget = ReturnType<typeof buildGiveawayV6Budget>;

function FundingCostExplanation({
  budget,
  participantCap,
  prize,
}: {
  budget: GiveawayV6Budget;
  participantCap: GiveawayV6ParticipantCap;
  prize: Prize;
}) {
  const transactionReserveSompi = budget.activationFeeSompi + budget.executionReserveSompi;

  return (
    <section aria-label="Funding cost explanation" className="studio-cost">
      <div className="studio-cost-total">
        <span>Total to fund</span>
        <strong>{formatSompi(budget.expectedFundingSompi)} KAS</strong>
      </div>
      <p className="studio-cost-answer">
        <strong>Why more than the prize?</strong>
        <span>
          You fund the prize and the on-chain steps for up to {participantCap} participants, so
          joining stays free.
        </span>
      </p>
      <div
        aria-label={`${prize} KAS prize plus ${formatSompi(transactionReserveSompi)} KAS on-chain reserve`}
        className="studio-cost-formula"
      >
        <div>
          <span>Prize</span>
          <b>{prize} KAS</b>
        </div>
        <span aria-hidden="true">+</span>
        <div>
          <span>On-chain reserve</span>
          <b>{formatSompi(transactionReserveSompi)} KAS</b>
        </div>
      </div>
      <details className="studio-cost-details">
        <summary>View reserve breakdown</summary>
        <dl>
          <div>
            <dt>Contract activation</dt>
            <dd>{formatSompi(budget.activationFeeSompi)} KAS</dd>
          </div>
          <div>
            <dt>Up to {participantCap} on-chain entries</dt>
            <dd>{formatSompi(budget.maximumEntryFeesSompi)} KAS</dd>
          </div>
          <div>
            <dt>Close and winner payout</dt>
            <dd>{formatSompi(budget.settlementFeesSompi)} KAS</dd>
          </div>
          <div className="studio-cost-return">
            <dt>Reserved return after a full draw</dt>
            <dd>{formatSompi(budget.minimumReturnSompi)} KAS</dd>
          </div>
        </dl>
        <p>
          Every unused participant place adds {formatSompi(GIVEAWAY_V6_ENTRY_FEE_SOMPI)} KAS to the
          return path committed to your return address.
        </p>
      </details>
      <div className="studio-cost-fee">
        <span>Kaspa Links fee</span>
        <b>0 KAS</b>
      </div>
    </section>
  );
}

export function giveawayV6StudioStep(
  giveaway:
    | null
    | (Pick<StudioGiveaway, "phase" | "shareReady"> & {
        funding: Pick<StudioGiveaway["funding"], "status">;
      }),
): 1 | 2 | 3 | 4 {
  if (!giveaway) return 1;
  if (giveaway.funding.status === "AWAITING_FUNDING") return 2;
  if (!giveaway.shareReady && giveaway.phase === "AWAITING_ACTIVATION") return 3;
  return 4;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const error = "error" in value ? value.error : null;
  if (!error || typeof error !== "object" || !("message" in error)) return fallback;
  return typeof error.message === "string" ? error.message : fallback;
}

function compactTransactionId(value: null | string): string {
  if (!value) return "";
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function normalizedCreatedGiveaway(response: CreateResponse): StudioGiveaway {
  return {
    activation: { activateUrl: null, submittedAt: null, transactionId: null },
    amountKas: response.giveaway.amountKas,
    closesAt: response.giveaway.closesAt,
    createdAt: response.giveaway.createdAt,
    description: response.giveaway.description,
    funding: { ...response.funding, status: response.giveaway.status },
    frozenEntryCount: null,
    participantCap: response.giveaway.participantCap,
    phase: "AWAITING_ACTIVATION",
    publicId: response.giveaway.publicId,
    publicUrl: response.giveaway.publicUrl,
    registrationCount: 0,
    shareReady: false,
    terminalTransactionId: null,
    title: response.giveaway.title,
    winnerScriptPublicKeyHex: null,
  };
}

export function GiveawayV6Studio({
  initialView = "create",
  surface,
}: {
  initialView?: StudioView;
  surface: Surface;
}) {
  const creatorSession = useCreatorSession();
  const [telegramInitData, setTelegramInitData] = useState<null | string>(null);
  const [view, setView] = useState<StudioView>(initialView);
  const [giveaways, setGiveaways] = useState<StudioGiveaway[]>([]);
  const [selected, setSelected] = useState<null | StudioGiveaway>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prize, setPrize] = useState<Prize>("0.5");
  const [participantCap, setParticipantCap] = useState<GiveawayV6ParticipantCap>(8);
  const [durationSeconds, setDurationSeconds] = useState(60 * 60);
  const [returnAddress, setReturnAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activationInFlight = useRef(false);

  useEffect(() => {
    if (surface !== "telegram") return;
    const app = window.Telegram?.WebApp;
    app?.ready();
    app?.expand();
    setTelegramInitData(app?.initData?.trim() ?? "");
  }, [surface]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "manage") setView("manage");
    const presetTitle = params.get("title")?.trim();
    const presetPrize = params.get("prize");
    const presetDuration = Number(params.get("duration"));
    const presetParticipantCap = Number(params.get("participants"));
    if (presetTitle) setTitle(presetTitle.slice(0, 80));
    if (presetPrize === "0.2" || presetPrize === "0.5" || presetPrize === "1") {
      setPrize(presetPrize);
    }
    if (DURATIONS.some((duration) => duration.seconds === presetDuration)) {
      setDurationSeconds(presetDuration);
    }
    if (GIVEAWAY_V6_PARTICIPANT_CAPS.some((cap) => cap === presetParticipantCap)) {
      setParticipantCap(presetParticipantCap as GiveawayV6ParticipantCap);
    }
  }, []);

  const authenticated =
    surface === "telegram"
      ? Boolean(telegramInitData)
      : creatorSession.hydrated && creatorSession.signedIn;
  const authenticationReady =
    surface === "telegram" ? telegramInitData !== null : creatorSession.hydrated;

  const authHeaders = useCallback((): Record<string, string> => {
    if (surface === "telegram") {
      return telegramInitData ? { "x-telegram-mini-app-init-data": telegramInitData } : {};
    }
    return {
      "x-creator-token": creatorSession.token,
      "x-creator-username": creatorSession.username,
    };
  }, [creatorSession.token, creatorSession.username, surface, telegramInitData]);

  const storeGiveaway = useCallback((giveaway: StudioGiveaway) => {
    setSelected(giveaway);
    setGiveaways((current) =>
      current.some((row) => row.publicId === giveaway.publicId)
        ? current.map((row) => (row.publicId === giveaway.publicId ? giveaway : row))
        : [giveaway, ...current],
    );
  }, []);

  const loadGiveaways = useCallback(
    async (preferredPublicId?: string) => {
      if (!authenticated) return;
      const response = await fetch("/api/creator/giveaways/v6", {
        headers: authHeaders(),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Giveaways could not be loaded."));
      const rows =
        body && typeof body === "object" && "giveaways" in body && Array.isArray(body.giveaways)
          ? (body.giveaways as StudioGiveaway[])
          : [];
      setGiveaways(rows);
      const requested =
        preferredPublicId ?? new URLSearchParams(window.location.search).get("id") ?? undefined;
      if (requested) setSelected(rows.find((row) => row.publicId === requested) ?? null);
      return rows;
    },
    [authHeaders, authenticated],
  );

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    setLoading(true);
    void loadGiveaways()
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "Giveaways could not load.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, loadGiveaways]);

  const activate = useCallback(
    async (giveaway: StudioGiveaway, activateUrl: string) => {
      if (activationInFlight.current) return giveaway;
      activationInFlight.current = true;
      try {
        const response = await fetch(activateUrl, { headers: authHeaders(), method: "POST" });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(body, "Activation failed. Retrying is safe."));
        }
        const activation = body as ActivationResponse;
        const updated: StudioGiveaway = {
          ...giveaway,
          activation: {
            activateUrl,
            submittedAt:
              activation.activation.deliveryStatus === "SUBMITTED"
                ? new Date().toISOString()
                : giveaway.activation.submittedAt,
            transactionId: activation.activation.transactionId,
          },
          phase: activation.activation.chainStatus,
          shareReady: activation.giveaway.shareReady,
        };
        storeGiveaway(updated);
        setMessage(
          activation.giveaway.shareReady
            ? "Giveaway is live and ready to share."
            : "Activation sent. Waiting for on-chain confirmation…",
        );
        return updated;
      } finally {
        activationInFlight.current = false;
      }
    },
    [authHeaders, storeGiveaway],
  );

  const checkFunding = useCallback(
    async (giveaway: StudioGiveaway) => {
      if (checking) return;
      setChecking(true);
      setError("");
      try {
        const response = await fetch(`/api/creator/giveaways/v6/${giveaway.publicId}/funding`, {
          headers: authHeaders(),
          method: "POST",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(body, "Funding could not be checked."));
        }
        const funding = body as FundingResponse;
        let updated: StudioGiveaway = {
          ...giveaway,
          activation: {
            ...giveaway.activation,
            activateUrl: funding.activation.activateUrl ?? giveaway.activation.activateUrl,
          },
          funding: { ...giveaway.funding, status: funding.funding.status },
          phase: funding.activation.status,
          shareReady: funding.giveaway.shareReady,
        };
        storeGiveaway(updated);
        if (funding.funding.status === "BOUND" && funding.activation.activateUrl) {
          updated = await activate(updated, funding.activation.activateUrl);
        } else {
          setMessage("Waiting for the exact Mainnet funding output…");
        }
        if (updated.shareReady) await loadGiveaways(updated.publicId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Funding could not be checked.");
      } finally {
        setChecking(false);
      }
    },
    [activate, authHeaders, checking, loadGiveaways, storeGiveaway],
  );

  useEffect(() => {
    if (!selected || selected.shareReady) return;
    const interval = window.setInterval(() => void checkFunding(selected), 12_000);
    return () => window.clearInterval(interval);
  }, [checkFunding, selected]);

  async function createGiveaway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const address = validateRecipientAddress(returnAddress);
    if (address.state !== "valid") {
      setError(address.state === "invalid" ? address.reason : "Enter your return Kaspa address.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/creator/giveaways/v6", {
        body: JSON.stringify({
          amountKas: prize,
          description: description.trim() || null,
          durationSeconds,
          participantCap,
          returnAddress: returnAddress.trim(),
          title: title.trim(),
        }),
        headers: { ...authHeaders(), "content-type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Giveaway could not be created."));
      const giveaway = normalizedCreatedGiveaway(body as CreateResponse);
      storeGiveaway(giveaway);
      setMessage("Setup locked. Fund the exact amount shown below.");
      const url = new URL(window.location.href);
      url.searchParams.set("id", giveaway.publicId);
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway could not be created.");
    } finally {
      setLoading(false);
    }
  }

  function selectGiveaway(giveaway: StudioGiveaway) {
    setSelected(giveaway);
    setView("create");
    setError("");
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("id", giveaway.publicId);
    url.searchParams.delete("mode");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function newGiveaway() {
    setSelected(null);
    setView("create");
    setError("");
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    url.searchParams.delete("mode");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function manageGiveaways() {
    setSelected(null);
    setView("manage");
    setError("");
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    url.searchParams.set("mode", "manage");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function shareGiveaway() {
    if (!selected) return;
    const url = new URL(selected.publicUrl, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({
          text: `${selected.title} — ${selected.amountKas} KAS`,
          title: selected.title,
          url,
        });
        return;
      } catch {
        // The user can still copy the link after dismissing the native sheet.
      }
    }
    setMessage((await copyText(url)) ? "Giveaway link copied." : url);
  }

  if (!authenticationReady) {
    return (
      <main className="main giveaway-studio">
        <p role="status">Opening Giveaway Studio…</p>
      </main>
    );
  }
  if (!authenticated && surface === "browser") {
    return (
      <main className="main giveaway-studio">
        <CreatorSignInGate
          description="Sign in to create, fund and manage your SilverScript giveaways."
          label="Giveaway Studio"
          nextPath="/giveaway/new"
          title="Sign in to continue"
        />
      </main>
    );
  }
  if (!authenticated) {
    return (
      <main className="main giveaway-studio">
        <section className="card studio-panel">
          <h1>Open this Mini App in Telegram</h1>
          <p className="muted">Telegram authentication is required to access your giveaways.</p>
        </section>
      </main>
    );
  }

  const step = giveawayV6StudioStep(selected);
  const budget = buildGiveawayV6Budget(PRIZE_SOMPI[prize], participantCap);
  const selectedPrize = selected
    ? PRIZES.find((candidate) => candidate === selected.amountKas)
    : undefined;
  const selectedParticipantCap = selected
    ? GIVEAWAY_V6_PARTICIPANT_CAPS.find((candidate) => candidate === selected.participantCap)
    : undefined;
  const selectedBudget =
    selectedPrize && selectedParticipantCap
      ? buildGiveawayV6Budget(PRIZE_SOMPI[selectedPrize], selectedParticipantCap)
      : null;
  const publicUrl = selected
    ? new URL(
        selected.publicUrl,
        typeof window === "undefined" ? "https://kaspalinks.com" : window.location.origin,
      ).toString()
    : "";

  return (
    <main className="main giveaway-studio">
      <header className="studio-header">
        {surface === "browser" ? (
          <Link className="studio-back" href="/new-link">
            ← Create a new link
          </Link>
        ) : null}
        <div className="studio-heading">
          <div>
            <span className="studio-kicker">SilverScript Giveaway</span>
            <h1>Giveaway Studio</h1>
            <p>Four steps. No recovery file and no funds held by Kaspa Links.</p>
          </div>
          <span className="studio-network">
            <span>●</span> Kaspa Mainnet
          </span>
        </div>
      </header>

      <div className="studio-toolbar">
        <button
          className={`btn ${view === "create" ? "btn-primary" : ""}`}
          onClick={newGiveaway}
          type="button"
        >
          New giveaway
        </button>
        <button
          className={`btn ${view === "manage" ? "btn-primary" : ""}`}
          onClick={manageGiveaways}
          type="button"
        >
          Manage giveaways
        </button>
      </div>

      {view === "manage" ? (
        <section className="card studio-panel">
          <div className="studio-panel-heading">
            <span className="studio-kicker">Your giveaways</span>
            <h2>Continue or open an existing giveaway</h2>
            <p>Manage only loads existing entries. It never creates a new one.</p>
          </div>
          {loading ? (
            <p role="status">Loading…</p>
          ) : giveaways.length === 0 ? (
            <div className="studio-state">
              <div className="studio-state-icon">＋</div>
              <h3>No giveaways yet</h3>
              <button className="btn btn-primary" onClick={newGiveaway} type="button">
                Create your first giveaway
              </button>
            </div>
          ) : (
            <div className="studio-history">
              <ul>
                {giveaways.map((giveaway) => (
                  <li key={giveaway.publicId}>
                    <button onClick={() => selectGiveaway(giveaway)} type="button">
                      <span>
                        <strong>{giveaway.title}</strong>
                        <br />
                        <small>
                          {giveaway.registrationCount}/{giveaway.participantCap} participants
                        </small>
                      </span>
                      <span>{giveaway.amountKas} KAS</span>
                      <span>
                        {giveaway.shareReady
                          ? giveaway.phase
                          : giveawayV6StudioStep(giveaway) === 2
                            ? "Fund"
                            : "Activate"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <>
          <ol className="studio-steps" aria-label="Giveaway setup progress">
            {["Setup", "Fund", "Activate", "Share"].map((label, index) => {
              const number = (index + 1) as 1 | 2 | 3 | 4;
              return (
                <li
                  className={number < step ? "is-done" : number === step ? "is-current" : ""}
                  key={label}
                >
                  <span className="studio-step-dot">{number < step ? "✓" : number}</span>
                  {label}
                </li>
              );
            })}
          </ol>

          {error ? (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="notice" role="status">
              {message}
            </div>
          ) : null}

          {!selected ? (
            <div className="studio-layout">
              <section className="card studio-panel">
                <div className="studio-panel-heading">
                  <span className="studio-kicker">Step 1 of 4</span>
                  <h2>Set up your giveaway</h2>
                  <p>Choose the public details and the wallet that receives unused reserve.</p>
                </div>
                <form className="studio-form" onSubmit={createGiveaway}>
                  <label className="field">
                    Title
                    <input
                      maxLength={80}
                      onChange={(event) => setTitle(event.target.value)}
                      required
                      value={title}
                    />
                  </label>
                  <label className="field">
                    Description <span className="muted">(optional)</span>
                    <textarea
                      maxLength={280}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      value={description}
                    />
                  </label>
                  <fieldset className="studio-prizes">
                    <legend>Prize</legend>
                    {PRIZES.map((value) => (
                      <label className={prize === value ? "is-selected" : ""} key={value}>
                        <input
                          checked={prize === value}
                          name="prize"
                          onChange={() => setPrize(value)}
                          type="radio"
                          value={value}
                        />
                        {value} KAS
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="studio-prizes">
                    <legend>Maximum participants</legend>
                    {GIVEAWAY_V6_PARTICIPANT_CAPS.map((value) => (
                      <label className={participantCap === value ? "is-selected" : ""} key={value}>
                        <input
                          checked={participantCap === value}
                          name="participantCap"
                          onChange={() => setParticipantCap(value)}
                          type="radio"
                          value={value}
                        />
                        {value}
                      </label>
                    ))}
                  </fieldset>
                  <label className="field">
                    Entry time
                    <select
                      onChange={(event) => setDurationSeconds(Number(event.target.value))}
                      value={durationSeconds}
                    >
                      {DURATIONS.some((duration) => duration.seconds === durationSeconds) ? null : (
                        <option value={durationSeconds}>{durationLabel(durationSeconds)}</option>
                      )}
                      {DURATIONS.map((duration) => (
                        <option key={duration.seconds} value={duration.seconds}>
                          {duration.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Return Kaspa address
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      onChange={(event) => setReturnAddress(event.target.value)}
                      placeholder="kaspa:…"
                      required
                      spellCheck={false}
                      value={returnAddress}
                    />
                    <small>
                      Unused execution reserve can return only to this committed address.
                    </small>
                  </label>
                  <FundingCostExplanation
                    budget={budget}
                    participantCap={participantCap}
                    prize={prize}
                  />
                  <button
                    className="btn btn-primary studio-primary"
                    disabled={loading || !title.trim()}
                    type="submit"
                  >
                    {loading ? "Preparing…" : "Review and create"}
                  </button>
                  <p className="studio-caption">
                    Creating locks the selected {participantCap}-participant terms but does not move
                    KAS.
                  </p>
                </form>
              </section>
              <aside className="studio-sidebar">
                <section className="card studio-guide">
                  <h2>How it works</h2>
                  <ol>
                    <li>
                      Set the rules<span>Prize, duration and return wallet are committed.</span>
                    </li>
                    <li>
                      Fund once<span>Scan one exact Mainnet payment.</span>
                    </li>
                    <li>
                      Activation runs<span>The keyless transaction is verified and relayed.</span>
                    </li>
                    <li>
                      Share the link<span>Participants and result are reconstructed on-chain.</span>
                    </li>
                  </ol>
                </section>
              </aside>
            </div>
          ) : step === 2 ? (
            <section className="card studio-panel studio-detail">
              <div className="studio-detail-heading">
                <div>
                  <span className="studio-kicker">Step 2 of 4</span>
                  <h2>{selected.title}</h2>
                </div>
                <span className="studio-prize-badge">{selected.amountKas} KAS prize</span>
              </div>
              <div className="studio-funding">
                <div className="studio-qr">
                  <FundingQrCode
                    ariaLabel={`Fund ${selected.title}`}
                    paymentUri={selected.funding.paymentUri}
                  />
                </div>
                <div>
                  <p className="muted">Send exactly</p>
                  <strong className="studio-funding-amount">
                    {selected.funding.amountKas} KAS
                  </strong>
                  <label className="field">
                    Funding address
                    <textarea readOnly rows={3} value={selected.funding.address} />
                  </label>
                  <div className="studio-actions">
                    <a className="btn btn-primary" href={selected.funding.paymentUri}>
                      Open Kaspium
                    </a>
                    <button
                      className="btn"
                      onClick={() =>
                        void copyText(selected.funding.address).then((ok) =>
                          setMessage(ok ? "Funding address copied." : selected.funding.address),
                        )
                      }
                      type="button"
                    >
                      Copy address
                    </button>
                  </div>
                </div>
              </div>
              {selectedBudget && selectedPrize && selectedParticipantCap ? (
                <FundingCostExplanation
                  budget={selectedBudget}
                  participantCap={selectedParticipantCap}
                  prize={selectedPrize}
                />
              ) : null}
              <div className="studio-hint">
                <strong>Exact amount only</strong>
                <p>
                  The app detects the confirmed output, then activates the reviewed SilverScript
                  contract automatically.
                </p>
              </div>
              <button
                className="btn studio-primary"
                disabled={checking}
                onClick={() => void checkFunding(selected)}
                type="button"
              >
                {checking ? "Checking Mainnet…" : "I paid — check funding"}
              </button>
            </section>
          ) : step === 3 ? (
            <section className="card studio-panel studio-detail">
              <div className="studio-state">
                <div className="studio-state-icon">↗</div>
                <span className="studio-kicker">Step 3 of 4</span>
                <h2>Activating on Kaspa</h2>
                <p>
                  The deterministic activation transaction has no private key and can only create
                  the reviewed covenant outputs.
                </p>
                {selected.activation.transactionId ? (
                  <p className="studio-address" title={selected.activation.transactionId}>
                    Transaction {compactTransactionId(selected.activation.transactionId)}
                  </p>
                ) : null}
                <button
                  className="btn btn-primary"
                  disabled={checking}
                  onClick={() => void checkFunding(selected)}
                  type="button"
                >
                  {checking ? "Checking…" : "Check confirmation"}
                </button>
              </div>
            </section>
          ) : (
            <section className="card studio-panel studio-detail">
              <div className="studio-state">
                <div className="studio-state-icon">✓</div>
                <span className="studio-kicker">Step 4 of 4</span>
                <h2>Your giveaway is live</h2>
                <p>
                  Share this link. Visitors see the participant count, the on-chain draw and the
                  winner after completion.
                </p>
              </div>
              <div className="studio-metrics">
                <div>
                  <strong>{selected.registrationCount}</strong>
                  <span>of {selected.participantCap} participants</span>
                </div>
                <div>
                  <strong>{selected.amountKas}</strong>
                  <span>KAS prize</span>
                </div>
              </div>
              <div className="studio-share">
                <label className="field">
                  Giveaway link
                  <input readOnly value={publicUrl} />
                </label>
                <div className="studio-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => void shareGiveaway()}
                    type="button"
                  >
                    Share giveaway
                  </button>
                  <Link className="btn" href={selected.publicUrl}>
                    Open public page
                  </Link>
                </div>
              </div>
              <details className="studio-advanced">
                <summary>On-chain verification</summary>
                <div className="studio-advanced-body">
                  <p>Phase: {selected.phase}</p>
                  {selected.activation.transactionId ? (
                    <p className="studio-address">
                      Activation: {selected.activation.transactionId}
                    </p>
                  ) : null}
                  {selected.terminalTransactionId ? (
                    <p className="studio-address">Result: {selected.terminalTransactionId}</p>
                  ) : null}
                </div>
              </details>
            </section>
          )}
        </>
      )}
    </main>
  );
}
