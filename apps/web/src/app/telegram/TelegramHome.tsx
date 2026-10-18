"use client";

export type TelegramView = "claim" | "create" | "manage" | "mine" | "pay";

const TILES: { description: string; label: string; view: TelegramView }[] = [
  {
    description: "A claim link for one person. Unclaimed KAS comes back to you.",
    label: "Send KAS",
    view: "claim",
  },
  {
    description: "Tips, donations, goals or invoices, paid straight to your wallet.",
    label: "Get paid",
    view: "pay",
  },
  {
    description: "A fair on-chain draw at a fixed time.",
    label: "Giveaway",
    view: "create",
  },
  {
    description: "Your links, claims and payments.",
    label: "My links",
    view: "mine",
  },
];

/** The Mini App's start screen: one tap to each thing Kaspa Links does in Telegram. */
export function TelegramHome({ onOpen }: { onOpen(view: TelegramView): void }) {
  return (
    <main className="main telegram-home">
      <header className="telegram-claim-head">
        <span className="label">Kaspa Links</span>
        <h1 className="form-section-heading">What would you like to do?</h1>
        <p className="muted">No account needed. Your KAS never passes through Kaspa Links.</p>
      </header>
      <div className="telegram-home-tiles">
        {TILES.map((tile) => (
          <button
            className="telegram-home-tile"
            key={tile.view}
            onClick={() => onOpen(tile.view)}
            type="button"
          >
            <strong>{tile.label}</strong>
            <span>{tile.description}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
