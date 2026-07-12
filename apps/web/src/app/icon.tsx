import { ImageResponse } from "next/og";

/**
 * Dynamic 32x32 browser-tab favicon.
 *
 * Next.js mounts this at `/icon?<hash>` where the hash changes on every
 * build. That's the whole point of dynamic-vs-static here: Safari aggressively
 * caches favicons per-domain in `~/Library/Safari/Favicon Cache.db` and
 * ignores HTTP cache headers, so a static favicon-32x32.png never refreshes
 * for users who saw an earlier build. A hashed URL forces Safari to fetch
 * again because the URL itself is new.
 *
 * Rendered with Satori (via `ImageResponse`) — the same SVG-with-rotate
 * pattern is already used by opengraph-image.tsx in production.
 */

export const runtime = "nodejs";
export const size = { height: 32, width: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#0b1116",
        borderRadius: 7,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg height={28} viewBox="0 0 64 64" width={28} xmlns="http://www.w3.org/2000/svg">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect
            height={22}
            rx={11}
            stroke="#70C7BA"
            strokeWidth={5}
            transform="rotate(-18 19 32)"
            width={24}
            x={7}
            y={21}
          />
          <rect
            height={22}
            rx={11}
            stroke="#49EACB"
            strokeWidth={5}
            transform="rotate(-18 45 32)"
            width={24}
            x={33}
            y={21}
          />
          <path d="M24 32h16" stroke="#FFFFFF" strokeWidth={5} />
        </g>
      </svg>
    </div>,
    { ...size },
  );
}
