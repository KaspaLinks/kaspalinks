import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TRY_IT_DESCRIPTION =
  "Try Kaspa Links in 5 minutes — create a profile, make a payment link, share it, and receive KAS directly in your wallet.";

export const metadata: Metadata = {
  alternates: { canonical: "/try-it-out" },
  description: TRY_IT_DESCRIPTION,
  openGraph: {
    description: TRY_IT_DESCRIPTION,
    title: "Try it out",
    type: "website",
    url: "/try-it-out",
  },
  title: "Try it out",
  twitter: {
    card: "summary_large_image",
    description: TRY_IT_DESCRIPTION,
    title: "Try it out",
  },
};

type WalkthroughIconName = "confirm" | "link" | "pay" | "profile" | "share" | "wallet";

function WalkthroughIcon({ name }: { name: WalkthroughIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "1.8",
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "wallet":
      return (
        <svg {...common}>
          <rect height="14" rx="3" width="18" x="3" y="5" />
          <path d="M17 9h4v6h-4a3 3 0 0 1 0-6Z" />
          <path d="M7 9h4" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="m9.5 14.5-1.7 1.7a3.8 3.8 0 0 1-5.4-5.4l2.4-2.4a3.8 3.8 0 0 1 5.4 0" />
          <path d="m14.5 9.5 1.7-1.7a3.8 3.8 0 1 1 5.4 5.4l-2.4 2.4a3.8 3.8 0 0 1-5.4 0" />
          <path d="M8.5 12h7" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="m8.2 10.8 7.6-4.4" />
          <path d="m8.2 13.2 7.6 4.4" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <rect height="16" rx="3" width="18" x="3" y="4" />
          <circle cx="9" cy="10" r="2" />
          <path d="M6.5 16a3 3 0 0 1 5 0" />
          <path d="M14 9h4" />
          <path d="M14 13h3" />
        </svg>
      );
    case "pay":
      return (
        <svg {...common}>
          <rect height="14" rx="3" width="18" x="3" y="5" />
          <path d="M3 10h18" />
          <path d="M7 15h4" />
        </svg>
      );
    case "confirm":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
  }
}

export default function TryItOutPage() {
  return (
    <main className="main-wide">
      <section className="hero" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <span className="hero-eyebrow">Walkthrough</span>
        <h1 className="hero-title" style={{ fontSize: "2rem" }}>
          Try Kaspa Links in five minutes.
        </h1>
        <p className="hero-sub">
          Create a public profile, make your first payment link, share it, and test a real
          wallet-to-wallet payment. Kaspa Links shows the payment clearly before anyone opens a
          wallet, and the KAS goes straight to the recipient address.
        </p>
      </section>

      <ol className="walkthrough">
        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="wallet" />
          </div>
          <div className="walkthrough-body">
            <h2>Install a Kaspa wallet</h2>
            <p className="muted" style={{ marginBottom: 8 }}>
              Kaspa Links never holds funds — you pay directly from your own wallet.
            </p>
            <ul style={{ margin: 0 }}>
              <li>
                <strong>Desktop:</strong>{" "}
                <a href="https://www.kasware.xyz/" rel="noreferrer noopener" target="_blank">
                  KasWare
                </a>{" "}
                browser extension (Chrome / Brave / Edge).
              </li>
              <li>
                <strong>Mobile:</strong>{" "}
                <a href="https://kaspium.io/" rel="noreferrer noopener" target="_blank">
                  Kaspium
                </a>{" "}
                for iOS and Android.
              </li>
            </ul>
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Tip: send yourself a small amount first (1&ndash;2 KAS is plenty) so the whole flow
              feels real without committing much.
            </p>
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Need KAS first?{" "}
              <a href="https://kaspa.org/hodl" rel="noreferrer noopener" target="_blank">
                Kaspa&apos;s official guide
              </a>{" "}
              shows how to buy KAS and move it into a wallet you control.
            </p>
          </div>
        </li>

        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="link" />
          </div>
          <div className="walkthrough-body">
            <h2>Create your first link</h2>
            <p style={{ marginBottom: 8 }}>
              A Kaspa link is a small payment page you can share anywhere. You choose what the link
              is for, which Kaspa address receives the payment, and whether the amount is fixed or
              chosen by the supporter.
            </p>
            <p className="muted" style={{ marginTop: 0 }}>
              Sign in with your creator token, or create a new profile in seconds — no email, no
              password.
            </p>
            <div className="row">
              <Link href="/dashboard" className="btn btn-primary">
                Sign in or create profile
              </Link>
            </div>
          </div>
        </li>

        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="profile" />
          </div>
          <div className="walkthrough-body">
            <h2>Shape your public profile</h2>
            <p style={{ marginBottom: 8 }}>
              Your profile lives at <code>/u/yourname</code>. Think of it as your Kaspa support
              page: one main payment card at the top, plus extra links below for invoices, goals, or
              other ways people can support you.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Your first visible link becomes the main card automatically. Use <em>My profile</em>{" "}
              later to edit your name, bio, social links, or choose a different main card.
            </p>
          </div>
        </li>

        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="share" />
          </div>
          <div className="walkthrough-body">
            <h2>Share the link</h2>
            <p style={{ marginBottom: 0 }}>
              Share your profile, like <code>/u/yourname</code>, or a single payment link, like{" "}
              <code>/u/yourname/coffee</code>. Put it in your bio, post it on X, send it in chat, or
              download a QR code for streams, events, and printed material.
            </p>
          </div>
        </li>

        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="pay" />
          </div>
          <div className="walkthrough-body">
            <h2>Pay the way you prefer</h2>
            <p style={{ marginBottom: 8 }}>
              The supporter sees the title, amount, address, and message before paying. Then they
              choose the wallet flow that fits their device:
            </p>
            <ul style={{ margin: 0 }}>
              <li>
                <strong>Desktop:</strong> click <em>Pay with KasWare</em>. KasWare opens with the
                address and amount filled in, ready to review.
              </li>
              <li>
                <strong>Mobile:</strong> scan the QR code with Kaspium, or tap{" "}
                <em>Open in wallet</em> to open the wallet from the phone.
              </li>
              <li>
                <strong>Manual:</strong> copy the address and amount into any Kaspa wallet.
              </li>
            </ul>
          </div>
        </li>

        <li className="walkthrough-step">
          <div className="walkthrough-index">
            <WalkthroughIcon name="confirm" />
          </div>
          <div className="walkthrough-body">
            <h2>Watch it confirm</h2>
            <p style={{ margin: 0 }}>
              After the wallet sends the payment, Kaspa Links watches for it on-chain. The status
              changes from <span className="status-pill status-pending">Pending</span> to{" "}
              <span className="status-pill status-confirmed">Confirmed</span> when the payment is
              found — usually within a few seconds. The transaction link appears automatically.
            </p>
          </div>
        </li>
      </ol>

      <section className="use-case-guides">
        <p className="use-case-guides-intro muted">
          Pick the starting point that fits what you want to share. Each button opens the create
          form with useful starter text and the right link type.
        </p>

        <article className="card use-case-guide" id="creators">
          <span className="label">Creators</span>
          <h2>A tip jar</h2>
          <p>
            Use a <strong>Tip link</strong> when people should choose the amount themselves. Put
            your <code>/u/yourname</code> profile in your bio and let supporters send a quick thank
            you in KAS.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/new-link?template=creator-tip">
              Create a tip link
            </Link>
          </div>
        </article>

        <article className="card use-case-guide" id="freelancers">
          <span className="label">Freelancers</span>
          <h2>A fixed invoice</h2>
          <p>
            Use an <strong>Invoice link</strong> when the amount should be exact. Your client opens
            the link, sees what to pay, and the page confirms automatically when the payment arrives.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/new-link?template=fixed-invoice">
              Create an invoice link
            </Link>
          </div>
        </article>

        <article className="card use-case-guide" id="communities">
          <span className="label">Communities &amp; DAOs</span>
          <h2>A transparent donation page</h2>
          <p>
            Use a <strong>Donation link</strong> for a project, treasury, or community wallet. One
            link can stay live over time, and your dashboard shows incoming payments as they arrive.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/new-link?template=support-work">
              Create a donation link
            </Link>
          </div>
        </article>

        <article className="card use-case-guide" id="goals">
          <span className="label">Projects &amp; crowdfunding</span>
          <h2>A fundraising goal</h2>
          <p>
            Use a <strong>Goal link</strong> when you want to raise toward a target. Supporters can
            send any amount, and the public page shows the live progress bar.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/new-link?template=funding-goal">
              Create a goal link
            </Link>
          </div>
        </article>

        <article className="card use-case-guide" id="developers">
          <span className="label">Developers</span>
          <h2>A transfer for testing</h2>
          <p>
            Use a <strong>Transfer link</strong> for a simple fixed payment or integration test. It
            is the plainest link type: one address, one optional amount, one clear payment page.
            Developers can also read the public JSON metadata behind each link.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/new-link?template=simple-transfer">
              Create a transfer link
            </Link>
          </div>
        </article>

        <article className="card use-case-guide" id="claimable">
          <span className="label">Gifts, giveaways &amp; rewards</span>
          <h2>A claimable link or claim drop</h2>
          <p>
            Create one claimable reward, or prepare 2 to 10 separate links as a Claim Drop. A drop
            is funded once, but every recipient gets an individual link and on-chain output. The
            first person with each link can claim it; after expiry, your private recovery data lets
            you refund any link that was not claimed.
          </p>
          <div className="row use-case-guide-actions">
            <Link className="btn btn-primary" href="/claim/create">
              Create a claimable link
            </Link>
            <Link className="btn" href="/claim/batch">
              Create a claim drop
            </Link>
          </div>
        </article>
      </section>

      <section className="card card-muted" style={{ marginTop: 18 }}>
        <h2 style={{ marginBottom: 6 }}>Need help?</h2>
        <p className="muted" style={{ margin: 0 }}>
          Kaspa Links is non-custodial — we can never recover funds, reverse transactions, or sign
          on your behalf. Always double-check the recipient address before you sign, and start with
          a small amount when you&apos;re trying things out.
        </p>
      </section>
    </main>
  );
}
