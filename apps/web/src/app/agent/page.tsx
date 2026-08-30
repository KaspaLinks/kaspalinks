import type { Metadata } from "next";

import { AgentClient } from "./AgentClient";

export const metadata: Metadata = {
  description: "Manage the private KaspaLinks Agent beta and Telegram notifications.",
  title: "Agent · Kaspa Links",
};

export default function AgentPage() {
  return <AgentClient />;
}
