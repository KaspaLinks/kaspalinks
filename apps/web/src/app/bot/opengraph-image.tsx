import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Kaspa Links in Telegram: send KAS, get paid and run giveaways from a chat";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

const FEATURES = ["Send KAS", "Get paid", "Giveaways"] as const;

export default async function BotOpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#0b1116",
        backgroundImage:
          "radial-gradient(circle at 90% 10%, rgba(73,234,203,0.22) 0%, rgba(73,234,203,0) 55%), radial-gradient(circle at 5% 95%, rgba(112,199,186,0.10) 0%, rgba(112,199,186,0) 55%)",
        color: "#e6eef3",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "64px 76px",
        width: "100%",
      }}
    >
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
          <span style={{ color: "#ffffff", fontSize: 34, fontWeight: 700 }}>Kaspa</span>
          <span style={{ color: "#49EACB", fontSize: 34, fontWeight: 700 }}>Links</span>
        </div>
      </div>

      <div
        style={{
          alignSelf: "flex-start",
          background: "rgba(73, 234, 203, 0.08)",
          border: "1px solid rgba(112, 199, 186, 0.32)",
          borderRadius: 999,
          color: "#49EACB",
          display: "flex",
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: 3,
          marginTop: 48,
          padding: "8px 18px",
          textTransform: "uppercase",
        }}
      >
        Now in Telegram
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
        <span style={{ color: "#ffffff", fontSize: 76, fontWeight: 800, lineHeight: 1.04 }}>
          Kaspa payments,
        </span>
        <span style={{ color: "#49EACB", fontSize: 76, fontWeight: 800, lineHeight: 1.04 }}>
          right in your chats.
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
        {FEATURES.map((feature) => (
          <div
            key={feature}
            style={{
              background: "#161f27",
              border: "1px solid #2f3d47",
              borderRadius: 14,
              color: "#e6eef3",
              display: "flex",
              fontSize: 28,
              fontWeight: 600,
              padding: "14px 24px",
            }}
          >
            {feature}
          </div>
        ))}
        <div
          style={{
            alignItems: "center",
            color: "#8395a2",
            display: "flex",
            fontSize: 26,
            marginLeft: "auto",
          }}
        >
          No account · non-custodial
        </div>
      </div>
    </div>,
    size,
  );
}
