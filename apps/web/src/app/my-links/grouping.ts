export const REGULAR_LINK_GROUPS = [
  { label: "Goals", type: "kaspa.goal" },
  { label: "Tips", type: "kaspa.tip" },
  { label: "Donations", type: "kaspa.donation" },
  { label: "Invoices", type: "kaspa.invoice" },
  { label: "Transfers", type: "kaspa.transfer" },
] as const;

export function groupRegularLinks<T extends { type: string }>(
  links: T[],
): Array<{
  label: string;
  links: T[];
  type: string;
}> {
  const configuredTypes = new Set<string>(REGULAR_LINK_GROUPS.map((group) => group.type));
  const groups: Array<{ label: string; links: T[]; type: string }> = REGULAR_LINK_GROUPS.map(
    (group) => ({
      ...group,
      links: links.filter((link) => link.type === group.type),
    }),
  ).filter((group) => group.links.length > 0);
  const otherLinks = links.filter((link) => !configuredTypes.has(link.type));

  if (otherLinks.length > 0) {
    groups.push({ label: "Other links", links: otherLinks, type: "other" });
  }

  return groups;
}
