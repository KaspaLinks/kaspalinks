import type { MetadataRoute } from "next";

/**
 * Public sitemap served at /sitemap.xml.
 *
 * Lists the marketing + onboarding pages that should land in search
 * engines. Excludes private surfaces (admin, operator-stats, creator
 * dashboard) and dynamic supporter pay routes (/a/[publicId],
 * /u/[username]/[slug]) — those get discovered organically when
 * creators share their links, and they shouldn't compete with the
 * canonical landing for "kaspa links" queries.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://kaspalinks.com";
  const now = new Date();

  return [
    {
      changeFrequency: "weekly",
      lastModified: now,
      priority: 1,
      url: `${base}/`,
    },
    {
      changeFrequency: "monthly",
      lastModified: now,
      priority: 0.9,
      url: `${base}/deck`,
    },
    {
      changeFrequency: "weekly",
      lastModified: now,
      priority: 0.8,
      url: `${base}/try-it-out`,
    },
    {
      changeFrequency: "monthly",
      lastModified: now,
      priority: 0.7,
      url: `${base}/roadmap`,
    },
    {
      // Newcomer intro page — relevant for "what is kaspa" search
      // queries and acts as the on-ramp from any shared link for
      // visitors unfamiliar with the network.
      changeFrequency: "monthly",
      lastModified: now,
      priority: 0.7,
      url: `${base}/what-is-kaspa`,
    },
    {
      changeFrequency: "daily",
      lastModified: now,
      priority: 0.6,
      url: `${base}/stats`,
    },
    {
      // Objection-handling FAQ — targets "is kaspa links safe / fees /
      // refund" style queries and reinforces the non-custodial pitch.
      changeFrequency: "monthly",
      lastModified: now,
      priority: 0.6,
      url: `${base}/faq`,
    },
    {
      changeFrequency: "yearly",
      lastModified: now,
      priority: 0.4,
      url: `${base}/sign-in`,
    },
    {
      changeFrequency: "yearly",
      lastModified: now,
      priority: 0.4,
      url: `${base}/create-profile`,
    },
  ];
}
