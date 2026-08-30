import { z } from "zod";

const kasAmountSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/);

export const interpretedIntentSchema = z
  .object({
    actionReference: z.string().nullable(),
    actionType: z
      .enum(["kaspa.transfer", "kaspa.tip", "kaspa.donation", "kaspa.invoice", "kaspa.goal"])
      .nullable(),
    amountKas: kasAmountSchema.nullable(),
    clarificationQuestion: z.string().nullable(),
    completeOnInvoicePayment: z.boolean().nullable(),
    goalKas: kasAmountSchema.nullable(),
    intent: z.enum([
      "list_links",
      "list_payments",
      "read_stats",
      "create_action",
      "create_notification_rule",
      "needs_clarification",
      "unknown",
    ]),
    minimumKas: kasAmountSchema.nullable(),
    ruleKind: z
      .enum(["ALL_PAYMENTS", "ACTION", "MINIMUM_AMOUNT", "ACTION_MINIMUM_AMOUNT"])
      .nullable(),
    title: z.string().max(80).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.intent === "create_action") {
      if (!value.actionType || !value.title) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Action type and title are required.",
        });
      }
      if (
        (value.actionType === "kaspa.invoice" || value.actionType === "kaspa.transfer") &&
        !value.amountKas
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A fixed amount is required." });
      }
      if (value.actionType === "kaspa.goal" && !value.goalKas) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A goal amount is required." });
      }
    }
    if (value.intent === "create_notification_rule") {
      if (!value.ruleKind) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Rule kind is required." });
      }
      if (
        (value.ruleKind === "ACTION" || value.ruleKind === "ACTION_MINIMUM_AMOUNT") &&
        !value.actionReference
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Rule action is required." });
      }
      if (
        (value.ruleKind === "MINIMUM_AMOUNT" || value.ruleKind === "ACTION_MINIMUM_AMOUNT") &&
        !value.minimumKas
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Rule minimum is required." });
      }
    }
    if (value.intent === "needs_clarification" && !value.clarificationQuestion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Clarification question is required.",
      });
    }
  });

export type InterpretedIntent = z.infer<typeof interpretedIntentSchema>;

const intentJsonSchema = {
  additionalProperties: false,
  properties: {
    actionReference: { type: ["string", "null"] },
    actionType: {
      enum: ["kaspa.transfer", "kaspa.tip", "kaspa.donation", "kaspa.invoice", "kaspa.goal", null],
    },
    amountKas: { pattern: "^\\d+(?:\\.\\d{1,8})?$", type: ["string", "null"] },
    clarificationQuestion: { type: ["string", "null"] },
    completeOnInvoicePayment: { type: ["boolean", "null"] },
    goalKas: { pattern: "^\\d+(?:\\.\\d{1,8})?$", type: ["string", "null"] },
    intent: {
      enum: [
        "list_links",
        "list_payments",
        "read_stats",
        "create_action",
        "create_notification_rule",
        "needs_clarification",
        "unknown",
      ],
    },
    minimumKas: { pattern: "^\\d+(?:\\.\\d{1,8})?$", type: ["string", "null"] },
    ruleKind: {
      enum: ["ALL_PAYMENTS", "ACTION", "MINIMUM_AMOUNT", "ACTION_MINIMUM_AMOUNT", null],
    },
    title: { type: ["string", "null"] },
  },
  required: [
    "actionReference",
    "actionType",
    "amountKas",
    "clarificationQuestion",
    "completeOnInvoicePayment",
    "goalKas",
    "intent",
    "minimumKas",
    "ruleKind",
    "title",
  ],
  type: "object",
} as const;

type OpenAiResponse = {
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export class OpenAiIntentInterpreter {
  constructor(
    private readonly config: {
      apiKey: string;
      model: string;
      fetcher?: typeof fetch;
    },
  ) {}

  async interpret(text: string): Promise<{
    inputTokens: number;
    intent: InterpretedIntent;
    outputTokens: number;
  }> {
    if (text.length > 750) throw new Error("AI input must be 750 characters or shorter.");
    const fetcher = this.config.fetcher ?? fetch;
    const response = await fetcher("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [{ text, type: "input_text" }],
            role: "user",
          },
        ],
        instructions:
          "Interpret one German or English KaspaLinks request. Return only the strict schema. Normalize KAS amounts to decimal-point strings without scientific notation. Never invent owner IDs, wallet addresses, commands, or unsupported actions. Mutations are drafts, not executions. Ask for clarification when amount, action, or title is required but missing.",
        max_output_tokens: 300,
        model: this.config.model,
        reasoning: { effort: "none" },
        store: false,
        text: {
          format: {
            name: "kaspalinks_agent_intent",
            schema: intentJsonSchema,
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
    const payload = (await response.json()) as OpenAiResponse;
    const outputText =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OpenAI response did not include structured output.");
    const intent = interpretedIntentSchema.parse(JSON.parse(outputText));
    return {
      inputTokens: payload.usage?.input_tokens ?? 0,
      intent,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }
}

export function estimateAiCostMicros(
  usage: { inputTokens: number; outputTokens: number },
  prices: { inputUsdPerMillion: number; outputUsdPerMillion: number },
): bigint {
  const dollars =
    (usage.inputTokens * prices.inputUsdPerMillion +
      usage.outputTokens * prices.outputUsdPerMillion) /
    1_000_000;
  return BigInt(Math.ceil(dollars * 1_000_000));
}

export function parseAiPrice(
  value: string | undefined,
  fallback: number,
  variableName: string,
): number {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${variableName} must be a finite non-negative number.`);
  }
  return parsed;
}
