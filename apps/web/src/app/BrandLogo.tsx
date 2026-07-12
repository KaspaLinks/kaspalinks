import { LogoMark } from "./LogoMark";

type BrandLogoProps = {
  variant?: "header" | "hero";
};

export function BrandLogo({ variant = "header" }: BrandLogoProps) {
  const markSize = variant === "hero" ? 74 : 42;

  return (
    <span className={`brand-lockup brand-lockup-${variant}`}>
      <LogoMark size={markSize} title={undefined} variant="embedded" />
      <span className="brand-lockup-copy">
        <span className="brand-lockup-name">Kaspa</span>
        <span className="brand-lockup-accent">Links</span>
      </span>
    </span>
  );
}
