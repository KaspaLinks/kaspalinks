import { formatKasAmount, type EscrowAmounts } from "../_lib/escrow-amounts";
import type { EscrowRole } from "../_lib/escrow-types";

type Row = { emphasis?: "strong" | "total"; label: string; sompi: bigint };

export function EscrowAmountBreakdown({
  amounts,
  role,
}: {
  amounts: EscrowAmounts;
  role: EscrowRole | null;
}) {
  const rows: Row[] = [
    { label: "Item price", sompi: amounts.priceSompi },
    { label: "Shipping", sompi: amounts.shippingSompi },
    {
      emphasis: role === "buyer" ? "strong" : undefined,
      label: role === "buyer" ? "You lock" : "Buyer locks",
      sompi: amounts.buyerLockSompi,
    },
    { emphasis: "total", label: "Payment before network fees", sompi: amounts.totalLockedSompi },
  ];

  return (
    <dl className="escrow-amounts">
      {rows.map((row) => (
        <div
          className={`escrow-amounts-row${row.emphasis ? ` escrow-amounts-row-${row.emphasis}` : ""}`}
          key={row.label}
        >
          <dt>{row.label}</dt>
          <dd>
            {row.label === "Shipping" && row.sompi === 0n
              ? "Free"
              : `${formatKasAmount(row.sompi)} KAS`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
