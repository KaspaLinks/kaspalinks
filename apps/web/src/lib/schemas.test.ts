import { describe, expect, it } from "vitest";

import {
  createActionInputSchema,
  createCreatorActionInputSchema,
  createCreatorInputSchema,
  createPaymentRequestInputSchema,
  updateCreatorProfileInputSchema,
  updatePaymentRequestSupporterMessageInputSchema,
  creatorLoginInputSchema,
  formatZodErrorMessage,
  updateActionInputSchema,
  updateCreatorActionInputSchema,
} from "./schemas";

const VALID_RECIPIENT = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const VALID_TESTNET_RECIPIENT =
  "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

describe("createActionInputSchema", () => {
  it("accepts a minimal valid payload with amountKas", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo Tip",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(true);
  });

  it("accepts payloads without an amount as variable-amount Actions", () => {
    const result = createActionInputSchema.safeParse({
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(true);
  });

  it("rejects payloads that try to set both amount fields", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      amountSompi: "1000000000",
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid Kaspa addresses", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      recipientAddress: "kaspa:hallo",
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
  });

  it("rejects too-many-decimals amounts via custom refinement", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "0.123456789",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
  });

  it("rejects fixed payment amounts below the reliable mainnet wallet minimum", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "0.01",
      recipientAddress: VALID_RECIPIENT,
      title: "Tiny tip",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodErrorMessage(result.error)).toContain("at least 0.2 KAS");
    }
  });

  it("rejects unknown action types", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo",
      type: "kaspa.split",
    });
    expect(result.success).toBe(false);
  });

  it("rejects testnet creation payloads in the hosted app", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      network: "testnet",
      recipientAddress: VALID_TESTNET_RECIPIENT,
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
  });

  it("requires fixed amounts for invoice and transfer Actions", () => {
    expect(
      createActionInputSchema.safeParse({
        recipientAddress: VALID_RECIPIENT,
        title: "Invoice",
        type: "kaspa.invoice",
      }).success,
    ).toBe(false);
    expect(
      createActionInputSchema.safeParse({
        recipientAddress: VALID_RECIPIENT,
        title: "Transfer",
        type: "kaspa.transfer",
      }).success,
    ).toBe(false);
  });
});

describe("goal/crowdfunding validation", () => {
  it("accepts a goal Action with a goal target and no fixed amount", () => {
    const result = createActionInputSchema.safeParse({
      goalAutoClose: true,
      goalKas: "1000",
      recipientAddress: VALID_RECIPIENT,
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.goalAutoClose).toBe(true);
  });

  it("accepts a goal target supplied as sompi", () => {
    const result = createActionInputSchema.safeParse({
      goalSompi: "100000000000",
      recipientAddress: VALID_RECIPIENT,
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a goal Action with no goal target", () => {
    const result = createActionInputSchema.safeParse({
      recipientAddress: VALID_RECIPIENT,
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a goal Action that also sets a fixed amount", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "5",
      goalKas: "1000",
      recipientAddress: VALID_RECIPIENT,
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects setting both goalKas and goalSompi", () => {
    const result = createActionInputSchema.safeParse({
      goalKas: "1000",
      goalSompi: "100000000000",
      recipientAddress: VALID_RECIPIENT,
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a goal target on non-goal Action types", () => {
    const result = createActionInputSchema.safeParse({
      goalKas: "1000",
      recipientAddress: VALID_RECIPIENT,
      title: "Tip jar",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
  });

  it("rejects goal auto-close on non-goal Action types", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "1",
      goalAutoClose: true,
      recipientAddress: VALID_RECIPIENT,
      title: "Invoice",
      type: "kaspa.invoice",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a creator goal Action with a slug and goal target", () => {
    const result = createCreatorActionInputSchema.safeParse({
      goalAutoClose: true,
      goalKas: "1000",
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      slug: "server-fund",
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.goalAutoClose).toBe(true);
  });

  it("rejects a creator goal Action without a goal target", () => {
    const result = createCreatorActionInputSchema.safeParse({
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      slug: "server-fund",
      title: "Server fund",
      type: "kaspa.goal",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateActionInputSchema", () => {
  it("requires at least one field", () => {
    expect(updateActionInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a disabled flag toggle", () => {
    expect(updateActionInputSchema.safeParse({ disabled: true }).success).toBe(true);
  });
});

describe("creator schemas", () => {
  it("normalizes creator usernames and rejects reserved names", () => {
    const result = createCreatorInputSchema.safeParse({
      displayName: " Ada ",
      username: " Ada_91 ",
    });
    expect(result).toEqual({
      data: { displayName: "Ada", username: "ada_91" },
      success: true,
    });

    expect(createCreatorInputSchema.safeParse({ username: "admin" }).success).toBe(false);
  });

  it("requires creator login username and token", () => {
    expect(
      creatorLoginInputSchema.safeParse({
        token: "ka_creator_1234567890123456",
        username: "ada",
      }).success,
    ).toBe(true);
    expect(creatorLoginInputSchema.safeParse({ token: "short", username: "ada" }).success).toBe(
      false,
    );
  });

  it("accepts creator Action slugs and rejects reserved slugs", () => {
    const base = {
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      title: "Demo",
      type: "kaspa.tip",
    };

    expect(createCreatorActionInputSchema.safeParse({ ...base, slug: "tip-jar" }).success).toBe(
      true,
    );
    expect(createCreatorActionInputSchema.safeParse({ ...base, slug: "admin" }).success).toBe(
      false,
    );
    expect(createCreatorActionInputSchema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(
      false,
    );
  });

  it("defaults noteRequired to false and accepts a true override", () => {
    const base = {
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      slug: "commission",
      title: "Commission a sketch",
      type: "kaspa.tip",
    };

    const defaulted = createCreatorActionInputSchema.safeParse(base);
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.noteRequired).toBe(false);

    const overridden = createCreatorActionInputSchema.safeParse({
      ...base,
      noteRequired: true,
    });
    expect(overridden.success).toBe(true);
    if (overridden.success) expect(overridden.data.noteRequired).toBe(true);
  });

  it("accepts safe creator Action metadata updates", () => {
    expect(updateCreatorActionInputSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(
      updateCreatorActionInputSchema.safeParse({
        amountKas: "1.25",
        description: " Updated description ",
        message: " thanks ",
        noteRequired: true,
        title: "Updated title",
      }).success,
    ).toBe(true);
    expect(
      updateCreatorActionInputSchema.safeParse({
        amountKas: "1",
        amountSompi: "100000000",
      }).success,
    ).toBe(false);
    expect(updateCreatorActionInputSchema.safeParse({ goalKas: "500" }).success).toBe(true);
    expect(updateCreatorActionInputSchema.safeParse({ goalSompi: "50000000000" }).success).toBe(
      true,
    );
    expect(
      updateCreatorActionInputSchema.safeParse({
        goalKas: "500",
        goalSompi: "50000000000",
      }).success,
    ).toBe(false);
    expect(updateCreatorActionInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts hiddenFromProfile on creator Action updates", () => {
    expect(updateCreatorActionInputSchema.safeParse({ hiddenFromProfile: true }).success).toBe(
      true,
    );
    expect(updateCreatorActionInputSchema.safeParse({ hiddenFromProfile: false }).success).toBe(
      true,
    );
  });

  it("accepts hiddenFromProfile on create-creator-action payloads", () => {
    const base = {
      amountKas: "5",
      hiddenFromProfile: true,
      network: "mainnet",
      recipientAddress: VALID_RECIPIENT,
      slug: "private-invoice",
      title: "Hidden invoice",
      type: "kaspa.invoice",
    };
    const parsed = createCreatorActionInputSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hiddenFromProfile).toBe(true);
    }
  });
});

describe("updateCreatorProfileInputSchema", () => {
  it("accepts a bio + display name + tipActionId triple", () => {
    const parsed = updateCreatorProfileInputSchema.safeParse({
      bio: "  Trail runner. Sketch artist.  ",
      displayName: "  Sammy  ",
      tipActionId: "cltipactionidvalue",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bio).toBe("Trail runner. Sketch artist.");
      expect(parsed.data.displayName).toBe("Sammy");
      expect(parsed.data.tipActionId).toBe("cltipactionidvalue");
    }
  });

  it("allows clearing tipActionId via explicit null", () => {
    const parsed = updateCreatorProfileInputSchema.safeParse({ tipActionId: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tipActionId).toBeNull();
  });

  it("rejects an over-long bio", () => {
    expect(updateCreatorProfileInputSchema.safeParse({ bio: "x".repeat(281) }).success).toBe(false);
  });

  it("rejects an empty-string tipActionId", () => {
    expect(updateCreatorProfileInputSchema.safeParse({ tipActionId: "" }).success).toBe(false);
  });

  it("accepts whitelisted HTTPS social links and removes blank entries", () => {
    const parsed = updateCreatorProfileInputSchema.safeParse({
      socialLinks: {
        discord: " ",
        website: " https://example.com/profile ",
        x: "https://twitter.com/ada",
        youtube: "https://www.youtube.com/@ada",
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.socialLinks).toEqual({
        website: "https://example.com/profile",
        x: "https://twitter.com/ada",
        youtube: "https://www.youtube.com/@ada",
      });
    }
  });

  it("clears social links when the provided object has no URLs", () => {
    const parsed = updateCreatorProfileInputSchema.safeParse({
      socialLinks: { website: " ", x: "" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.socialLinks).toBeNull();
    }
  });

  it("rejects unsafe or unsupported social link values", () => {
    expect(
      updateCreatorProfileInputSchema.safeParse({
        socialLinks: { website: "http://example.com" },
      }).success,
    ).toBe(false);
    expect(
      updateCreatorProfileInputSchema.safeParse({
        socialLinks: { x: "https://example.com/ada" },
      }).success,
    ).toBe(false);
    expect(
      updateCreatorProfileInputSchema.safeParse({
        socialLinks: { linkedin: "https://linkedin.com/in/ada" },
      }).success,
    ).toBe(false);
  });
});

describe("createPaymentRequestInputSchema", () => {
  it("accepts an empty body", () => {
    expect(createPaymentRequestInputSchema.safeParse({}).success).toBe(true);
  });

  it("trims requested and supporter messages and rejects too-long ones", () => {
    const long = "x".repeat(281);
    expect(createPaymentRequestInputSchema.safeParse({ requestedMessage: long }).success).toBe(
      false,
    );
    expect(createPaymentRequestInputSchema.safeParse({ supporterMessage: long }).success).toBe(
      false,
    );

    const parsed = createPaymentRequestInputSchema.parse({
      requestedMessage: "  wallet note  ",
      supporterMessage: "  thank you  ",
      supporterName: "  Ada  ",
      supporterPublic: true,
    });
    expect(parsed.requestedMessage).toBe("wallet note");
    expect(parsed.supporterMessage).toBe("thank you");
    expect(parsed.supporterName).toBe("Ada");
    expect(parsed.supporterPublic).toBe(true);
  });

  it("rejects too-long public supporter names", () => {
    expect(
      createPaymentRequestInputSchema.safeParse({
        supporterName: "x".repeat(41),
        supporterPublic: true,
      }).success,
    ).toBe(false);
  });

  it("accepts an optional amountKas for variable-amount Actions", () => {
    expect(createPaymentRequestInputSchema.safeParse({ amountKas: "0.5" }).success).toBe(true);
    expect(createPaymentRequestInputSchema.safeParse({ amountKas: "" }).success).toBe(true);
  });

  it("rejects optional payment-request amounts below the reliable mainnet wallet minimum", () => {
    const result = createPaymentRequestInputSchema.safeParse({ amountKas: "0.01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodErrorMessage(result.error)).toContain("at least 0.2 KAS");
    }
  });

  it("rejects malformed amountKas in the payment-request body", () => {
    expect(createPaymentRequestInputSchema.safeParse({ amountKas: "not-a-number" }).success).toBe(
      false,
    );
    expect(createPaymentRequestInputSchema.safeParse({ amountKas: "0.123456789" }).success).toBe(
      false,
    );
  });
});

describe("updatePaymentRequestSupporterMessageInputSchema", () => {
  it("accepts trimmed optional supporter messages", () => {
    expect(
      updatePaymentRequestSupporterMessageInputSchema.parse({
        supporterMessage: "  great stream  ",
        supporterName: "  Ada  ",
        supporterPublic: true,
      }),
    ).toEqual({ supporterMessage: "great stream", supporterName: "Ada", supporterPublic: true });
  });
});

describe("formatZodErrorMessage", () => {
  it("includes the path of the first issue", () => {
    const result = createActionInputSchema.safeParse({
      amountKas: "10",
      recipientAddress: "kaspa:bad",
      title: "Demo",
      type: "kaspa.tip",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodErrorMessage(result.error)).toContain("recipientAddress");
    }
  });
});
