import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";

import "./escrow.css";

export const metadata: Metadata = {
  // Mock-data prototype, visible only to allowlisted creators: never index it,
  // and keep the server-rendered title neutral. The access gate sets the real title.
  robots: { follow: false, index: false },
  title: { absolute: "Kaspa Links" },
};

export default function EscrowLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!isEscrowPrototypeEnabled()) {
    notFound();
  }

  return children;
}
