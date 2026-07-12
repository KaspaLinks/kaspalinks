import { ImageResponse } from "next/og";

/**
 * Dynamic 180x180 Apple touch icon (iOS home-screen, macOS pinned tab).
 *
 * Same brand mark as the 32x32 tab favicon but with the geometry scaled up
 * and a slightly more generous corner radius — iOS rounds it again on the
 * home screen, so under-rounding here looks better than over-rounding.
 * See app/icon.tsx for why dynamic generation (build-hashed URL) is
 * preferred over a static PNG asset.
 */

export const runtime = "nodejs";
export const size = { height: 180, width: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#0b1116",
        borderRadius: 40,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <svg height={132} viewBox="0 0 64 64" width={132} xmlns="http://www.w3.org/2000/svg">
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
