import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../escrow/escrow.css";
import "./passkey-signer.css";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Passkey signer lab · Kaspa Links",
};

export default function PasskeySignerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
