import { describe, expect, it, vi } from "vitest";

import {
  OpenAiIntentInterpreter,
  estimateAiCostMicros,
  interpretedIntentSchema,
  parseAiPrice,
} from "./openai-intent.ts";

const VALID_INTENT = {
  actionReference: null,
  actionType: "kaspa.tip",
  amountKas: "2.5",
  clarificationQuestion: null,
  completeOnInvoicePayment: null,
  goalKas: null,
  intent: "create_action",
  minimumKas: null,
  ruleKind: null,
  title: "Kaffee",
} as const;

describe("OpenAiIntentInterpreter", () => {
  it("uses Responses structured output without model tools or response storage", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      expect(body.tools).toBeUndefined();
      expect(body.model).toBe("gpt-5.6-luna");
      expect(body.text).toMatchObject({
        format: { name: "kaspalinks_agent_intent", strict: true, type: "json_schema" },
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify(VALID_INTENT),
          usage: { input_tokens: 23, output_tokens: 17 },
        }),
        { status: 200 },
      );
    });
    const interpreter = new OpenAiIntentInterpreter({
      apiKey: "test-key",
      fetcher: fetcher as typeof fetch,
      model: "gpt-5.6-luna",
    });

    await expect(
      interpreter.interpret("Erstelle einen Tip über 2,5 KAS für Kaffee"),
    ).resolves.toEqual({
      inputTokens: 23,
      intent: VALID_INTENT,
      outputTokens: 17,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects unknown structured fields before application execution", () => {
    expect(() =>
      interpretedIntentSchema.parse({ ...VALID_INTENT, creatorId: "attacker" }),
    ).toThrow();
  });

  it("rejects semantically incomplete mutations", () => {
    expect(() =>
      interpretedIntentSchema.parse({
        ...VALID_INTENT,
        actionType: "kaspa.invoice",
        amountKas: null,
      }),
    ).toThrow("fixed amount");
    expect(() =>
      interpretedIntentSchema.parse({
        ...VALID_INTENT,
        actionReference: null,
        actionType: null,
        amountKas: null,
        intent: "create_notification_rule",
        ruleKind: "ACTION",
      }),
    ).toThrow("Rule action");
  });

  it("enforces the text length before making a provider request", async () => {
    const fetcher = vi.fn();
    const interpreter = new OpenAiIntentInterpreter({
      apiKey: "test-key",
      fetcher: fetcher as typeof fetch,
      model: "gpt-5.6-luna",
    });
    await expect(interpreter.interpret("x".repeat(751))).rejects.toThrow("750 characters");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("estimateAiCostMicros", () => {
  it("uses runtime price inputs and rounds up to micro-dollars", () => {
    expect(
      estimateAiCostMicros(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
      ),
    ).toBe(1_400_000n);
  });
});

describe("parseAiPrice", () => {
  it("uses the configured value or a finite fallback", () => {
    expect(parseAiPrice(undefined, 0.2, "INPUT_PRICE")).toBe(0.2);
    expect(parseAiPrice("1.75", 0.2, "INPUT_PRICE")).toBe(1.75);
  });

  it.each(["NaN", "Infinity", "-0.01", "not-a-price"])(
    "rejects invalid configuration %s",
    (value) => {
      expect(() => parseAiPrice(value, 0.2, "INPUT_PRICE")).toThrow(
        "INPUT_PRICE must be a finite non-negative number.",
      );
    },
  );
});
