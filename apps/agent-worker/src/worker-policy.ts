export const MAX_OUTBOX_ATTEMPTS = 8;

export function outboxDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.trunc(attempt));
  return Math.min(60 * 60_000, 2_000 * 2 ** Math.min(normalized, 20));
}

export function shouldDeadLetterOutbox(input: { attempts: number; permanent: boolean }): boolean {
  return input.permanent || input.attempts >= MAX_OUTBOX_ATTEMPTS;
}
