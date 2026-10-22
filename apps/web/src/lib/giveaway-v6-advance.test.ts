import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class GiveawayV6BootstrapError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    broadcast: vi.fn(),
    buildActivation: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    GiveawayV6BootstrapError,
    persistActivationFailure: vi.fn(async () => {}),
    persistActivationPlan: vi.fn(async () => {}),
    persistActivationSubmitted: vi.fn(async () => {}),
    persistBinding: vi.fn(async () => {}),
    prepareBinding: vi.fn(() => ({ family: { covenantIdHex: "cc".repeat(32) } })),
    readFunding: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    writeAuditLog: vi.fn(async () => {}),
  };
});

vi.mock("@kaspa-actions/application", () => ({
  buildGiveawayV6ActivationTransaction: mocks.buildActivation,
  GiveawayV6BootstrapError: mocks.GiveawayV6BootstrapError,
  persistGiveawayV6ActivationFailure: mocks.persistActivationFailure,
  persistGiveawayV6ActivationPlan: mocks.persistActivationPlan,
  persistGiveawayV6ActivationSubmitted: mocks.persistActivationSubmitted,
  persistGiveawayV6BootstrapBinding: mocks.persistBinding,
  prepareGiveawayV6BootstrapBinding: mocks.prepareBinding,
}));
vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { SYSTEM: "SYSTEM" },
  GiveawayV6BootstrapStatus: { AWAITING_FUNDING: "AWAITING_FUNDING", BOUND: "BOUND" },
  GiveawayV6Phase: { AWAITING_ACTIVATION: "AWAITING_ACTIVATION" },
  prisma: {
    giveawayV6Bootstrap: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("./audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("./giveaway-v6-funding", () => ({ readGiveawayV6ConfirmedFunding: mocks.readFunding }));
vi.mock("./toccata-lab", () => ({
  broadcastToccataGiveawayV6ActivationTransaction: mocks.broadcast,
}));

import { processUnattendedGiveawayV6Advances } from "./giveaway-v6-advance";

const NOW = new Date("2026-10-22T15:00:00.000Z");
const ACTIVATION_TX = "ab".repeat(32);

function record(status: "AWAITING_FUNDING" | "BOUND", phase: null | string) {
  return {
    activationSubmittedAt: null,
    expectedFundingSompi: 20_000_000n,
    fundingAddress: "kaspa:qfunding",
    fundingScriptPublicKeyHex: "20aa",
    giveaway: {
      creatorId: "creator-guest",
      publicId: "gw1",
      v6Projection: phase ? { phase } : null,
    },
    id: "boot-1",
    status,
  };
}

describe("processUnattendedGiveawayV6Advances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      { id: "boot-1", updatedAt: new Date(NOW.getTime() - 60_000) },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.buildActivation.mockReturnValue({
      covenantIdHex: "cc".repeat(32),
      transactionId: ACTIVATION_TX,
      transactionSafeJson: "{}",
    });
    mocks.broadcast.mockResolvedValue({ submittedTransactionId: ACTIVATION_TX });
  });

  it("binds a confirmed deposit and leaves activation for the next pass", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(record("AWAITING_FUNDING", "AWAITING_FUNDING"))
      // Right after binding the projection has not caught up yet.
      .mockResolvedValueOnce(record("BOUND", "AWAITING_FUNDING"));
    mocks.readFunding.mockResolvedValue({
      funding: { outputIndex: 0, transactionId: "fd".repeat(32) },
      status: "confirmed",
    });

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result).toEqual({ activated: 0, bound: 1, checked: 1, failed: 0 });
    expect(mocks.persistBinding).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: "SYSTEM", event: "giveaway.v6_funding_bound" }),
    );
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("does nothing while the deposit is missing", async () => {
    mocks.findUnique.mockResolvedValue(record("AWAITING_FUNDING", "AWAITING_FUNDING"));
    mocks.readFunding.mockResolvedValue({ status: "not_found" });

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result).toEqual({ activated: 0, bound: 0, checked: 1, failed: 0 });
    expect(mocks.persistBinding).not.toHaveBeenCalled();
  });

  it("broadcasts the activation once the projection waits for it", async () => {
    mocks.findUnique.mockResolvedValue(record("BOUND", "AWAITING_ACTIVATION"));

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result).toEqual({ activated: 1, bound: 0, checked: 1, failed: 0 });
    expect(mocks.persistActivationPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "boot-1" }),
      ACTIVATION_TX,
    );
    expect(mocks.persistActivationSubmitted).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "giveaway.v6_activation_submitted" }),
    );
  });

  it("records a relay rejection instead of marking the activation submitted", async () => {
    mocks.findUnique.mockResolvedValue(record("BOUND", "AWAITING_ACTIVATION"));
    mocks.broadcast.mockRejectedValue(new Error("Rejected transaction: fee too low"));

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result.activated).toBe(0);
    expect(mocks.persistActivationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ACTIVATION_TX,
      expect.any(Date),
      "ACTIVATION_RELAY_REJECTED",
    );
    expect(mocks.persistActivationSubmitted).not.toHaveBeenCalled();
  });

  it("skips a bootstrap another pass already touched", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result).toEqual({ activated: 0, bound: 0, checked: 0, failed: 0 });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("treats a binding the studio won first as no-op", async () => {
    mocks.findUnique.mockResolvedValue(record("AWAITING_FUNDING", "AWAITING_FUNDING"));
    mocks.readFunding.mockResolvedValue({
      funding: { outputIndex: 0, transactionId: "fd".repeat(32) },
      status: "confirmed",
    });
    mocks.persistBinding.mockRejectedValue(new mocks.GiveawayV6BootstrapError("STALE_BOOTSTRAP"));

    const result = await processUnattendedGiveawayV6Advances(NOW);

    expect(result).toEqual({ activated: 0, bound: 0, checked: 1, failed: 0 });
  });
});
