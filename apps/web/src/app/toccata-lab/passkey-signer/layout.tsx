import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../escrow/escrow.css";
import "./passkey-signer.css";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  // The client-side access gate sets the descriptive title only after the
  // allowlisted creator session has been verified.
  title: { absolute: "Kaspa Links" },
};

export default function PasskeySignerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
