type LogoMarkProps = {
  /** Pixel height of the mark; defaults to 32. */
  size?: number;
  title?: string;
  variant?: "embedded" | "solid";
};

/**
 * Original Kaspa Links mark: two interlocking loops with a short route line
 * through the center. It reads as "linked payment path" without borrowing the
 * official Kaspa symbol.
 */
export function LogoMark({ size = 32, title = "Kaspa Links", variant = "solid" }: LogoMarkProps) {
  const secondaryStroke = variant === "embedded" ? "rgba(112, 199, 186, 0.9)" : "#70C7BA";
  const primaryStroke = variant === "embedded" ? "rgba(73, 234, 203, 0.96)" : "#49EACB";
  const routeStroke = variant === "embedded" ? "rgba(255, 255, 255, 0.9)" : "#FFFFFF";

  return (
    <svg
      aria-hidden={title === undefined}
      className="brand-logo-mark"
      height={size}
      role={title ? "img" : "presentation"}
      viewBox="0 0 80 64"
      width={(size * 80) / 64}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect
          height={28}
          rx={14}
          stroke={secondaryStroke}
          strokeWidth={6}
          transform="rotate(-18 24 32)"
          width={30}
          x={9}
          y={18}
        />
        <rect
          height={28}
          rx={14}
          stroke={primaryStroke}
          strokeWidth={6}
          transform="rotate(-18 50 32)"
          width={30}
          x={35}
          y={18}
        />
        <path d="M28 32h24" stroke={routeStroke} strokeWidth={6} />
      </g>
    </svg>
  );
}
