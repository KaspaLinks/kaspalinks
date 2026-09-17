import type { ReactNode } from "react";

import { CheckIcon, LinkIcon, LockIcon, PackageIcon } from "./EscrowIcons";

const STEPS: ReadonlyArray<{ body: string; icon: ReactNode; title: string }> = [
  {
    body: "Describe the item, set a price in KAS, pick a deposit and a release window. Lock your deposit from your wallet.",
    icon: <LinkIcon />,
    title: "Seller creates a link",
  },
  {
    body: "Share it where you agreed the deal: a marketplace chat, Telegram, X. The buyer locks the payment plus their deposit.",
    icon: <LockIcon />,
    title: "Buyer pays into escrow",
  },
  {
    body: "The seller ships and adds tracking. Shipping addresses stay between you, wherever you agreed the deal.",
    icon: <PackageIcon />,
    title: "Seller ships",
  },
  {
    body: "The buyer checks the item and releases the KAS. If something is wrong, they freeze the escrow and you settle together.",
    icon: <CheckIcon />,
    title: "Buyer releases",
  },
];

export function EscrowIntro() {
  return (
    <section aria-labelledby="how-it-works-heading" className="card" id="how-it-works">
      <span className="label">How it works</span>
      <h2 id="how-it-works-heading">Four steps, one link</h2>
      <ol className="escrow-steps">
        {STEPS.map((step, index) => (
          <li className="escrow-step" key={step.title}>
            <span aria-hidden="true" className="escrow-step-icon">
              {step.icon}
            </span>
            <span className="escrow-step-number">Step {index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
