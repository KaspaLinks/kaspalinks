import { ActionType, Network, type Action } from "@kaspa-actions/db";
import { describe, expect, it } from "vitest";

import {
  isActionDeleted,
  isActionDisabled,
  isActionExpired,
  serializePublicAction,
} from "./action-serializer";

const BASE_ACTION = {
  amountSompi: 1_000_000_000n,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  creatorId: null,
  description: "Support the demo.",
  deletedAt: null,
  disabledAt: null,
  expiresAt: new Date("2026-01-02T00:00:00.000Z"),
  goalAutoClose: false,
  goalSompi: null,
  hiddenFromProfile: false,
  id: "action-1",
  message: "Thanks",
  network: Network.TESTNET,
  noteRequired: false,
  publicId: "demo-action",
  recipientAddress: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz",
  slug: null,
  title: "Demo Action",
  type: ActionType.KASPA_TIP,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  version: "v1",
} satisfies Action;

describe("serializePublicAction", () => {
  it("serializes Prisma enums and BigInts into the public v1 metadata shape", () => {
    // Profile-only fields like hiddenFromProfile must NOT appear here —
    // v1 wire format stays stable per AGENTS.md, and that flag is
    // creator-internal state. Setting it on the input must not affect
    // the serialized output.
    expect(serializePublicAction({ ...BASE_ACTION, hiddenFromProfile: true })).toEqual({
      amountKas: "10",
      amountSompi: "1000000000",
      description: "Support the demo.",
      expiresAt: "2026-01-02T00:00:00.000Z",
      goalAutoClose: false,
      goalKas: null,
      goalSompi: null,
      message: "Thanks",
      network: "testnet",
      noteRequired: false,
      publicId: "demo-action",
      recipientAddress: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz",
      title: "Demo Action",
      type: "kaspa.tip",
      version: "v1",
    });
  });

  it("maps every supported Action type to its stable public string", () => {
    expect(
      Object.values(ActionType).map((type) => serializePublicAction({ ...BASE_ACTION, type }).type),
    ).toEqual(["kaspa.transfer", "kaspa.tip", "kaspa.donation", "kaspa.invoice", "kaspa.goal"]);
  });

  it("surfaces amountKas/amountSompi as null for variable-amount Actions", () => {
    const variableAction: Action = { ...BASE_ACTION, amountSompi: null };
    const serialized = serializePublicAction(variableAction);
    expect(serialized.amountKas).toBeNull();
    expect(serialized.amountSompi).toBeNull();
  });

  it("surfaces the goal target for goal links and null for other types", () => {
    const goalAction: Action = {
      ...BASE_ACTION,
      amountSompi: null,
      goalSompi: 100_000_000_000n,
      type: ActionType.KASPA_GOAL,
    };
    const serialized = serializePublicAction(goalAction);
    expect(serialized.type).toBe("kaspa.goal");
    expect(serialized.goalKas).toBe("1000");
    expect(serialized.goalSompi).toBe("100000000000");
    expect(serialized.amountKas).toBeNull();

    expect(serializePublicAction(BASE_ACTION).goalKas).toBeNull();
    expect(serializePublicAction(BASE_ACTION).goalSompi).toBeNull();
  });

  it("surfaces the goal auto-close flag as additive public metadata", () => {
    const serialized = serializePublicAction({
      ...BASE_ACTION,
      amountSompi: null,
      goalAutoClose: true,
      goalSompi: 100_000_000_000n,
      type: ActionType.KASPA_GOAL,
    });

    expect(serialized.goalAutoClose).toBe(true);
  });
});

describe("Action availability helpers", () => {
  it("detects disabled and expired Actions", () => {
    expect(isActionDeleted({ deletedAt: null })).toBe(false);
    expect(isActionDeleted({ deletedAt: new Date("2026-01-01T00:00:00.000Z") })).toBe(true);

    expect(isActionDisabled({ disabledAt: null })).toBe(false);
    expect(isActionDisabled({ disabledAt: new Date("2026-01-01T00:00:00.000Z") })).toBe(true);

    expect(
      isActionExpired(
        { expiresAt: new Date("2026-01-01T00:00:00.000Z") },
        new Date("2026-01-02T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(isActionExpired({ expiresAt: null }, new Date("2026-01-02T00:00:00.000Z"))).toBe(false);
  });
});
