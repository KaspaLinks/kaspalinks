"use client";

import Link from "next/link";

import { GROWTH_PROMPTS } from "@/lib/growth-prompts";
import type { SignupSource } from "@/lib/signup-source";

import { useCreatorSession } from "./use-creator-session";

/**
 * One invitation to become a Creator, rendered only after the visitor's own task
 * is done and never to a signed-in Creator. See docs/adr/0005.
 */
export function GrowthPrompt({ source }: { source: SignupSource }) {
  const { hydrated, signedIn } = useCreatorSession();
  if (!hydrated || signedIn) return null;

  const prompt = GROWTH_PROMPTS[source];
  return (
    <aside aria-label="Start with Kaspa Links" className="growth-prompt">
      <p>{prompt.body}</p>
      {/* No prefetch: a prefetched URL would be logged as a click that never happened. */}
      <Link className="btn btn-primary" href={prompt.href} prefetch={false}>
        {prompt.cta}
      </Link>
    </aside>
  );
}
