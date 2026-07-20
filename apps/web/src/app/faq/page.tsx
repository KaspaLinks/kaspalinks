import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

const FAQ_DESCRIPTION =
  "Common questions about Kaspa Links — custody, fees, refunds, claim drops, lost tokens, privacy, and how non-custodial Kaspa payment links work.";

export const metadata: Metadata = {
  alternates: { canonical: "/faq" },
  description: FAQ_DESCRIPTION,
  openGraph: {
    description: FAQ_DESCRIPTION,
    title: "FAQ",
    type: "website",
    url: "/faq",
  },
  title: "FAQ",
  twitter: {
    card: "summary_large_image",
    description: FAQ_DESCRIPTION,
    title: "FAQ",
  },
};

type FaqItem = {
  answer: string;
  link?: { href: string; label: string };
  question: string;
};

// Objection-first FAQ: the questions a creator or supporter weighs *before*
// their first link. Answers are plain strings so the same text feeds both the
// rendered accordion and the FAQPage JSON-LD (no drift between the two).
const FAQ_ITEMS: FaqItem[] = [
  {
    answer:
      "No. Kaspa Links is fully non-custodial. Payments go straight from the supporter's wallet to your Kaspa address — we never receive, hold, or move funds, and we can't freeze, seize, or sign on your behalf.",
    question: "Is Kaspa Links custodial — do you ever hold my funds?",
  },
  {
    answer:
      "There's no platform fee. You receive the full amount minus only the normal Kaspa network transaction fee, which is tiny and paid by the sender to the network — not to us.",
    question: "What does it cost? Are there any fees?",
  },
  {
    answer:
      "No. Kaspa transactions are final and settle on-chain, so a payment can't be reversed or charged back. Always double-check the recipient address before you sign, and start with a small amount when you're testing.",
    question: "Can a payment be refunded or reversed?",
  },
  {
    answer:
      "It can't be recovered. We store only a cryptographic hash of your creator token, never the token itself, so no one — including us — can retrieve it. Save it in a password manager when you create your profile.",
    question: "What happens if I lose my creator token?",
  },
  {
    answer:
      "No account is needed. A supporter only needs a Kaspa wallet: they open your link, review the amount and recipient, and pay — no sign-up, no email.",
    link: { href: "/try-it-out", label: "See the 5-minute walkthrough" },
    question: "Do supporters need an account to pay?",
  },
  {
    answer:
      "Kaspa Links runs on Kaspa mainnet. Payments settle on-chain — usually confirming in about a second — and the page flips to CONFIRMED automatically once the transaction lands.",
    question: "Which Kaspa network does it use?",
  },
  {
    answer:
      "Yes. Kaspa Links is open source and can be self-hosted on your own server. No vendor lock-in, no client-side tracking scripts, and no email required.",
    question: "Is Kaspa Links open source and self-hostable?",
  },
  {
    answer:
      "Tips (pay-what-you-want), Donations, fixed-amount Invoices, generic Transfers, Goals, Claimable links, and Claim Drops. Normal payment links send directly to the creator's address. Claimable links hold a fixed reward in a one-time on-chain output so the first person with the link can claim it. A Claim Drop creates 2 to 10 separate rewards in one flow.",
    link: { href: "/try-it-out", label: "Pick a starting point" },
    question: "What kinds of links can I create?",
  },
  {
    answer:
      "You choose an amount and a claim window, then fund a fresh one-time Kaspa address. Only after that funding is detected do you share the claim link. The recipient opens it, enters their own Kaspa address, reviews the transaction, and claims the KAS. When the timer ends, Kaspa Links stops preparing new claims and your private refund path becomes available. The output closes when either a claim or refund is confirmed on-chain.",
    link: { href: "/claim/create", label: "Create a claimable link" },
    question: "How does a claimable link work?",
  },
  {
    answer:
      "A Claim Drop creates 2 to 10 independent Claimable links with the same amount and expiry. You fund one batch address once, then your browser signs the activation transaction that creates a separate on-chain output for every link. Each link can be shared, claimed, tracked, and refunded individually. Save the private recovery bundle before funding — Kaspa Links cannot recreate it for you.",
    link: { href: "/claim/batch", label: "Create a claim drop" },
    question: "Can I create several claimable links at once?",
  },
  {
    answer:
      "The browser creates separate claim and refund codes. The claim code is kept after the # in the claim URL, which browsers do not send to our server. For a Claim Drop, every link gets its own private codes and the recovery bundle stays with you. The server stores public metadata and relays already signed transaction JSON, but it never stores claim/refund private keys and cannot claim or refund for you.",
    question: "How does the claimable link stay non-custodial?",
  },
  {
    answer:
      "As little as possible. There are no third-party tracking scripts. Off-chain supporter notes are visible only to you, the creator. Visit analytics are aggregated from server logs using daily visitor hashes instead of raw IP addresses.",
    question: "What data do you store about me and my supporters?",
  },
  {
    answer:
      "Payment splits, recurring payments, subscriptions, advanced escrow, and wallet-login accounts are not live yet. Kaspa Links is a payment-link tool: not a wallet, not a custodian, and not a payment processor in the legal sense.",
    link: { href: "/roadmap", label: "See the roadmap" },
    question: "What isn't supported yet?",
  },
];

export default function FaqPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      acceptedAnswer: { "@type": "Answer", text: item.answer },
      name: item.question,
    })),
  };

  return (
    <main className="main-wide">
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        type="application/ld+json"
      />

      <section className="hero" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <span className="hero-eyebrow">FAQ</span>
        <h1 className="hero-title" style={{ fontSize: "2rem" }}>
          Questions &amp; answers
        </h1>
        <p className="hero-sub">
          Custody, fees, refunds, privacy — the things people weigh before their first Kaspa link.
        </p>
      </section>

      <section className="card faq-card">
        <ul className="faq-list">
          {FAQ_ITEMS.map((item) => (
            <li key={item.question}>
              <details className="faq-item">
                <summary className="faq-question">{item.question}</summary>
                <div className="faq-answer">
                  <p>{item.answer}</p>
                  {item.link ? (
                    <p className="faq-answer-link">
                      <Link href={item.link.href}>{item.link.label} →</Link>
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-muted faq-footer-card">
        <p className="muted" style={{ margin: 0 }}>
          Still curious? <Link href="/what-is-kaspa">See what makes Kaspa fast</Link>, or{" "}
          <Link href="/try-it-out">try it in five minutes</Link>.
        </p>
      </section>
    </main>
  );
}
