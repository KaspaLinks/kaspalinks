import {
  parseKaspaAmountToSompi,
  parseSompiAmount,
  validateKaspaAddress,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import { assertReliableMainnetOutputAmount } from "./mainnet-amount-policy";
import { normalizeSocialLinksRecord } from "./social-links";

const KASPA_ACTION_TYPES = [
  "kaspa.transfer",
  "kaspa.tip",
  "kaspa.donation",
  "kaspa.invoice",
  "kaspa.goal",
] as const;
const NETWORKS = ["mainnet"] as const;
const FIXED_AMOUNT_ACTION_TYPES = new Set(["kaspa.transfer", "kaspa.invoice"]);

const RESERVED_USERNAMES = new Set([
  "a",
  "action",
  "actions",
  "admin",
  "api",
  "assets",
  "blink",
  "blinks",
  "claim",
  "creator",
  "creators",
  "dashboard",
  "docs",
  "donations",
  "embed",
  "favicon.ico",
  "health",
  "invoice",
  "invoices",
  "login",
  "logout",
  "pay",
  "payment",
  "payments",
  "sdk",
  "settings",
  "socials",
  "split",
  "static",
  "status",
  "u",
  "unlock",
]);

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 280;
const DISPLAY_NAME_MAX = 80;
// Bio is the public-facing "about" blurb on /u/<username>. Twitter-style
// length so a profile reads at-a-glance — anything longer belongs in a
// dedicated Action description or external link.
const BIO_MAX = 280;
const MESSAGE_MAX = 280;
const SUPPORTER_DISPLAY_NAME_MAX = 40;
const RECIPIENT_MAX = 200;
const SLUG_MAX = 64;
const TOKEN_MAX = 256;

// MIN_REQUIRED_NOTE_LENGTH lives in lib/note-policy so the client bundle
// can pull it without dragging the rest of schemas.ts (and its kaspa-wasm
// runtime dependency) along. Re-exported here for callers that already
// import from schemas.
export { MIN_REQUIRED_NOTE_LENGTH } from "./note-policy";

const trimmedString = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "Must not be empty after trimming." })
    .refine((value) => value.length <= max, { message: `Must not exceed ${max} characters.` });

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (value === null || value === undefined) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .refine((value) => value === null || value.length <= max, {
      message: `Must not exceed ${max} characters.`,
    });

const socialLinksSchema = z.unknown().transform((value, ctx) => {
  const normalized = normalizeSocialLinksRecord(value);
  if (!normalized.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: normalized.message,
      path: normalized.path,
    });
    return z.NEVER;
  }

  return normalized.value;
});

const usernameSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value), {
    message: "Username must be 3-30 lowercase letters, numbers, underscores, or hyphens.",
  })
  .refine((value) => !RESERVED_USERNAMES.has(value), {
    message: "Username is reserved.",
  });

const slugSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length <= SLUG_MAX, {
    message: `Slug must not exceed ${SLUG_MAX} characters.`,
  })
  .refine((value) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value), {
    message: "Slug must use lowercase letters, numbers, underscores, or hyphens.",
  })
  .refine((value) => !RESERVED_USERNAMES.has(value), {
    message: "Slug is reserved.",
  });

const kaspaAddressSchema = z
  .string()
  .min(1)
  .max(RECIPIENT_MAX)
  .refine(
    (value) => validateKaspaAddress(value).valid,
    (value) => ({
      message: validateKaspaAddress(value).valid
        ? ""
        : (validateKaspaAddress(value) as { reason: string }).reason,
    }),
  );

const amountSchema = z
  .object({
    amountKas: z.string().optional(),
    amountSompi: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasKas = value.amountKas !== undefined && value.amountKas !== "";
    const hasSompi = value.amountSompi !== undefined && value.amountSompi !== "";

    if (!hasKas && !hasSompi) {
      // Both blank means "any amount" — supporter chooses in their wallet.
      return;
    }

    if (hasKas && hasSompi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either amountKas or amountSompi, not both.",
        path: ["amountSompi"],
      });
      return;
    }

    try {
      const amountSompi = hasKas
        ? parseKaspaAmountToSompi(value.amountKas as string)
        : parseSompiAmount(value.amountSompi as string);
      assertReliableMainnetOutputAmount(amountSompi);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
        path: hasKas ? ["amountKas"] : ["amountSompi"],
      });
    }
  });

// Goal target for crowdfunding links. Same either-or shape as amountSchema
// (KAS string or sompi string, never both). Presence per-type is enforced
// separately by requireGoalAmountForGoalType — here we only validate the
// value when one is supplied.
const goalAmountSchema = z
  .object({
    goalKas: z.string().optional(),
    goalSompi: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasKas = value.goalKas !== undefined && value.goalKas !== "";
    const hasSompi = value.goalSompi !== undefined && value.goalSompi !== "";

    if (!hasKas && !hasSompi) {
      return;
    }

    if (hasKas && hasSompi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either goalKas or goalSompi, not both.",
        path: ["goalSompi"],
      });
      return;
    }

    try {
      if (hasKas) {
        parseKaspaAmountToSompi(value.goalKas as string);
      } else {
        parseSompiAmount(value.goalSompi as string);
      }
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
        path: hasKas ? ["goalKas"] : ["goalSompi"],
      });
    }
  });

const actionInputBaseObjectSchema = z.object({
  description: optionalTrimmedString(DESCRIPTION_MAX),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), {
      message: "expiresAt must be a valid ISO datetime.",
    }),
  // When true, this Action is excluded from the public /u/<username>
  // profile listing. Optional in the request; smart per-type default is
  // applied in the POST handler (invoice + transfer hide by default).
  hiddenFromProfile: z.boolean().optional(),
  message: optionalTrimmedString(MESSAGE_MAX),
  network: z.enum(NETWORKS).default("mainnet"),
  // Goal-only behaviour: stop creating new payment requests once the
  // confirmed total reaches the target.
  goalAutoClose: z.boolean().optional().default(false),
  // Whether the public pay page requires the supporter to leave a note
  // before the Pay button enables. Used for commission / shout-out links.
  noteRequired: z.boolean().optional().default(false),
  recipientAddress: kaspaAddressSchema,
  title: trimmedString(TITLE_MAX),
  type: z.enum(KASPA_ACTION_TYPES),
});

function requireMainnetRecipientAddress(
  value: z.infer<typeof actionInputBaseObjectSchema>,
  ctx: z.RefinementCtx,
) {
  const validation = validateKaspaAddress(value.recipientAddress);
  if (validation.valid && validation.network !== "mainnet") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "recipientAddress must be a mainnet kaspa: address.",
      path: ["recipientAddress"],
    });
  }
}

const actionInputBaseSchema = actionInputBaseObjectSchema.superRefine(
  requireMainnetRecipientAddress,
);

function requireFixedAmountForFixedActionTypes(
  value: {
    amountKas?: string;
    amountSompi?: string;
    type: (typeof KASPA_ACTION_TYPES)[number];
  },
  ctx: z.RefinementCtx,
) {
  if (!FIXED_AMOUNT_ACTION_TYPES.has(value.type)) {
    return;
  }

  const hasKas = value.amountKas !== undefined && value.amountKas !== "";
  const hasSompi = value.amountSompi !== undefined && value.amountSompi !== "";
  if (!hasKas && !hasSompi) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} requires a fixed amount.`,
      path: ["amountKas"],
    });
  }
}

// A goal raises pay-what-you-want contributions toward a target, so it
// requires a goal target and rejects a fixed per-payment amount. Every
// non-goal type rejects a stray goal target so it can't silently attach.
function requireGoalAmountForGoalType(
  value: {
    amountKas?: string;
    amountSompi?: string;
    goalAutoClose?: boolean;
    goalKas?: string;
    goalSompi?: string;
    type: (typeof KASPA_ACTION_TYPES)[number];
  },
  ctx: z.RefinementCtx,
) {
  const hasGoal =
    (value.goalKas !== undefined && value.goalKas !== "") ||
    (value.goalSompi !== undefined && value.goalSompi !== "");

  if (value.type !== "kaspa.goal") {
    if (value.goalAutoClose === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only kaspa.goal links can auto-close at the target.",
        path: ["goalAutoClose"],
      });
    }

    if (hasGoal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only kaspa.goal links take a goal target.",
        path: ["goalKas"],
      });
    }
    return;
  }

  if (!hasGoal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "kaspa.goal requires a goal target amount.",
      path: ["goalKas"],
    });
  }

  const hasAmount =
    (value.amountKas !== undefined && value.amountKas !== "") ||
    (value.amountSompi !== undefined && value.amountSompi !== "");
  if (hasAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "kaspa.goal links don't take a fixed amount — set a goal target instead.",
      path: ["amountKas"],
    });
  }
}

export const createActionInputSchema = actionInputBaseSchema
  .and(amountSchema)
  .and(goalAmountSchema)
  .superRefine(requireFixedAmountForFixedActionTypes)
  .superRefine(requireGoalAmountForGoalType);

export const createCreatorInputSchema = z.object({
  displayName: optionalTrimmedString(DISPLAY_NAME_MAX),
  username: usernameSchema,
});

/**
 * PATCH /api/creators/me input — the public-profile settings panel on
 * the dashboard. Every field optional so the UI can do partial updates
 * (e.g. just rename the bio without touching tipActionId).
 *
 * tipActionId nullable so the creator can explicitly opt out of the
 * quick-tip card on their profile (rare but valid).
 */
export const updateCreatorProfileInputSchema = z.object({
  bio: optionalTrimmedString(BIO_MAX).optional(),
  displayName: optionalTrimmedString(DISPLAY_NAME_MAX).optional(),
  socialLinks: socialLinksSchema.optional(),
  tipActionId: z.union([z.string().min(1), z.null()]).optional(),
});

export const creatorLoginInputSchema = z.object({
  token: z.string().trim().min(16).max(TOKEN_MAX),
  username: usernameSchema,
});

export const createCreatorActionInputSchema = actionInputBaseObjectSchema
  .extend({
    slug: slugSchema,
  })
  .superRefine(requireMainnetRecipientAddress)
  .and(amountSchema)
  .and(goalAmountSchema)
  .superRefine(requireFixedAmountForFixedActionTypes)
  .superRefine(requireGoalAmountForGoalType);

export const updateCreatorActionInputSchema = z
  .object({
    amountKas: z.string().optional(),
    amountSompi: z.string().optional(),
    description: optionalTrimmedString(DESCRIPTION_MAX).optional(),
    disabled: z.boolean().optional(),
    // Per-Action override of the profile-visibility default. Lets a
    // creator un-hide a private-by-default invoice they want to surface,
    // or hide a tip they want to keep off /u/<username>.
    hiddenFromProfile: z.boolean().optional(),
    goalAutoClose: z.boolean().optional(),
    goalKas: z.string().optional(),
    goalSompi: z.string().optional(),
    message: optionalTrimmedString(MESSAGE_MAX).optional(),
    noteRequired: z.boolean().optional(),
    title: trimmedString(TITLE_MAX).optional(),
  })
  .superRefine((value, ctx) => {
    const hasKas = value.amountKas !== undefined && value.amountKas !== "";
    const hasSompi = value.amountSompi !== undefined && value.amountSompi !== "";

    if (hasKas && hasSompi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either amountKas or amountSompi, not both.",
        path: ["amountSompi"],
      });
      return;
    }

    if (!hasKas && !hasSompi) {
      return;
    }

    try {
      const amountSompi = hasKas
        ? parseKaspaAmountToSompi(value.amountKas as string)
        : parseSompiAmount(value.amountSompi as string);
      assertReliableMainnetOutputAmount(amountSompi);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
        path: hasKas ? ["amountKas"] : ["amountSompi"],
      });
    }
  })
  .superRefine((value, ctx) => {
    const hasGoalKas = value.goalKas !== undefined && value.goalKas !== "";
    const hasGoalSompi = value.goalSompi !== undefined && value.goalSompi !== "";

    if (!hasGoalKas && !hasGoalSompi) {
      return;
    }

    if (hasGoalKas && hasGoalSompi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either goalKas or goalSompi, not both.",
        path: ["goalSompi"],
      });
      return;
    }

    try {
      if (hasGoalKas) {
        parseKaspaAmountToSompi(value.goalKas as string);
      } else {
        parseSompiAmount(value.goalSompi as string);
      }
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
        path: hasGoalKas ? ["goalKas"] : ["goalSompi"],
      });
    }
  })
  .refine(
    (value) => Object.keys(value).some((key) => value[key as keyof typeof value] !== undefined),
    {
      message: "At least one updatable field must be provided.",
    },
  );

export const updateActionInputSchema = z
  .object({
    description: optionalTrimmedString(DESCRIPTION_MAX).optional(),
    disabled: z.boolean().optional(),
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return new Date(value);
      }),
    message: optionalTrimmedString(MESSAGE_MAX).optional(),
    title: trimmedString(TITLE_MAX).optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => value[key as keyof typeof value] !== undefined),
    { message: "At least one updatable field must be provided." },
  );

export const createPaymentRequestInputSchema = z
  .object({
    amountKas: z.string().optional(),
    requestedMessage: optionalTrimmedString(MESSAGE_MAX).optional(),
    supporterMessage: optionalTrimmedString(MESSAGE_MAX).optional(),
    supporterName: optionalTrimmedString(SUPPORTER_DISPLAY_NAME_MAX).optional(),
    supporterPublic: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.amountKas === undefined || value.amountKas === "") {
      return;
    }
    try {
      const amountSompi = parseKaspaAmountToSompi(value.amountKas);
      assertReliableMainnetOutputAmount(amountSompi);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
        path: ["amountKas"],
      });
    }
  });

export const updatePaymentRequestSupporterMessageInputSchema = z.object({
  supporterMessage: optionalTrimmedString(MESSAGE_MAX),
  supporterName: optionalTrimmedString(SUPPORTER_DISPLAY_NAME_MAX).optional(),
  supporterPublic: z.boolean().optional(),
});

export type CreateActionInput = z.infer<typeof createActionInputSchema>;
export type CreateCreatorActionInput = z.infer<typeof createCreatorActionInputSchema>;
export type CreateCreatorInput = z.infer<typeof createCreatorInputSchema>;
export type UpdateActionInput = z.infer<typeof updateActionInputSchema>;
export type UpdateCreatorActionInput = z.infer<typeof updateCreatorActionInputSchema>;
export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestInputSchema>;
export type UpdatePaymentRequestSupporterMessageInput = z.infer<
  typeof updatePaymentRequestSupporterMessageInputSchema
>;

export function formatZodErrorMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return "Invalid request body.";
  }
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}
