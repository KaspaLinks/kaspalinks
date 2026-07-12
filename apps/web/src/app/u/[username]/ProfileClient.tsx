"use client";

import type { PublicActionMetadata } from "@/lib/action-serializer";
import type { GoalProgress } from "@/lib/goal-progress";

import { ActionPaymentFlow } from "@/app/a/[publicId]/ActionPaymentFlow";

type ProfileClientProps = {
  action: PublicActionMetadata;
  goalProgress?: GoalProgress | null;
  paymentUri: string;
};

/**
 * Thin wrapper so the profile page (server component) can mount the
 * existing pay-flow client component without dragging KasWare + QR +
 * polling logic into the server bundle. Kept separate from page.tsx so
 * a future redesign of the tip card can intercept here without
 * touching the data-fetching layer.
 */
export function ProfileClient({ action, goalProgress = null, paymentUri }: ProfileClientProps) {
  return <ActionPaymentFlow action={action} goalProgress={goalProgress} paymentUri={paymentUri} />;
}
