import { describe, expect, it, vi } from "vitest";

import { KaspaVspcV2Client, readKaspaVspcV2Page } from "./kaspa-vspc-v2";

const START_HASH = "01".repeat(32);
const BLOCK_HASH = "aa".repeat(32);
const PARENT_HASH = "11".repeat(32);
const TRANSACTION_ID = "bb".repeat(32);
const PREVIOUS_TRANSACTION_ID = "cc".repeat(32);
const COVENANT_ID = "dd".repeat(32);
const SEQUENCE_COMMITMENT = "ee".repeat(32);

function fullResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    removedChainBlockHashes: ["ff".repeat(32)],
    addedChainBlockHashes: [BLOCK_HASH],
    chainBlockAcceptedTransactions: [
      {
        chainBlockHeader: {
          hash: BLOCK_HASH,
          parentsByLevel: {
            toExpanded: () => [[PARENT_HASH], ["22".repeat(32)]],
          },
          acceptedIdMerkleRoot: SEQUENCE_COMMITMENT,
          daaScore: 1234n,
          blueScore: 5678n,
        },
        acceptedTransactions: [
          {
            version: 1,
            inputs: [
              {
                previousOutpoint: { transactionId: PREVIOUS_TRANSACTION_ID, index: 3 },
                signatureScript: "51",
                sequence: 9n,
                computeBudget: 321,
                verboseData: {
                  utxoEntry: {
                    amount: 1_000_000n,
                    scriptPublicKey: { version: 0, script: "aa" },
                    blockDaaScore: 1200n,
                    isCoinbase: false,
                    covenantId: COVENANT_ID,
                  },
                },
              },
            ],
            outputs: [
              {
                value: 999_000n,
                scriptPublicKey: "000051",
                covenant: { authorizingInput: 0, covenantId: COVENANT_ID },
              },
            ],
            verboseData: { transactionId: TRANSACTION_ID },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function client(response: unknown = fullResponse(), network = "mainnet"): KaspaVspcV2Client {
  return {
    getCurrentNetwork: vi.fn(async () => ({ network })),
    getVirtualChainFromBlockV2: vi.fn(async () => response),
  };
}

describe("readKaspaVspcV2Page", () => {
  it("requests confirmed Full data and normalizes accepted covenant transactions", async () => {
    const rpc = client();
    const page = await readKaspaVspcV2Page(rpc, {
      startHash: START_HASH.toUpperCase(),
      minConfirmationCount: 25,
    });

    expect(rpc.getVirtualChainFromBlockV2).toHaveBeenCalledWith({
      startHash: START_HASH,
      dataVerbosityLevel: "Full",
      minConfirmationCount: 25,
    });
    expect(page).toMatchObject({
      network: "mainnet",
      removedChainBlockHashes: ["ff".repeat(32)],
      addedChainBlockHashes: [BLOCK_HASH],
      blocks: [
        {
          header: {
            hash: BLOCK_HASH,
            selectedParentHash: PARENT_HASH,
            acceptedIdMerkleRoot: SEQUENCE_COMMITMENT,
            daaScore: 1234n,
            blueScore: 5678n,
          },
          acceptedTransactions: [
            {
              transactionId: TRANSACTION_ID,
              acceptingBlockHash: BLOCK_HASH,
              acceptingDaaScore: 1234n,
              inputs: [
                {
                  previousOutpoint: { transactionId: PREVIOUS_TRANSACTION_ID, outputIndex: 3 },
                  signatureScriptHex: "51",
                  computeBudget: 321,
                  utxo: {
                    amountSompi: 1_000_000n,
                    scriptPublicKeyHex: "0000aa",
                    blockDaaScore: 1200n,
                    covenantIdHex: COVENANT_ID,
                  },
                },
              ],
              outputs: [
                {
                  outputIndex: 0,
                  amountSompi: 999_000n,
                  scriptPublicKeyHex: "000051",
                  covenant: { authorizingInput: 0, covenantIdHex: COVENANT_ID },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("checks the node network before reading chain data", async () => {
    const rpc = client(fullResponse(), "testnet-10");

    await expect(readKaspaVspcV2Page(rpc, { startHash: START_HASH })).rejects.toMatchObject({
      code: "VSPC_NETWORK_ERROR",
    });
    expect(rpc.getVirtualChainFromBlockV2).not.toHaveBeenCalled();
  });

  it("requires Full input UTXO context", async () => {
    const response = fullResponse();
    const block = (response.chainBlockAcceptedTransactions as Array<Record<string, unknown>>)[0]!;
    const transaction = (block.acceptedTransactions as Array<Record<string, unknown>>)[0]!;
    const input = (transaction.inputs as Array<Record<string, unknown>>)[0]!;
    delete input.verboseData;

    await expect(
      readKaspaVspcV2Page(client(response), { startHash: START_HASH }),
    ).rejects.toMatchObject({
      code: "VSPC_PARSE_ERROR",
    });
  });

  it("rejects imprecise numeric uint64 fields", async () => {
    const response = fullResponse();
    const block = (response.chainBlockAcceptedTransactions as Array<Record<string, unknown>>)[0]!;
    const header = block.chainBlockHeader as Record<string, unknown>;
    header.daaScore = 1234;

    await expect(
      readKaspaVspcV2Page(client(response), { startHash: START_HASH }),
    ).rejects.toMatchObject({
      code: "VSPC_PARSE_ERROR",
    });
  });

  it("rejects Full records outside the declared added-chain set", async () => {
    const response = fullResponse({ addedChainBlockHashes: ["33".repeat(32)] });

    await expect(
      readKaspaVspcV2Page(client(response), { startHash: START_HASH }),
    ).rejects.toMatchObject({
      code: "VSPC_PARSE_ERROR",
    });
  });

  it("uses ten confirmations by default", async () => {
    const rpc = client();
    await readKaspaVspcV2Page(rpc, { startHash: START_HASH });

    expect(rpc.getVirtualChainFromBlockV2).toHaveBeenCalledWith(
      expect.objectContaining({ minConfirmationCount: 10 }),
    );
  });
});
