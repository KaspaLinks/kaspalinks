import { describe, expect, it } from "vitest";

import {
  normalizeBlockHeadersRequest,
  normalizeVirtualChainRequest,
  stringifyRelayJson,
} from "./protocol.mjs";

describe("wRPC relay read protocol", () => {
  it("accepts only bounded Full VSPC requests", () => {
    expect(
      normalizeVirtualChainRequest({
        startHash: "AB".repeat(32),
        dataVerbosityLevel: "Full",
        minConfirmationCount: 10,
      }),
    ).toEqual({
      startHash: "ab".repeat(32),
      dataVerbosityLevel: "Full",
      minConfirmationCount: 10,
    });

    expect(() =>
      normalizeVirtualChainRequest({
        startHash: "ab".repeat(32),
        dataVerbosityLevel: "Full",
        minConfirmationCount: 10,
        privateKey: "never",
      }),
    ).toThrow(/unknown field/u);
    expect(() =>
      normalizeVirtualChainRequest({
        startHash: "ab".repeat(32),
        dataVerbosityLevel: "Compact",
        minConfirmationCount: 10,
      }),
    ).toThrow(/Full verbosity/u);
  });

  it("serializes RPC uint64 values as decimal strings", () => {
    expect(stringifyRelayJson({ daaScore: 500_000_000n })).toBe('{"daaScore":"500000000"}');
  });

  it("accepts only a small unique set of block hashes", () => {
    expect(normalizeBlockHeadersRequest({ hashes: ["AB".repeat(32)] })).toEqual({
      hashes: ["ab".repeat(32)],
    });
    expect(() =>
      normalizeBlockHeadersRequest({ hashes: ["ab".repeat(32), "AB".repeat(32)] }),
    ).toThrow(/duplicate/u);
    expect(() => normalizeBlockHeadersRequest({ hashes: [] })).toThrow(/one through eight/u);
    expect(() =>
      normalizeBlockHeadersRequest({ hashes: ["ab".repeat(32)], includeTransactions: true }),
    ).toThrow(/unknown field/u);
  });
});
