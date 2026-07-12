import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { ActionType, type Action } from "@kaspa-actions/db";

export type PublicActionType =
  | "kaspa.donation"
  | "kaspa.goal"
  | "kaspa.invoice"
  | "kaspa.tip"
  | "kaspa.transfer";

const PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE: Record<ActionType, PublicActionType> = {
  [ActionType.KASPA_DONATION]: "kaspa.donation",
  [ActionType.KASPA_GOAL]: "kaspa.goal",
  [ActionType.KASPA_INVOICE]: "kaspa.invoice",
  [ActionType.KASPA_TIP]: "kaspa.tip",
  [ActionType.KASPA_TRANSFER]: "kaspa.transfer",
};

export type PublicActionMetadata = {
  amountKas: null | string;
  amountSompi: null | string;
  description: null | string;
  expiresAt: null | string;
  // Goal-link settings. Additive v1 fields — external SDK consumers that
  // predate goals simply ignore them. Live progress (how much is raised so
  // far) is NOT part of the stable metadata; it's served alongside as
  // GoalProgress.
  goalAutoClose: boolean;
  // Fundraising target for goal links (type "kaspa.goal"); null for every
  // other type.
  goalKas: null | string;
  goalSompi: null | string;
  message: null | string;
  network: "mainnet" | "testnet";
  noteRequired: boolean;
  publicId: string;
  recipientAddress: string;
  title: string;
  type: PublicActionType;
  version: string;
};

// NOTE: hiddenFromProfile intentionally NOT exposed here. PublicActionMetadata
// is the stable v1 wire format consumed by the pay page, overlay, blink JSON,
// KasWare and external SDK users — see AGENTS.md "v1 wire format must stay
// stable". Profile-visibility is internal Creator/Profile state, only relevant
// to creator-authenticated surfaces (dashboard, my-links, the /u/<username>
// server query). Those surfaces read directly from the Prisma Action model.
export function serializePublicAction(action: Action): PublicActionMetadata {
  const amount = action.amountSompi;
  const goal = action.goalSompi;
  return {
    amountKas: amount !== null && amount !== undefined ? formatSompiToKaspa(amount) : null,
    amountSompi: amount !== null && amount !== undefined ? amount.toString() : null,
    description: action.description,
    expiresAt: action.expiresAt ? action.expiresAt.toISOString() : null,
    goalAutoClose: action.goalAutoClose,
    goalKas: goal !== null && goal !== undefined ? formatSompiToKaspa(goal) : null,
    goalSompi: goal !== null && goal !== undefined ? goal.toString() : null,
    message: action.message,
    network: action.network === "TESTNET" ? "testnet" : "mainnet",
    noteRequired: action.noteRequired,
    publicId: action.publicId,
    recipientAddress: action.recipientAddress,
    title: action.title,
    type: PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE[action.type],
    version: action.version,
  };
}

export function isActionDisabled(action: Pick<Action, "disabledAt">): boolean {
  return action.disabledAt !== null;
}

export function isActionDeleted(action: Pick<Action, "deletedAt">): boolean {
  return action.deletedAt !== null;
}

export function isActionExpired(action: Pick<Action, "expiresAt">, now = new Date()): boolean {
  return action.expiresAt !== null && action.expiresAt.getTime() <= now.getTime();
}
