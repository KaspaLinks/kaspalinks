import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  GiveawayV6ReconstructionConfig,
  GiveawayV6ReconstructionSnapshot,
} from "@kaspa-actions/kaspa-indexer";

import {
  createGiveawayV6EntropyProverClient,
  createGiveawayV6EntropyProverSocketClient,
} from "./giveaway-v6-prover";

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: "11".repeat(32),
  closesAtDaa: 100n,
  returnAtDaa: 300n,
  entropyTargetBlueScore: 200n,
  shardCount: 1,
  treeDepth: 4,
  maxEntriesPerShard: 16,
  returnScriptPublicKeyHex: "000051",
};

const snapshot: GiveawayV6ReconstructionSnapshot = {
  phase: "frozen",
  activationTransactionId: "22".repeat(32),
  freezeTransactionId: "33".repeat(32),
  terminalTransactionId: null,
  prizeOutpoint: { transactionId: "33".repeat(32), outputIndex: 0 },
  observedRegistrationCount: 1,
  frozenEntryCount: 1,
  frozenRootHex: "44".repeat(32),
  shards: [
    {
      shardIndex: 0,
      finalizedEntryCount: 1,
      entriesRootHex: "55".repeat(32),
      addressRootHex: "66".repeat(32),
      finalizedEntries: [
        {
          commitmentHex: "77".repeat(32),
          payoutScriptPublicKeyHex: "000051",
          registrationTransactionId: "88".repeat(32),
          registeredAtDaa: 99n,
        },
      ],
      pendingEntry: null,
      excludedLateEntry: null,
      tipOutpoint: null,
    },
  ],
  winner: null,
};

describe("Giveaway V6 entropy prover client", () => {
  it("uses an idempotent public proof job and parses a ready result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ready",
          compactProofHex: "44".repeat(128),
          parentBlockHashHex: "99".repeat(32),
          parentBlueScore: "199",
          parentSequenceCommitmentHex: "aa".repeat(32),
          candidateBlockHashHex: "bb".repeat(32),
          candidateBlueScore: "200",
          candidateSequenceCommitmentHex: "cc".repeat(32),
        }),
        { status: 200 },
      ),
    );
    const client = createGiveawayV6EntropyProverClient({
      baseUrl: "http://giveaway-prover:3020",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.requestProof({ config, snapshot })).resolves.toMatchObject({
      status: "ready",
      compactProofHex: "44".repeat(128),
      entropy: { candidateBlueScore: 200n, parentBlueScore: 199n },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.jobKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(body).toMatchObject({
      giveawayIdHex: config.giveawayIdHex,
      entropyTargetBlueScore: "200",
      frozenEntryCount: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/private|seed|signature|passkey/i);
  });

  it("sends the same public proof job over a private Unix socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "giveaway-prover-"));
    const socketPath = join(directory, "prover.sock");
    const received: unknown[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "pending", retryAfterSeconds: 60 }));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      const client = createGiveawayV6EntropyProverSocketClient({ socketPath });
      await expect(client.requestProof({ config, snapshot })).resolves.toEqual({
        status: "pending",
        retryAfterSeconds: 60,
      });
      expect(received).toMatchObject([{
        giveawayIdHex: config.giveawayIdHex,
        frozenRootHex: snapshot.frozenRootHex,
        entropyTargetBlueScore: "200",
      }]);
      expect(JSON.stringify(received)).not.toMatch(/private|seed|signature|passkey/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
