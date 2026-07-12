type SocialPreviewImageProps = {
  amountLabel?: null | string;
  eyebrow: string;
  handle?: null | string;
  subtitle: string;
  title: string;
  typeLabel?: null | string;
};

export const socialPreviewImageSize = { height: 630, width: 1200 };

function BrandMark() {
  return (
    <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: 18 }}>
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
        <span style={{ color: "#ffffff", fontSize: 34, fontWeight: 800 }}>Kaspa</span>
        <span style={{ color: "#49EACB", fontSize: 34, fontWeight: 800 }}>Links</span>
      </div>
    </div>
  );
}

export function SocialPreviewImage({
  amountLabel,
  eyebrow,
  handle,
  subtitle,
  title,
  typeLabel,
}: SocialPreviewImageProps) {
  return (
    <div
      style={{
        alignItems: "stretch",
        background: "#0b1116",
        backgroundImage:
          "radial-gradient(circle at 86% 8%, rgba(73,234,203,0.20) 0%, rgba(73,234,203,0) 50%), radial-gradient(circle at 12% 88%, rgba(112,199,186,0.12) 0%, rgba(112,199,186,0) 55%)",
        boxSizing: "border-box",
        color: "#e6eef3",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        overflow: "hidden",
        padding: "58px 68px",
        width: "100%",
      }}
    >
      <BrandMark />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 1,
          gap: 22,
          maxWidth: 960,
        }}
      >
        <div
          style={{
            alignSelf: "flex-start",
            background: "rgba(73, 234, 203, 0.09)",
            border: "1px solid rgba(112, 199, 186, 0.34)",
            borderRadius: 999,
            color: "#49EACB",
            display: "flex",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 3.2,
            padding: "10px 18px",
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            color: "#ffffff",
            display: "flex",
            fontSize: 68,
            fontWeight: 900,
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>

        <div
          style={{
            color: "#a5b4c0",
            display: "flex",
            fontSize: 30,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 12 }}>
          {handle ? (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 999,
                color: "#dbe6ed",
                display: "flex",
                fontSize: 22,
                fontWeight: 800,
                padding: "10px 18px",
              }}
            >
              @{handle}
            </div>
          ) : null}
          {typeLabel ? (
            <div
              style={{
                background: "rgba(73,234,203,0.10)",
                border: "1px solid rgba(112,199,186,0.30)",
                borderRadius: 999,
                color: "#49EACB",
                display: "flex",
                fontSize: 22,
                fontWeight: 900,
                padding: "10px 18px",
              }}
            >
              {typeLabel}
            </div>
          ) : null}
          {amountLabel ? (
            <div
              style={{
                background: "rgba(73,234,203,0.15)",
                border: "1px solid rgba(73,234,203,0.40)",
                borderRadius: 999,
                color: "#ffffff",
                display: "flex",
                fontSize: 22,
                fontWeight: 900,
                padding: "10px 18px",
              }}
            >
              {amountLabel}
            </div>
          ) : null}
        </div>
        <div style={{ color: "#8395a2", display: "flex", fontSize: 24, fontWeight: 800 }}>
          Non-custodial · Wallet-to-wallet
        </div>
      </div>
    </div>
  );
}
