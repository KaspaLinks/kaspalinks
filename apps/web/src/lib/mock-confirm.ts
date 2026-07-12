import { randomBytes } from "node:crypto";

export function isMockConfirmEnabled(value = process.env.MOCK_CONFIRM_ENABLED): boolean {
  return value === "true";
}

export function generateFakeTxId(): string {
  return `mock-${randomBytes(16).toString("hex")}`;
}
