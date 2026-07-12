import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Kaspa Links — shareable Kaspa payment links";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#0b1116",
        backgroundImage:
          "radial-gradient(circle at 90% 10%, rgba(73,234,203,0.20) 0%, rgba(73,234,203,0) 55%), radial-gradient(circle at 5% 95%, rgba(112,199,186,0.10) 0%, rgba(112,199,186,0) 55%)",
        color: "#e6eef3",
        display: "flex",
        flexDirection: "row",
        gap: 64,
        height: "100%",
        padding: "60px 72px",
        width: "100%",
      }}
    >
      {/* Left column — pitch */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
        }}
      >
        {/* Brand mark */}
        <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
          <svg height={64} viewBox="0 0 80 64" width={80} xmlns="http://www.w3.org/2000/svg">
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect
                height={28}
                rx={14}
                stroke="#70C7BA"
                strokeWidth={6}
                transform="rotate(-18 24 32)"
                width={30}
                x={9}
                y={18}
              />
              <rect
                height={28}
                rx={14}
                stroke="#49EACB"
                strokeWidth={6}
                transform="rotate(-18 50 32)"
                width={30}
                x={35}
                y={18}
              />
              <path d="M28 32h24" stroke="#FFFFFF" strokeWidth={6} />
            </g>
          </svg>
          <div style={{ display: "flex", gap: 10 }}>
            <span
              style={{
                color: "#ffffff",
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: -0.6,
              }}
            >
              Kaspa
            </span>
            <span
              style={{
                color: "#49EACB",
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: -0.6,
              }}
            >
              Links
            </span>
          </div>
        </div>

        {/* Eyebrow */}
        <div
          style={{
            alignSelf: "flex-start",
            background: "rgba(73, 234, 203, 0.08)",
            border: "1px solid rgba(112, 199, 186, 0.32)",
            borderRadius: 999,
            color: "#49EACB",
            display: "flex",
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 3,
            marginTop: 36,
            padding: "8px 16px",
            textTransform: "uppercase",
          }}
        >
          Non-custodial · on-chain
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
          <span
            style={{
              color: "#ffffff",
              fontSize: 68,
              fontWeight: 800,
              letterSpacing: -1.8,
              lineHeight: 1.04,
            }}
          >
            Turn Kaspa payments
          </span>
          <span
            style={{
              color: "#49EACB",
              fontSize: 68,
              fontWeight: 800,
              letterSpacing: -1.8,
              lineHeight: 1.04,
            }}
          >
            into shareable links.
          </span>
        </div>

        {/* Sub */}
        <div
          style={{
            color: "#8395a2",
            display: "flex",
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.4,
            marginTop: "auto",
          }}
        >
          Tip. Donate. Invoice. Direct supporter-to-recipient — no platform between.
        </div>
      </div>

      {/* Right column — mockup of a Kaspa Link page */}
      <div
        style={{
          background: "linear-gradient(180deg, #161f27 0%, #131b22 100%)",
          border: "1px solid #2f3d47",
          borderRadius: 20,
          boxShadow:
            "0 0 0 1px rgba(112, 199, 186, 0.18), 0 28px 64px -20px rgba(73, 234, 203, 0.35)",
          display: "flex",
          flexDirection: "column",
          padding: 30,
          width: 380,
        }}
      >
        {/* Window dots */}
        <div style={{ alignItems: "center", display: "flex", gap: 7, marginBottom: 26 }}>
          <div
            style={{
              background: "#3b4854",
              borderRadius: 99,
              display: "flex",
              height: 10,
              width: 10,
            }}
          />
          <div
            style={{
              background: "#3b4854",
              borderRadius: 99,
              display: "flex",
              height: 10,
              width: 10,
            }}
          />
          <div
            style={{
              background: "#3b4854",
              borderRadius: 99,
              display: "flex",
              height: 10,
              width: 10,
            }}
          />
        </div>

        {/* Type tag */}
        <div
          style={{
            alignSelf: "flex-start",
            background: "rgba(73, 234, 203, 0.1)",
            border: "1px solid rgba(112, 199, 186, 0.3)",
            borderRadius: 999,
            color: "#49EACB",
            display: "flex",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1.6,
            marginBottom: 14,
            padding: "5px 12px",
            textTransform: "uppercase",
          }}
        >
          KASPA.TIP
        </div>

        {/* Title */}
        <span
          style={{
            color: "#ffffff",
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: -0.6,
            marginBottom: 4,
          }}
        >
          Tip the developer
        </span>
        <span
          style={{
            color: "#8395a2",
            display: "flex",
            fontSize: 16,
            marginBottom: 26,
          }}
        >
          Support open-source Kaspa tools
        </span>

        {/* Amount */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 22 }}>
          <span
            style={{
              color: "#5f6f7c",
              display: "flex",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Amount
          </span>
          <div style={{ alignItems: "baseline", display: "flex", gap: 8 }}>
            <span
              style={{
                color: "#ffffff",
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: -1.2,
              }}
            >
              10
            </span>
            <span
              style={{
                color: "#49EACB",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              KAS
            </span>
          </div>
        </div>

        {/* Recipient */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 26 }}>
          <span
            style={{
              color: "#5f6f7c",
              display: "flex",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Recipient
          </span>
          <span
            style={{
              color: "#e6eef3",
              display: "flex",
              fontFamily: "monospace",
              fontSize: 15,
            }}
          >
            kaspa:qpau…xjsgzthw5j
          </span>
        </div>

        {/* Confirmed pill */}
        <div
          style={{
            alignItems: "center",
            alignSelf: "flex-start",
            background: "rgba(92, 228, 173, 0.12)",
            border: "1px solid rgba(92, 228, 173, 0.32)",
            borderRadius: 999,
            color: "#5ce4ad",
            display: "flex",
            fontSize: 14,
            fontWeight: 600,
            gap: 8,
            letterSpacing: 0.8,
            padding: "7px 14px",
          }}
        >
          <div
            style={{
              background: "#5ce4ad",
              borderRadius: 99,
              display: "flex",
              height: 8,
              width: 8,
            }}
          />
          CONFIRMED
        </div>
      </div>
    </div>,
    { ...size },
  );
}
