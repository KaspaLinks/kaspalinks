"use client";
import { loadPrototypeSdk } from "@/app/toccata-lab/prize-covenant/browser";
import { useState } from "react";
import { verifyCovenantDrawProof, type CovenantDrawProof } from "@/lib/covenant-draw-proof";
export default function DrawProof({ proof }: { proof: CovenantDrawProof }) {
  const [result, setResult] = useState<string | null>(null);
  return (
    <details className="giveaway-proof">
      <summary>How was the winner drawn?</summary>
      <ol>
        <li>{proof.entryHashes.length} address hashes were sorted and locked.</li>
        <li>A future Kaspa block supplied the randomness.</li>
        <li>The hash of randomness and list selected entry #{proof.winnerIndex + 1}.</li>
        <li>SilverScript enforces payment to that entry.</li>
      </ol>
      <p>
        <a
          href={`https://explorer.kaspa.org/blocks/${proof.blockHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View randomness block
        </a>
      </p>
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            try {
              const sdk = await loadPrototypeSdk();
              const address = new sdk.Address(proof.winnerAddress);
              const matches =
                address.prefix === "kaspa" &&
                "0000" + sdk.payToAddressScript(address).script === proof.winnerScriptHex;
              setResult(
                matches && (await verifyCovenantDrawProof(proof))
                  ? "Draw calculation and winner address match the published proof."
                  : "Proof verification failed.",
              );
            } catch {
              setResult("Proof verification could not complete.");
            }
          }}
        >
          Verify calculation
        </button>
        <button
          className="btn"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "giveaway-draw-proof.json";
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download proof
        </button>
      </div>
      <p role="status">{result}</p>
      <p className="muted">
        Verification checks the calculation, not honest registration or the block's chain
        membership. The platform attests both the list and block. You can compare the block and
        payout in the explorer.
      </p>
    </details>
  );
}
