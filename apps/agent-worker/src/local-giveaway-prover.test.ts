import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalGiveawayProverServer,
  parseLocalProofRequest,
  type LocalProofReady,
  type LocalProofRequest,
} from "./local-giveaway-prover";

const servers: ReturnType<typeof createLocalGiveawayProverServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function request(target = "123456"): LocalProofRequest {
  const publicCommitment = { entropyTargetBlueScore: target };
  return {
    ...publicCommitment,
    jobKey: createHash("sha256").update(JSON.stringify(publicCommitment)).digest("hex"),
  };
}

const ready: LocalProofReady = {
  status: "ready",
  compactProofHex: "aa".repeat(128),
  parentBlockHashHex: "55".repeat(32),
  parentBlueScore: "123455",
  parentSequenceCommitmentHex: "66".repeat(32),
  candidateBlockHashHex: "77".repeat(32),
  candidateBlueScore: "123456",
  candidateSequenceCommitmentHex: "88".repeat(32),
};

async function listen(server: ReturnType<typeof createLocalGiveawayProverServer>): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/prove`;
}

describe("local Giveaway V6 prover", () => {
  it("rejects a changed public job commitment", () => {
    const input = request();
    expect(parseLocalProofRequest(input)).toEqual(input);
    expect(() => parseLocalProofRequest({ ...input, entropyTargetBlueScore: "123457" })).toThrow();
  });

  it("refuses the old per-Giveaway job fields", () => {
    expect(() =>
      parseLocalProofRequest({ ...request(), giveawayIdHex: "11".repeat(32) }),
    ).toThrow();
  });

  it("gives every target its own job and one job to a whole slot", () => {
    expect(request("123456").jobKey).toBe(request("123456").jobKey);
    expect(request("123456").jobKey).not.toBe(request("123457").jobKey);
  });

  it("starts one proof job, returns pending, then reuses the verified result", async () => {
    let resolveJob!: (value: LocalProofReady) => void;
    const runner = vi.fn(() => new Promise<LocalProofReady>((resolve) => { resolveJob = resolve; }));
    const url = await listen(createLocalGiveawayProverServer(runner));
    const body = JSON.stringify(request());

    const first = await fetch(url, { method: "POST", body });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "pending", retryAfterSeconds: 60 });
    const duplicate = await fetch(url, { method: "POST", body });
    expect(duplicate.status).toBe(202);
    expect(runner).toHaveBeenCalledTimes(1);

    resolveJob(ready);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await fetch(url, { method: "POST", body });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(ready);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("returns the shared error shape for invalid requests", async () => {
    const runner = vi.fn();
    const url = await listen(createLocalGiveawayProverServer(runner));
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ ...request(), jobKey: "00".repeat(32) }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid public proof job." },
    });
    expect(runner).not.toHaveBeenCalled();
  });
});
