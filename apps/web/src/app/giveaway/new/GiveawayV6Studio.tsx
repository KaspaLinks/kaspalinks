"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { KasAmountInput } from "../../KasAmountInput";
import { KasFiatValue } from "../../KasFiatValue";
import { useCreatorSession } from "../../use-creator-session";
import { FundingQrCode } from "@/lib/funding-qr";
import {
  buildGiveawayV6Budget,
  GIVEAWAY_V6_ENTRY_FEE_SOMPI,
  GIVEAWAY_V6_PARTICIPANT_CAPS,
  type GiveawayV6ParticipantCap,
} from "@/lib/giveaway-v6-budget";
import { formatGiveawayV6Prize, parseGiveawayV6Prize } from "@/lib/giveaway-v6-prize";
import {
  describeGiveawayV6SlotOption,
  GIVEAWAY_V6_EXPECTED_PAYOUT_MINUTES,
  listGiveawayV6Slots,
} from "@/lib/giveaway-v6-slots";
import { validateRecipientAddress } from "../../new-link/helpers";

type Surface = "browser" | "telegram";
type StudioView = "create" | "manage";
/** Prize in KAS as typed; any amount from 0.2 KAS (see parseGiveawayV6Prize). */
type Prize = string;

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

const PRIZE_PRESETS: Prize[] = ["1", "10", "100", "1000"];
const SLOT_REFRESH_MS = 30_000;
// Funding and activation checks share a 12-per-minute budget with creation,
// so automatic checks stay at one request every eight seconds.
const AUTO_CHECK_MS = 8_000;

class StudioRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function formatSompi(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Keeps the chosen slot while it is still offered and otherwise falls back to
 * the earliest one, so a slot that passed its cutoff is never submitted.
 */
export function chooseGiveawayV6Slot(slots: Date[], preferred: string): string {
  return (
    slots.find((slot) => slot.toISOString() === preferred)?.toISOString() ??
    slots[0]?.toISOString() ??
    ""
  );
}

type GiveawayV6Budget = ReturnType<typeof buildGiveawayV6Budget>;

/**
 * What a visitor without a profile sees, often straight from a post: what a
 * giveaway is, and that starting one takes a username and nothing else.
 */
function GiveawayStartGate() {
  const next = encodeURIComponent("/giveaway/new");
  return (
    <section className="card card-accent creator-sign-in-gate giveaway-start-gate">
      <span className="label">On-chain giveaways</span>
      <h1>Run a Kaspa giveaway</h1>
      <p className="muted">
        Each giveaway is a SilverScript contract on Kaspa. Kaspa Links never holds the prize.
      </p>
      <ol className="giveaway-start-steps">
        <li>
          <strong>Set a prize and a draw time.</strong> Any amount from 0.2 KAS, up to 32
          participants.
        </li>
        <li>
          <strong>Fund it once</strong> from your own wallet.
        </li>
        <li>
          <strong>Share the link.</strong> People join free with a Kaspa address.
        </li>
        <li>
          <strong>Kaspa picks the winner</strong> and the contract pays them automatically.
        </li>
      </ol>
      <div className="row">
        <Link className="btn btn-primary" href={`/create-profile?next=${next}`}>
          Start: pick a username
        </Link>
        <Link className="btn" href={`/sign-in?next=${next}`}>
          Sign in
        </Link>
      </div>
      <p className="muted giveaway-start-note">
        No email, no password: a username is enough. No account at all?{" "}
        <a href="https://t.me/kaspalinksbot" rel="noreferrer" target="_blank">
          Create it in Telegram
        </a>
        .
      </p>
    </section>
  );
}

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
        <span className="studio-cost-total-value">
          <strong>{formatSompi(budget.expectedFundingSompi)} KAS</strong>
          <KasFiatValue
            amountKas={formatSompi(budget.expectedFundingSompi)}
            className="studio-cost-fiat"
            inline
          />
        </span>
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
  const [prize, setPrize] = useState<Prize>("1");
  const [participantCap, setParticipantCap] = useState<GiveawayV6ParticipantCap>(8);
  // The server says which sizes this creator may use; 8 until it answers.
  const [allowedCaps, setAllowedCaps] = useState<readonly GiveawayV6ParticipantCap[]>([8]);
  const [preferredSlot, setPreferredSlot] = useState("");
  const [slotClock, setSlotClock] = useState<null | number>(null);
  const [returnAddress, setReturnAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activationInFlight = useRef(false);
  const checkInFlight = useRef(false);

  useEffect(() => {
    if (surface !== "telegram") return;
    const app = window.Telegram?.WebApp;
    app?.ready();
    app?.expand();
    setTelegramInitData(app?.initData?.trim() ?? "");
  }, [surface]);

  useEffect(() => {
    // Slots depend on the viewer's clock, so they are listed only in the
    // browser and refreshed as slots pass their cutoff.
    setSlotClock(Date.now());
    const interval = window.setInterval(() => setSlotClock(Date.now()), SLOT_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "manage") setView("manage");
    const presetTitle = params.get("title")?.trim();
    const presetPrize = params.get("prize");
    const presetSlot = params.get("slot");
    const presetParticipantCap = Number(params.get("participants"));
    if (presetTitle) setTitle(presetTitle.slice(0, 80));
    if (presetPrize && parseGiveawayV6Prize(presetPrize).ok) setPrize(presetPrize.trim());
    if (presetSlot) {
      const parsed = new Date(presetSlot);
      if (Number.isFinite(parsed.getTime())) setPreferredSlot(parsed.toISOString());
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
      if (body && typeof body === "object" && "participantCaps" in body) {
        const caps = (body as { participantCaps: unknown }).participantCaps;
        const allowed = Array.isArray(caps)
          ? GIVEAWAY_V6_PARTICIPANT_CAPS.filter((cap) => caps.includes(cap))
          : [];
        if (allowed.length > 0) {
          setAllowedCaps(allowed);
          setParticipantCap((current) => (allowed.includes(current) ? current : allowed[0]!));
        }
      }
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
          throw new StudioRequestError(
            errorMessage(body, "Activation failed. Retrying is safe."),
            response.status,
          );
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
        if (activation.giveaway.shareReady) setMessage("Giveaway is live and ready to share.");
        return updated;
      } finally {
        activationInFlight.current = false;
      }
    },
    [authHeaders, storeGiveaway],
  );

  /**
   * One step of the automatic funding and activation watch. Until the payment
   * is bound it asks the funding endpoint; afterwards only the activation
   * endpoint, which reports confirmation without sending anything twice.
   */
  const checkFunding = useCallback(
    async (giveaway: StudioGiveaway) => {
      if (checkInFlight.current) return;
      checkInFlight.current = true;
      setChecking(true);
      try {
        let updated = giveaway;
        if (giveaway.funding.status !== "BOUND" || !giveaway.activation.activateUrl) {
          const response = await fetch(`/api/creator/giveaways/v6/${giveaway.publicId}/funding`, {
            headers: authHeaders(),
            method: "POST",
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            throw new StudioRequestError(
              errorMessage(body, "Funding could not be checked."),
              response.status,
            );
          }
          const funding = body as FundingResponse;
          updated = {
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
        }
        if (updated.funding.status === "BOUND" && updated.activation.activateUrl) {
          updated = await activate(updated, updated.activation.activateUrl);
        }
        setError("");
        if (updated.shareReady) await loadGiveaways(updated.publicId);
      } catch (caught) {
        // A rate-limited check is simply skipped; the next one follows soon.
        if (caught instanceof StudioRequestError && caught.status === 429) return;
        setError(caught instanceof Error ? caught.message : "Funding could not be checked.");
      } finally {
        checkInFlight.current = false;
        setChecking(false);
      }
    },
    [activate, authHeaders, loadGiveaways, storeGiveaway],
  );

  useEffect(() => {
    if (!selected || selected.shareReady) return;
    const check = () => void checkFunding(selected);
    // Coming back from the wallet app is the moment a payment is most likely
    // to have landed, so check right away instead of waiting for the timer.
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const interval = window.setInterval(check, AUTO_CHECK_MS);
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
    };
  }, [checkFunding, selected]);

  async function createGiveaway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    // Submit the slot the creator saw, never a silent substitute: if it passed
    // its cutoff since the list was drawn, refresh the list and ask again.
    const shown =
      slotClock === null
        ? ""
        : chooseGiveawayV6Slot(listGiveawayV6Slots(new Date(slotClock)), preferredSlot);
    const now = Date.now();
    if (
      !shown ||
      !listGiveawayV6Slots(new Date(now)).some((slot) => slot.toISOString() === shown)
    ) {
      setSlotClock(now);
      setError("That draw time just closed for new giveaways. Check the new choice and try again.");
      return;
    }
    const slotStartsAt = shown;
    const prizeToSubmit = parseGiveawayV6Prize(prize);
    if (!prizeToSubmit.ok) {
      setError(prizeToSubmit.reason);
      return;
    }
    const address = validateRecipientAddress(returnAddress);
    if (address.state !== "valid") {
      setError(address.state === "invalid" ? address.reason : "Enter your return Kaspa address.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/creator/giveaways/v6", {
        body: JSON.stringify({
          amountKas: formatGiveawayV6Prize(prizeToSubmit.sompi),
          description: description.trim() || null,
          participantCap,
          returnAddress: returnAddress.trim(),
          slotStartsAt,
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
        <GiveawayStartGate />
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
  const slotNow = slotClock === null ? null : new Date(slotClock);
  const slots = slotNow ? listGiveawayV6Slots(slotNow) : [];
  const chosenSlot = chooseGiveawayV6Slot(slots, preferredSlot);
  const prizeCheck = parseGiveawayV6Prize(prize);
  const budget = prizeCheck.ok ? buildGiveawayV6Budget(prizeCheck.sompi, participantCap) : null;
  const selectedPrizeCheck = selected ? parseGiveawayV6Prize(selected.amountKas) : null;
  const selectedPrize = selectedPrizeCheck?.ok ? selected!.amountKas : undefined;
  const selectedParticipantCap = selected
    ? GIVEAWAY_V6_PARTICIPANT_CAPS.find((candidate) => candidate === selected.participantCap)
    : undefined;
  const selectedBudget =
    selectedPrizeCheck?.ok && selectedParticipantCap
      ? buildGiveawayV6Budget(selectedPrizeCheck.sompi, selectedParticipantCap)
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
                  <label className="field">
                    Prize
                    <KasAmountInput
                      aria-invalid={!prizeCheck.ok || undefined}
                      aria-label="Prize"
                      maxLength={24}
                      onChange={setPrize}
                      placeholder="1"
                      required
                      value={prize}
                    />
                    <small className={prizeCheck.ok ? undefined : "error-text"}>
                      {prizeCheck.ok ? "Any amount from 0.2 KAS." : prizeCheck.reason}
                    </small>
                  </label>
                  <div
                    className="studio-prize-presets"
                    role="group"
                    aria-label="Quick prize amounts"
                  >
                    {PRIZE_PRESETS.map((value) => (
                      <button
                        aria-pressed={prize.trim() === value}
                        className={`type-segment${prize.trim() === value ? " type-segment-active" : ""}`}
                        key={value}
                        onClick={() => setPrize(value)}
                        type="button"
                      >
                        {value} KAS
                      </button>
                    ))}
                  </div>
                  {allowedCaps.length > 1 ? (
                    <fieldset className="studio-prizes">
                      <legend>Maximum participants</legend>
                      {allowedCaps.map((value) => (
                        <label
                          className={participantCap === value ? "is-selected" : ""}
                          key={value}
                        >
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
                  ) : (
                    <p className="muted">Up to {participantCap} participants per Giveaway.</p>
                  )}
                  <label className="field">
                    Draw time
                    <select
                      disabled={slots.length === 0}
                      onChange={(event) => setPreferredSlot(event.target.value)}
                      required
                      value={chosenSlot}
                    >
                      {slotNow
                        ? slots.map((slot) => (
                            <option key={slot.toISOString()} value={slot.toISOString()}>
                              {describeGiveawayV6SlotOption(slot, slotNow)}
                            </option>
                          ))
                        : null}
                    </select>
                    <small>
                      Entries close at the time you pick. Kaspa then locks the participant list,
                      Kaspa Links proves the random block, and the winner is paid automatically,
                      usually within about {GIVEAWAY_V6_EXPECTED_PAYOUT_MINUTES} minutes. If nobody
                      entered, the prize returns to you.
                    </small>
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
                  {budget && prizeCheck.ok ? (
                    <FundingCostExplanation
                      budget={budget}
                      participantCap={participantCap}
                      prize={formatGiveawayV6Prize(prizeCheck.sompi)}
                    />
                  ) : null}
                  <button
                    className="btn btn-primary studio-primary"
                    disabled={loading || !title.trim() || !chosenSlot || !prizeCheck.ok}
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
                      Set the rules<span>Prize, draw time and return wallet are committed.</span>
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
              <div className="studio-watch studio-watch-live" role="status">
                <span aria-hidden="true" className="studio-watch-dot" />
                <div>
                  <strong>Waiting for your payment of {selected.funding.amountKas} KAS</strong>
                  <span>
                    This page continues by itself once Kaspa confirms it, usually within seconds.
                    You can leave and come back.
                  </span>
                </div>
                <button
                  className="btn btn-sm"
                  disabled={checking}
                  onClick={() => void checkFunding(selected)}
                  type="button"
                >
                  {checking ? "Checking…" : "Check now"}
                </button>
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
                <p>Send the amount above in one payment. A different amount is not detected.</p>
              </div>
            </section>
          ) : step === 3 ? (
            <section className="card studio-panel studio-detail">
              <div className="studio-watch studio-watch-live" role="status">
                <span aria-hidden="true" className="studio-watch-dot" />
                <div>
                  <strong>Payment received · confirming on Kaspa</strong>
                  <span>
                    Activation is sent automatically. This page moves on to sharing once Kaspa
                    confirms it, usually within seconds.
                  </span>
                </div>
                <button
                  className="btn btn-sm"
                  disabled={checking}
                  onClick={() => void checkFunding(selected)}
                  type="button"
                >
                  {checking ? "Checking…" : "Check now"}
                </button>
              </div>
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
