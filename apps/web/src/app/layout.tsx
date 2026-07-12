import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "./BrandLogo";
import { BrandNav } from "./BrandNav";
import "./globals.css";

function createMetadataBase(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

const SITE_NAME = "Kaspa Links";
const SITE_DESCRIPTION =
  "Non-custodial Kaspa payment links — share a URL, get paid wallet-to-wallet on the Kaspa BlockDAG. No middleman, no platform fees, no custody.";
const X_PROFILE_URL = "https://x.com/kaspalinks";
const GITHUB_REPOSITORY_URL = "https://github.com/KaspaLinks/kaspalinks";

export const metadata: Metadata = {
  // Canonical for the apex URL. Per-route pages override this with their
  // own canonical path so Google groups duplicate-via-trailing-slash etc.
  // under one URL each.
  alternates: {
    canonical: "/",
  },
  description: SITE_DESCRIPTION,
  // Favicons are not declared here — Next.js auto-discovers app/icon.tsx
  // and app/apple-icon.tsx and injects the right <link> tags with a
  // build-hashed URL. That hashed URL is what defeats Safari's per-domain
  // favicon cache (which ignores HTTP cache headers).
  metadataBase: createMetadataBase(),
  openGraph: {
    description: SITE_DESCRIPTION,
    locale: "en_US",
    siteName: SITE_NAME,
    title: SITE_NAME,
    type: "website",
    url: "/",
  },
  // Default crawler policy is "open"; per-route metadata can disable
  // indexing on auth-gated pages.
  robots: {
    follow: true,
    googleBot: {
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
      index: true,
    },
    index: true,
  },
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  twitter: {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    title: SITE_NAME,
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#0b1116",
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const commit = process.env.APP_COMMIT_SHA?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://kaspalinks.com";

  // JSON-LD structured data — gives Google + Bing a machine-readable hint
  // about what the site is. Two graphs:
  //   - WebSite: lets Google show the site name + a search box on SERPs.
  //   - Organization: identifies the project for "About" panels + future
  //     Knowledge-Graph entry if the project gains notability.
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${baseUrl}/#website`,
        "@type": "WebSite",
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        name: SITE_NAME,
        url: `${baseUrl}/`,
      },
      {
        "@id": `${baseUrl}/#organization`,
        "@type": "Organization",
        description:
          "Independent community project building non-custodial payment links on the Kaspa BlockDAG.",
        logo: `${baseUrl}/brand/kaspa-links-mark.svg`,
        name: SITE_NAME,
        sameAs: [X_PROFILE_URL, GITHUB_REPOSITORY_URL],
        url: `${baseUrl}/`,
      },
    ],
  };

  return (
    <html lang="en">
      <body>
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
          type="application/ld+json"
        />
        <header className="brand-bar">
          <Link className="brand-mark" href="/">
            <BrandLogo />
          </Link>
          <BrandNav />
        </header>
        {children}
        <footer className="app-footer">
          <div className="app-footer-main">
            <span>
              Independent community project · non-custodial · powered by the{" "}
              <a href="https://kaspa.org" rel="noopener noreferrer" target="_blank">
                Kaspa network
              </a>
            </span>
          </div>
          <div className="app-footer-links">
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/try-it-out">Try it out</Link>
            <Link href="/faq">FAQ</Link>
            <a href={X_PROFILE_URL} rel="noreferrer" target="_blank">
              X
            </a>
            <a href={GITHUB_REPOSITORY_URL} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <span className="app-footer-status">Status: live</span>
            {commit ? <span>Build {commit.slice(0, 7)}</span> : null}
          </div>
        </footer>
      </body>
    </html>
  );
}
