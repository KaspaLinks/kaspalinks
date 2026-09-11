import { notFound } from "next/navigation";
import PrototypeClient from "./PrototypeClient";
export const metadata = {
  title: "Mainnet covenant prototype",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function PrizeCovenantPrototypePage() {
  if (process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true") notFound();
  return <PrototypeClient />;
}
