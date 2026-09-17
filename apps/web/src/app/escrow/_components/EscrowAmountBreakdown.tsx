import { formatKasAmount, type EscrowAmounts } from "../_lib/escrow-amounts";
import type { EscrowRole } from "../_lib/escrow-types";

type Row = {
  emphasis?: "strong" | "total";
  hint?: string;
  label: string;
  sompi: bigint;
};

export function EscrowAmountBreakdown({
  amounts,
  role,
}: {
  amounts: EscrowAmounts;
  role: EscrowRole | null;
}) {
  const hasDeposit = amounts.buyerDepositSompi > 0n;

  const rows: Row[] = [
    { label: "Item price", sompi: amounts.priceSompi },
    { label: "Shipping", sompi: amounts.shippingSompi },
    ...(hasDeposit
      ? [
          {
            hint: "Returned to the buyer when the deal completes",
            label: "Buyer deposit",
            sompi: amounts.buyerDepositSompi,
          },
        ]
      : []),
    {
      emphasis: role === "buyer" ? "strong" : undefined,
      label: role === "buyer" ? "You lock" : "Buyer locks",
      sompi: amounts.buyerLockSompi,
    },
    ...(hasDeposit
      ? [
          {
            emphasis: role === "seller" ? "strong" : undefined,
            hint: "Returned to the seller when the deal completes",
            label: role === "seller" ? "You lock (deposit)" : "Seller deposit",
            sompi: amounts.sellerDepositSompi,
          } satisfies Row,
        ]
      : []),
    { emphasis: "total", label: "Total in escrow", sompi: amounts.totalLockedSompi },
  ];

  return (
    <dl className="escrow-amounts">
      {rows.map((row) => (
        <div
          className={`escrow-amounts-row${row.emphasis ? ` escrow-amounts-row-${row.emphasis}` : ""}`}
          key={row.label}
        >
          <dt>
            {row.label}
            {row.hint ? <span className="escrow-amounts-hint">{row.hint}</span> : null}
          </dt>
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
