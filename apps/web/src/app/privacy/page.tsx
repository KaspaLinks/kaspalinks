import type { Metadata } from "next";
import Link from "next/link";

const PRIVACY_DESCRIPTION =
  "What Kaspa Links stores, what it never sees, which services it uses, and what is public on the Kaspa blockchain anyway.";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  description: PRIVACY_DESCRIPTION,
  openGraph: {
    description: PRIVACY_DESCRIPTION,
    title: "Privacy",
    type: "website",
    url: "/privacy",
  },
  title: "Privacy",
};

// Every statement here must match the code: storage in packages/db/prisma/schema.prisma,
// log retention in deploy/Caddyfile (roll_keep_for), browser storage in lib/account-free-store.ts.
export default function PrivacyPage() {
  return (
    <main className="main-wide">
      <section className="hero" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <span className="hero-eyebrow">Privacy</span>
        <h1 className="hero-title" style={{ fontSize: "2rem" }}>
          What we store, and what we never see
        </h1>
        <p className="hero-sub">
          Kaspa Links is an independent, open-source community project. Last updated 24 November
          2026.
        </p>
      </section>

      <section className="card">
        <h2 className="form-section-heading">The short version</h2>
        <ul>
          <li>
            Kaspa Links never holds your money, and never needs your seed phrase or private keys.
          </li>
          <li>No ads, no third-party tracking scripts, no tracking cookies, no email required.</li>
          <li>
            Payments, claim links and giveaway entries happen on the public Kaspa blockchain.
            Addresses, amounts and transactions there are public and permanent, and nobody can
            delete them, including us.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="form-section-heading">What we store</h2>
        <ul>
          <li>
            <strong>Payment links:</strong> the recipient address, title, description, amount or
            goal, and link type. For a link made without an account, only a SHA-256 hash of its
            private manage token; the token itself stays in your manage link and your browser.
          </li>
          <li>
            <strong>Payments through a link:</strong> transaction ID, amount and status. A note the
            payer chooses to write is shown only to the link’s creator. Payers appear on a public
            supporter wall only if they opt in.
          </li>
          <li>
            <strong>Profiles (optional):</strong> your username, bio and the links you add, and a
            hash of your creator token, never the token itself.
          </li>
          <li>
            <strong>Claim links and Claim Drops:</strong> public details such as amount, expiry,
            return address and on-chain IDs. The claim code sits after the # in the link, which
            browsers never send to our server.
          </li>
          <li>
            <strong>On-chain giveaways:</strong> the giveaway settings and the Kaspa addresses that
            entered, which are recorded on-chain as well.
          </li>
          <li>
            <strong>Telegram (optional):</strong> your Telegram user and chat ID, your notification
            settings and when you last used the bot. Interpreting free text with an AI provider is
            switched off.
          </li>
          <li>
            <strong>Security log:</strong> important actions, such as creating a link, record a
            hashed (pseudonymised) form of the IP address, not the address itself.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="form-section-heading">Server logs</h2>
        <p>
          Like almost every website, our web server logs each request: IP address, browser user
          agent, requested address, time and response code. Tokens and cookies are removed before
          anything is written. The logs are deleted automatically after 30 days at most. We use them
          to spot abuse and scanners, and to count visits; those counts use a daily hash instead of
          the IP address. Rate limits use a hash of the IP address and are kept only in memory.
        </p>
      </section>

      <section className="card">
        <h2 className="form-section-heading">Services we use</h2>
        <ul>
          <li>
            <strong>Cloudflare</strong> delivers kaspalinks.com and protects it from attacks, so it
            processes your IP address and request data. Creating a link without an account and
            entering a giveaway use Cloudflare Turnstile, a bot check that replaces a CAPTCHA.
            Cloudflare may set strictly necessary security cookies.
          </li>
          <li>
            <strong>The Kaspa network:</strong> to show payment status, our server asks public Kaspa
            nodes about addresses and transactions, not about you.
          </li>
          <li>
            <strong>Exchange rate:</strong> the approximate USD value comes from CoinGecko. Our
            server fetches it, not your browser.
          </li>
          <li>
            <strong>AI assistants:</strong> if you use Kaspa Links from an AI assistant (through our
            MCP server), the assistant’s provider sends us the tool request, for example the address
            to fill into a form. We answer it without storing its content; our log only notes which
            tool was used. What your assistant’s provider keeps is covered by its own privacy
            policy.
          </li>
          <li>
            <strong>Wallets:</strong> paying happens in your own wallet. We never see its keys.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="form-section-heading">In your browser</h2>
        <p>
          Your sign-in session (if you have a profile) lives in session storage. Links you made
          without an account are remembered in local storage so you can find them again; their
          manage tokens are sealed with a key your browser does not let anyone export. You can clear
          both at any time in your browser settings.
        </p>
      </section>

      <section className="card">
        <h2 className="form-section-heading">Your choices</h2>
        <ul>
          <li>
            Delete your profile on <Link href="/my-profile">My profile</Link>.
          </li>
          <li>Delete a link made without an account with its manage link.</li>
          <li>
            Disconnect Telegram on the <Link href="/agent">Agent</Link> page.
          </li>
          <li>Data on the Kaspa blockchain cannot be deleted by anyone.</li>
        </ul>
      </section>

      <section className="card" id="contact">
        <h2 className="form-section-heading">Contact</h2>
        <p>
          Questions or requests:{" "}
          <a
            href="https://github.com/KaspaLinks/kaspalinks/issues"
            rel="noreferrer"
            target="_blank"
          >
            open an issue on GitHub
          </a>{" "}
          or write to{" "}
          <a href="https://x.com/kaspalinks" rel="noreferrer" target="_blank">
            @kaspalinks on X
          </a>
          . Please report security issues privately through{" "}
          <a
            href="https://github.com/KaspaLinks/kaspalinks/security/advisories/new"
            rel="noreferrer"
            target="_blank"
          >
            GitHub’s private vulnerability reporting
          </a>
          . The source code is public, so every statement on this page can be checked.
        </p>
      </section>
    </main>
  );
}
