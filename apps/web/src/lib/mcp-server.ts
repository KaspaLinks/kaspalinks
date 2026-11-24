import { z } from "zod";

import { parseKaspaAmountToSompi, validateKaspaAddress } from "@kaspa-actions/kaspa";
import { TOCCATA_BATCH_MAX_SAFE_OUTPUTS } from "@kaspa-actions/kaspa/toccata-constants";

import {
  buildLinkPrefillHash,
  isPrefillAmount,
  LINK_PREFILL_TITLE_MAX,
} from "@/app/new-link/link-prefill";
import type { FeaturedGiveaway } from "@/lib/featured-giveaway";
import {
  isBelowReliableMainnetOutputMinimum,
  MIN_RELIABLE_MAINNET_OUTPUT_KAS,
} from "@/lib/mainnet-amount-policy";

/**
 * A stateless Model Context Protocol server (Streamable HTTP, JSON responses)
 * for AI assistants that speak MCP. See docs/adr/0011.
 *
 * Every tool only reads. The "prepare" tools return a kaspalinks.com form with
 * the user's values filled in; the user opens it, checks it and creates the
 * link there (with the human check, and with a manage link that only their
 * browser ever sees). Nothing is created, stored or sent from here.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];

export const MCP_SERVER_INSTRUCTIONS =
  "Kaspa Links (kaspalinks.com) makes non-custodial Kaspa (KAS) payment links, claim links and " +
  "on-chain giveaways on Kaspa mainnet. These tools never create links or move funds: the prepare " +
  "tools return a prefilled kaspalinks.com form that the user opens to review and create the link " +
  "themselves. Give the user the form URL exactly as returned. Never ask the user for a seed phrase, " +
  "private key, creator token or manage link; Kaspa Links never needs them. There is no platform " +
  "fee, payments go straight to the recipient's own address, and Kaspa payments are final.";

export type McpDependencies = {
  appUrl: string;
  loadOpenGiveaways: (limit: number) => Promise<FeaturedGiveaway[]>;
};

type JsonRpcId = number | string;

type JsonRpcResponse =
  | { id: JsonRpcId | null; jsonrpc: "2.0"; result: unknown }
  | { error: { code: number; message: string }; id: JsonRpcId | null; jsonrpc: "2.0" };

export type McpReply = { body: JsonRpcResponse | null; status: number };

export const JsonRpcErrors = {
  INVALID_PARAMS: -32602,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  PARSE_ERROR: -32700,
} as const;

export function isSupportedProtocolVersion(version: string): boolean {
  return (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function jsonRpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { error: { code, message }, id, jsonrpc: "2.0" };
}

type ToolResult = {
  content: { text: string; type: "text" }[];
  isError?: true;
  structuredContent?: Record<string, unknown>;
};

function structured(value: Record<string, unknown>): ToolResult {
  // Older clients only read `content`, so it carries the same JSON.
  return { content: [{ text: JSON.stringify(value), type: "text" }], structuredContent: value };
}

function toolError(message: string): ToolResult {
  return { content: [{ text: message, type: "text" }], isError: true };
}

const READ_ONLY = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

const TOOLS = [
  {
    annotations: { ...READ_ONLY, title: "Prepare a Kaspa payment link" },
    description:
      "Prepare a Kaspa payment link that pays straight into the user's own Kaspa wallet: tips or " +
      "donations (payers choose the amount), a fixed price, or a fundraising goal with a progress " +
      "bar. Returns a prefilled kaspalinks.com form; the user opens it, checks the address and " +
      "creates the link. No account and no platform fee. Ask the user for their own kaspa: address " +
      "if they have not given it; never guess one.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        amount_kas: {
          description:
            'Required for kind fixed (the price) and goal (the target), in KAS, for example "25" ' +
            `or "12.5". At least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS. Ignored for kind any.`,
          type: ["string", "number"],
        },
        kind: {
          default: "any",
          description:
            "any: payers choose how much (tips, donations). fixed: a set price (invoice, sale). " +
            "goal: collect toward a target with a progress bar.",
          enum: ["any", "fixed", "goal"],
          type: "string",
        },
        recipient_address: {
          description: "The user's own Kaspa mainnet address that receives the payments (kaspa:…).",
          type: "string",
        },
        title: {
          description: 'Short title payers see, for example "Buy me a coffee".',
          maxLength: LINK_PREFILL_TITLE_MAX,
          type: "string",
        },
      },
      required: ["recipient_address"],
      type: "object",
    },
    name: "prepare_payment_link",
    title: "Prepare a Kaspa payment link",
  },
  {
    annotations: { ...READ_ONLY, title: "Prepare a Kaspa claim link" },
    description:
      "Prepare a claim link: a way to send KAS to someone without knowing their address. The user " +
      "pays the amount once into a one-time on-chain output; whoever opens the link claims it to " +
      "their own wallet; if nobody claims it within the claim window, the KAS returns to the " +
      "user's wallet by itself. A count of 2 to 8 makes a Claim Drop with that many separate links " +
      "(needs a free Kaspa Links profile). Returns the kaspalinks.com form to open.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        count: {
          default: 1,
          description: "How many separate claim links, 1 to 8.",
          maximum: TOCCATA_BATCH_MAX_SAFE_OUTPUTS,
          minimum: 1,
          type: "integer",
        },
      },
      type: "object",
    },
    name: "prepare_claim_link",
    title: "Prepare a Kaspa claim link",
  },
  {
    annotations: { ...READ_ONLY, title: "Prepare an on-chain Kaspa giveaway" },
    description:
      "Prepare an on-chain giveaway, for example for a community or Telegram group. The prize is " +
      "locked in a SilverScript contract on Kaspa with the creator's return wallet; entries are " +
      "recorded on-chain and free for entrants, who only need a Kaspa address; a later Kaspa block " +
      "picks the winner and the contract pays only that winner. If nobody enters, the prize goes " +
      "back. Kaspa Links never holds the prize. Returns the kaspalinks.com studio to open.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    name: "prepare_giveaway",
    title: "Prepare an on-chain Kaspa giveaway",
  },
  {
    annotations: { ...READ_ONLY, openWorldHint: true, title: "List open Kaspa giveaways" },
    description:
      "List open on-chain Kaspa giveaways on Kaspa Links that anyone can enter for free with a " +
      "Kaspa address: prize, entries, free spots, closing time and the page to enter.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { default: 5, maximum: 5, minimum: 1, type: "integer" },
      },
      type: "object",
    },
    name: "list_open_giveaways",
    title: "List open Kaspa giveaways",
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

const amountInput = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      return value.toFixed(8).replace(/\.?0+$/, "");
    }
    return value.trim();
  });

const paymentArgs = z.object({
  amount_kas: amountInput,
  kind: z.enum(["any", "fixed", "goal"]).default("any"),
  recipient_address: z.string().trim().min(1).max(200),
  title: z.string().max(500).optional(),
});

const claimArgs = z.object({
  count: z.number().int().min(1).max(TOCCATA_BATCH_MAX_SAFE_OUTPUTS).default(1),
});

const listArgs = z.object({ limit: z.number().int().min(1).max(5).default(5) });

const NEXT_STEPS_PAYMENT =
  "Nothing has been created yet. Give the user form_url. They open it, check that the recipient " +
  "address is their own, pass the human check and press Create. Kaspa Links then shows the payment " +
  "link to share and a private manage link that only the user should keep.";

function preparePaymentLink(rawArgs: unknown, deps: McpDependencies): ToolResult {
  const parsed = paymentArgs.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return toolError("recipient_address is required; kind must be any, fixed or goal.");
  }
  const { kind, recipient_address: address } = parsed.data;

  const validation = validateKaspaAddress(address);
  if (!validation.valid) {
    return toolError(`recipient_address is not a valid Kaspa address: ${validation.reason}`);
  }
  if (validation.network !== "mainnet") {
    return toolError("Kaspa Links runs on Kaspa mainnet only; the address must start with kaspa:.");
  }

  let amountKas: string | undefined;
  if (kind !== "any") {
    const amount = parsed.data.amount_kas ?? "";
    if (!isPrefillAmount(amount)) {
      return toolError(
        kind === "fixed"
          ? "amount_kas (the price in KAS) is required for a fixed-amount link."
          : "amount_kas (the target in KAS) is required for a goal link.",
      );
    }
    if (isBelowReliableMainnetOutputMinimum(parseKaspaAmountToSompi(amount))) {
      return toolError(`amount_kas must be at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS.`);
    }
    amountKas = amount;
  }

  const title = parsed.data.title?.replace(/\s+/g, " ").trim().slice(0, LINK_PREFILL_TITLE_MAX);
  const hash = buildLinkPrefillHash({
    amountKas,
    recipientAddress: validation.address,
    title: title || undefined,
  });

  return structured({
    created: false,
    form_url: `${deps.appUrl}/new-link?start=paid&kind=${kind}&from=mcp${hash}`,
    kind,
    next_steps: NEXT_STEPS_PAYMENT,
    recipient_address: validation.address,
    ...(amountKas ? { amount_kas: amountKas } : {}),
    ...(title ? { title } : {}),
  });
}

function prepareClaimLink(rawArgs: unknown, deps: McpDependencies): ToolResult {
  const parsed = claimArgs.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return toolError(`count must be a whole number from 1 to ${TOCCATA_BATCH_MAX_SAFE_OUTPUTS}.`);
  }
  const { count } = parsed.data;
  const query = count > 1 ? `count=${count}&from=mcp` : "from=mcp";
  return structured({
    count,
    created: false,
    form_url: `${deps.appUrl}/claim/create?${query}`,
    next_steps:
      "Nothing has been created yet. Give the user form_url. They choose the amount, the claim " +
      "window and their own return wallet, then pay once from their wallet. As soon as the payment " +
      "is detected the page shows the claim link to share. Unclaimed KAS returns to their wallet " +
      "by itself." +
      (count > 1 ? " A Claim Drop needs a free Kaspa Links profile." : ""),
  });
}

function prepareGiveaway(deps: McpDependencies): ToolResult {
  return structured({
    created: false,
    form_url: `${deps.appUrl}/giveaway/new?from=mcp`,
    next_steps:
      "Nothing has been created yet. Give the user form_url. In the studio they set the prize, " +
      "the number of spots and the draw time, enter their return wallet and fund the prize from " +
      "their own wallet. The page then shows the giveaway link to share with their community.",
  });
}

async function listOpenGiveaways(rawArgs: unknown, deps: McpDependencies): Promise<ToolResult> {
  const parsed = listArgs.safeParse(rawArgs ?? {});
  const limit = parsed.success ? parsed.data.limit : 5;
  const giveaways = await deps.loadOpenGiveaways(limit);
  return structured({
    giveaways: giveaways.map((giveaway) => ({
      closes_at: giveaway.closesAt.toISOString(),
      entries: giveaway.participantCount,
      free_spots: Math.max(0, giveaway.participantCap - giveaway.participantCount),
      page_url: `${deps.appUrl}/giveaways/${encodeURIComponent(giveaway.publicId)}?from=mcp`,
      prize_kas: giveaway.amountKas,
    })),
    how_to_enter:
      "Open page_url and enter a Kaspa address. Entering is free. The winner is drawn on-chain " +
      "at closes_at and paid by the contract.",
    ...(giveaways.length === 0
      ? { note: "No giveaway is open right now. prepare_giveaway starts a new one." }
      : {}),
  });
}

async function callTool(name: ToolName, args: unknown, deps: McpDependencies): Promise<ToolResult> {
  switch (name) {
    case "prepare_payment_link":
      return preparePaymentLink(args, deps);
    case "prepare_claim_link":
      return prepareClaimLink(args, deps);
    case "prepare_giveaway":
      return prepareGiveaway(deps);
    case "list_open_giveaways":
      return listOpenGiveaways(args, deps);
  }
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && TOOLS.some((tool) => tool.name === value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(value: unknown): JsonRpcId | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  return null;
}

/** Handles one JSON-RPC message. A notification or a response gets no body (HTTP 202). */
export async function handleMcpMessage(message: unknown, deps: McpDependencies): Promise<McpReply> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return {
      body: jsonRpcError(null, JsonRpcErrors.INVALID_REQUEST, "Expected one JSON-RPC 2.0 message."),
      status: 400,
    };
  }

  const id = readId(message.id);
  if (typeof message.method !== "string") {
    // A response from the client (we never send requests to it) or garbage.
    if (id !== undefined && ("result" in message || "error" in message)) {
      return { body: null, status: 202 };
    }
    return {
      body: jsonRpcError(id ?? null, JsonRpcErrors.INVALID_REQUEST, "Missing method."),
      status: 400,
    };
  }
  if (id === undefined) return { body: null, status: 202 };
  if (id === null) {
    return {
      body: jsonRpcError(null, JsonRpcErrors.INVALID_REQUEST, "id must be a string or number."),
      status: 400,
    };
  }

  const params = isObject(message.params) ? message.params : {};
  const ok = (result: unknown): McpReply => ({ body: { id, jsonrpc: "2.0", result }, status: 200 });

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        capabilities: { tools: { listChanged: false } },
        instructions: MCP_SERVER_INSTRUCTIONS,
        protocolVersion: isSupportedProtocolVersion(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION,
        serverInfo: {
          name: "kaspa-links",
          title: "Kaspa Links",
          version: "1.0.0",
          websiteUrl: deps.appUrl,
        },
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      if (!isToolName(params.name)) {
        return {
          body: jsonRpcError(id, JsonRpcErrors.INVALID_PARAMS, "Unknown tool."),
          status: 200,
        };
      }
      console.info(`[mcp] tools/call ${params.name}`);
      return ok(await callTool(params.name, params.arguments, deps));
    }
    default:
      return {
        body: jsonRpcError(id, JsonRpcErrors.METHOD_NOT_FOUND, "Method not found."),
        status: 200,
      };
  }
}
