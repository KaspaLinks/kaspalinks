import { CheckIcon, ClockIcon, KeyIcon, PauseIcon, SplitIcon } from "./EscrowIcons";

/**
 * The spend paths every escrow link follows. The copy must stay honest: the
 * covenant enforces these rules, but it cannot check a parcel, and KaspaLinks
 * never decides who gets the KAS.
 */
export function EscrowRules({ releaseWindowDays }: { releaseWindowDays: number | null }) {
  const windowText = releaseWindowDays ? `${releaseWindowDays} days` : "the agreed window";

  return (
    <div className="escrow-rules">
      <ul className="escrow-rule-list">
        <li>
          <CheckIcon />
          <span>
            <strong>Buyer releases.</strong> Once the item is fine, the buyer releases the payment
            to the seller. V1 has no deposits.
          </span>
        </li>
        <li>
          <ClockIcon />
          <span>
            <strong>Deadline passes.</strong> If the buyer does nothing for {windowText} after
            paying, the seller can claim the payment.
          </span>
        </li>
        <li>
          <PauseIcon />
          <span>
            <strong>Buyer freezes.</strong> The buyer can freeze an active escrow, including after
            the deadline. A late freeze and seller claim compete; the first confirmed spend wins.
          </span>
        </li>
        <li>
          <SplitIcon />
          <span>
            <strong>Both agree.</strong> Both sign the same split to settle a frozen escrow. The
            seller can also refund the buyer alone, less the remaining transaction fee.
          </span>
        </li>
      </ul>
      <p className="escrow-rules-limit">
        The escrow cannot check a parcel or judge a disagreement. Without an agreement or seller
        refund, a frozen payment can remain locked indefinitely.
      </p>
      <p className="escrow-rules-keys">
        <KeyIcon />
        <span>
          KaspaLinks never holds your KAS or keys, and will never ask for your seed phrase or
          private key.
        </span>
      </p>
    </div>
  );
}
