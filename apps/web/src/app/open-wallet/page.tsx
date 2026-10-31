import type { Metadata } from "next";

import { OpenWalletClient } from "./OpenWalletClient";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Open wallet",
};

export default function OpenWalletPage() {
  return <OpenWalletClient />;
}
