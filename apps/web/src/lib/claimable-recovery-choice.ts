export function isSingleClaimableFundingUnlocked(
  recoveryExportedAt: null | string,
  recoveryBackupSkippedAt: null | string,
): boolean {
  return Boolean(recoveryExportedAt?.trim() || recoveryBackupSkippedAt?.trim());
}
