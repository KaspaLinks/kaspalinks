import { describe, expect, it } from "vitest";

import { groupRegularLinks } from "./grouping";

describe("groupRegularLinks", () => {
  it("groups links in the stable My Links category order", () => {
    const groups = groupRegularLinks([
      { id: "transfer", type: "kaspa.transfer" },
      { id: "tip", type: "kaspa.tip" },
      { id: "goal", type: "kaspa.goal" },
      { id: "donation", type: "kaspa.donation" },
      { id: "invoice", type: "kaspa.invoice" },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Goals",
      "Tips",
      "Donations",
      "Invoices",
      "Transfers",
    ]);
    expect(groups[0]?.links).toEqual([{ id: "goal", type: "kaspa.goal" }]);
  });

  it("omits empty categories and preserves unknown link types", () => {
    const groups = groupRegularLinks([
      { id: "tip", type: "kaspa.tip" },
      { id: "future", type: "kaspa.future" },
    ]);

    expect(groups).toEqual([
      { label: "Tips", links: [{ id: "tip", type: "kaspa.tip" }], type: "kaspa.tip" },
      {
        label: "Other links",
        links: [{ id: "future", type: "kaspa.future" }],
        type: "other",
      },
    ]);
  });
});
