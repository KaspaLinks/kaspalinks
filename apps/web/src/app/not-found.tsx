import Link from "next/link";

import { BrandLogo } from "./BrandLogo";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-panel">
        <BrandLogo variant="hero" />
        <span className="hero-eyebrow">404</span>
        <h1>Link not found.</h1>
        <p className="muted">
          This Kaspa link may have been removed, disabled, or typed incorrectly.
        </p>
        <div className="row">
          <Link className="btn btn-primary" href="/">
            Go home
          </Link>
          <Link className="btn" href="/try-it-out">
            Try it out
          </Link>
        </div>
      </section>
    </main>
  );
}
