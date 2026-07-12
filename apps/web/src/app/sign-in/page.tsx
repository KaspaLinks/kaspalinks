import type { Metadata } from "next";

import { SignInClient } from "./SignInClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/sign-in" },
  description:
    "Sign in to your Kaspa Links creator account with your creator token.",
  title: "Sign in",
};

export default function SignInPage() {
  return <SignInClient />;
}
