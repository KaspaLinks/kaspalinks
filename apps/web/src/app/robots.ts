import type { MetadataRoute } from "next";

/**
 * Replaces the previous static robots.txt with a dynamic version that
 *  - explicitly disallows private + auth-gated routes from indexing
 *  - points crawlers at the sitemap
 *
 * The crawler-policy below is what Google / Bing / DuckDuckGo all read.
 * Without an explicit disallow they'd happily index the "Loading…"
 * placeholder rendered for client-only routes (dashboard, my-links,
 * new-link) — which would be a thin-content SEO signal we don't want.
 */
export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://kaspalinks.com";

  return {
    rules: [
      {
        allow: "/",
        disallow: [
          "/admin",
          "/operator-stats",
          "/dashboard",
          "/my-links",
          "/new-link",
          "/api/",
        ],
        userAgent: "*",
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
