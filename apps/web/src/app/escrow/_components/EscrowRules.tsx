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
            and both deposits go back.
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
            <strong>Buyer freezes.</strong> Before the deadline, the buyer can freeze the escrow.
            Then no single party can move the KAS.
          </span>
        </li>
        <li>
          <SplitIcon />
          <span>
            <strong>Both agree.</strong> A frozen escrow pays out only when buyer and seller sign
            the same split.
          </span>
        </li>
      </ul>
      <p className="escrow-rules-limit">
        The escrow cannot check a parcel or judge a disagreement. Deposits make stalling expensive
        for both sides, so agreeing is the fastest way out.
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
