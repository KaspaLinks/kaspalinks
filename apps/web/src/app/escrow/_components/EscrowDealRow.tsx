import Link from "next/link";
import { computeEscrowAmounts, formatKasAmount } from "../_lib/escrow-amounts";
import type { EscrowDeal, EscrowStatus } from "../_lib/escrow-types";
import { EscrowStatusBadge } from "./EscrowStatusBadge";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const SELLER_ACTION_LABEL: Record<EscrowStatus, string> = {
  active: "Manage",
  awaiting_buyer: "Invite buyer",
  awaiting_funding: "Share link",
  cancelled_unfunded: "View",
  claimed: "View",
  draft: "Continue",
  frozen: "Resolve",
  refunded: "View",
  released: "View",
  settled: "View",
  unknown_spend: "Review",
};

export function EscrowDealRow({ deal }: { deal: EscrowDeal }) {
  const { itemTotalSompi } = computeEscrowAmounts(deal);
  return (
    <li className="escrow-deal-row">
      <div className="escrow-deal-row-main">
        <span className="escrow-deal-row-title">{deal.title}</span>
        <span className="escrow-deal-row-meta">
          {deal.reference} · {DATE_FORMAT.format(new Date(deal.createdAt))} ·{" "}
          {deal.buyerAddressLabel ? (
            <>
              Buyer <span className="value-mono">{deal.buyerAddressLabel}</span>
            </>
          ) : (
            "No buyer yet"
          )}
        </span>
      </div>
      <div className="escrow-deal-row-side">
        <span className="escrow-deal-row-amount">
          {formatKasAmount(itemTotalSompi)} <span className="amount-unit">KAS</span>
        </span>
        <EscrowStatusBadge status={deal.status} />
        <Link
          aria-label={`${SELLER_ACTION_LABEL[deal.status]}: ${deal.title}`}
          className="btn escrow-deal-row-action"
          href={`/escrow/${deal.id}`}
        >
          {SELLER_ACTION_LABEL[deal.status]}
        </Link>
      </div>
    </li>
  );
}
