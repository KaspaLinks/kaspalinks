import { describe, expect, it, vi } from "vitest";

import {
  connectKaswareWallet,
  disconnectKaswareWallet,
  getKaswareProvider,
  inspectKaswareProviderCapabilities,
  normalizeKaswareBalance,
  normalizeKaswareNetwork,
  onKaswareEvent,
  sendKaspaPayment,
  signKaswarePsktProbe,
  WalletAdapterError,
  type KaswareEventHandler,
  type KaswareEventName,
  type KaswareProvider,
} from "./index";

describe("KasWare wallet adapter", () => {
  it("detects an injected KasWare provider without touching wallet permissions", () => {
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
    };

    expect(getKaswareProvider({ kasware: provider })).toBe(provider);
    expect(getKaswareProvider({})).toBeNull();
    expect(getKaswareProvider({ kasware: {} })).toBeNull();
  });

  it("detects KasWare PSKT signing capabilities without invoking the wallet", () => {
    const signPskt = vi.fn();
    const provider: KaswareProvider = {
      getNetwork: vi.fn(),
      requestAccounts: vi.fn(),
      sendKaspa: vi.fn(),
      signPskt,
    };

    const capabilities = inspectKaswareProviderCapabilities(provider);

    expect(capabilities).toMatchObject({
      canRequestAccounts: true,
      canSendKaspa: true,
      canSignPskt: true,
      installed: true,
      preferredPsktMethod: "signPskt",
    });
    expect(capabilities.availableFunctionNames).toContain("signPskt");
    expect(capabilities.methods).toContainEqual({
      available: true,
      kind: "pskt",
      method: "signPskt",
    });
    expect(signPskt).not.toHaveBeenCalled();
  });

  it("normalizes documented KasWare network names conservatively", () => {
    expect(normalizeKaswareNetwork("livenet")).toBe("mainnet");
    expect(normalizeKaswareNetwork("mainnet")).toBe("mainnet");
    expect(normalizeKaswareNetwork("kaspa")).toBe("mainnet");
    expect(normalizeKaswareNetwork("kaspa_mainnet")).toBe("mainnet");
    expect(normalizeKaswareNetwork("Kaspa Mainnet")).toBe("mainnet");
    expect(normalizeKaswareNetwork("testnet")).toBe("testnet");
    expect(normalizeKaswareNetwork("kaspatest")).toBe("testnet");
    expect(normalizeKaswareNetwork("kaspa_testnet_10")).toBe("testnet");
    expect(normalizeKaswareNetwork("kaspa_testnet_11")).toBe("testnet");
    expect(normalizeKaswareNetwork("devnet")).toBe("devnet");
    expect(normalizeKaswareNetwork("kaspa_devnet")).toBe("devnet");
    expect(normalizeKaswareNetwork(0)).toBe("unknown");
    expect(normalizeKaswareNetwork("")).toBe("unknown");
    expect(normalizeKaswareNetwork("foobar")).toBe("unknown");
  });

  it("normalizes sompi balances to strings", () => {
    expect(normalizeKaswareBalance({ confirmed: 1, total: "3", unconfirmed: 2 })).toEqual({
      confirmed: "1",
      total: "3",
      unconfirmed: "2",
    });
    expect(normalizeKaswareBalance({ confirmed: -1, total: "3", unconfirmed: 2 })).toBeNull();
    expect(normalizeKaswareBalance({ confirmed: 1.5, total: "3", unconfirmed: 2 })).toBeNull();
  });

  it("connects only through a user-triggered requestAccounts call", async () => {
    const provider: KaswareProvider = {
      getBalance: vi.fn(async () => ({ confirmed: 100, total: 120, unconfirmed: 20 })),
      getNetwork: vi.fn(async () => "testnet"),
      requestAccounts: vi.fn(async () => [
        "  kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz  ",
        "invalid whitespace value",
      ]),
    };

    await expect(connectKaswareWallet(provider)).resolves.toEqual({
      accounts: ["kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz"],
      balance: { confirmed: "100", total: "120", unconfirmed: "20" },
      network: "testnet",
      provider: "kasware",
    });
    expect(provider.requestAccounts).toHaveBeenCalledTimes(1);
  });

  it("disconnects best-effort and reports whether the provider supported it", async () => {
    const supportsDisconnect: KaswareProvider = {
      disconnect: vi.fn(async () => undefined),
      requestAccounts: vi.fn(),
    };
    await expect(
      disconnectKaswareWallet(supportsDisconnect, "https://example.com"),
    ).resolves.toEqual({
      providerDisconnected: true,
    });
    expect(supportsDisconnect.disconnect).toHaveBeenCalledWith("https://example.com");

    const noDisconnect: KaswareProvider = { requestAccounts: vi.fn() };
    await expect(disconnectKaswareWallet(noDisconnect)).resolves.toEqual({
      providerDisconnected: false,
    });

    const throwingProvider: KaswareProvider = {
      disconnect: vi.fn(async () => {
        throw new Error("already revoked");
      }),
      requestAccounts: vi.fn(),
    };
    await expect(disconnectKaswareWallet(throwingProvider)).resolves.toEqual({
      providerDisconnected: false,
    });
  });

  it("throws a typed error when requestAccounts is unavailable", async () => {
    await expect(connectKaswareWallet({ getAccounts: vi.fn() })).rejects.toMatchObject({
      code: "KASWARE_UNAVAILABLE",
      name: "WalletAdapterError",
    } satisfies Partial<WalletAdapterError>);
  });

  it("forwards send-kaspa intents to KasWare and returns the txId", async () => {
    const sendKaspa = vi.fn(async () => "abc123def456");
    const provider: KaswareProvider = { requestAccounts: vi.fn(), sendKaspa };

    const result = await sendKaspaPayment(provider, {
      amountSompi: 1_000_000_000n,
      toAddress: "kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l",
    });

    expect(result).toEqual({ txId: "abc123def456" });
    expect(sendKaspa).toHaveBeenCalledWith(
      "kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l",
      1_000_000_000,
    );
  });

  it("accepts wrapped { txId } responses from the wallet bridge", async () => {
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
      sendKaspa: vi.fn(async () => ({ txId: "deadbeef" })),
    };

    await expect(
      sendKaspaPayment(provider, {
        amountSompi: 5n,
        toAddress: "kaspa:short",
      }),
    ).resolves.toEqual({ txId: "deadbeef" });
  });

  it("rejects unsafe amounts before talking to the wallet", async () => {
    const sendKaspa = vi.fn();
    const provider: KaswareProvider = { requestAccounts: vi.fn(), sendKaspa };

    await expect(
      sendKaspaPayment(provider, { amountSompi: 0n, toAddress: "kaspa:foo" }),
    ).rejects.toMatchObject({ code: "KASWARE_INVALID_AMOUNT" });

    await expect(
      sendKaspaPayment(provider, {
        amountSompi: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        toAddress: "kaspa:foo",
      }),
    ).rejects.toMatchObject({ code: "KASWARE_AMOUNT_TOO_LARGE" });

    expect(sendKaspa).not.toHaveBeenCalled();
  });

  it("propagates user rejections as typed errors without revealing internals", async () => {
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
      sendKaspa: vi.fn(async () => {
        throw new Error("User rejected");
      }),
    };

    await expect(
      sendKaspaPayment(provider, {
        amountSompi: 1_000_000n,
        toAddress: "kaspa:abc",
      }),
    ).rejects.toMatchObject({
      code: "KASWARE_SEND_REJECTED",
      name: "WalletAdapterError",
    });
  });

  it("allows on-chain detection when KasWare resolves without a transaction id", async () => {
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
      sendKaspa: vi.fn(async () => ({ foo: "bar" })),
    };

    await expect(
      sendKaspaPayment(provider, {
        amountSompi: 1_000_000n,
        toAddress: "kaspa:abc",
      }),
    ).resolves.toEqual({ txId: null });
  });

  it("refuses to even talk to a wallet that lacks sendKaspa", async () => {
    await expect(
      sendKaspaPayment({ requestAccounts: vi.fn() }, { amountSompi: 1n, toAddress: "kaspa:foo" }),
    ).rejects.toMatchObject({ code: "KASWARE_SEND_UNAVAILABLE" });
  });

  it("forwards a lab wallet transaction probe to KasWare signPskt only after explicit invocation", async () => {
    const signPskt = vi.fn(async () => ({ signedPskt: "signed-json" }));
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
      signPskt,
    };

    const result = await signKaswarePsktProbe(provider, {
      txJsonString: '{ "version": 0, "inputs": [], "outputs": [] }',
    });

    expect(signPskt).toHaveBeenCalledWith({
      options: { signInputs: [] },
      txJsonString: '{ "version": 0, "inputs": [], "outputs": [] }',
    });
    expect(result).toEqual({
      method: "signPskt",
      resultSummary: "object keys: signedPskt",
      resultType: "object",
    });
  });

  it("rejects PSKT probes when the wallet has no PSKT signing method", async () => {
    await expect(
      signKaswarePsktProbe({ requestAccounts: vi.fn() }, { txJsonString: "{}" }),
    ).rejects.toMatchObject({
      code: "KASWARE_PSKT_SIGN_UNAVAILABLE",
      name: "WalletAdapterError",
    });
  });

  it("wraps KasWare PSKT signing failures without leaking wallet internals", async () => {
    const provider: KaswareProvider = {
      requestAccounts: vi.fn(),
      signPskt: vi.fn(async () => {
        throw new Error("wallet internal decode details");
      }),
    };

    await expect(signKaswarePsktProbe(provider, { txJsonString: "{}" })).rejects.toMatchObject({
      code: "KASWARE_PSKT_SIGN_REJECTED",
      name: "WalletAdapterError",
    });
  });

  it("subscribes to provider events and removes listeners when possible", () => {
    const on = vi.fn((eventName: KaswareEventName, handler: KaswareEventHandler) => {
      expect(eventName).toBe("accountsChanged");
      expect(handler).toBeTypeOf("function");
    });
    const removeListener = vi.fn();
    const cleanup = onKaswareEvent({ on, removeListener }, "accountsChanged", vi.fn());

    cleanup();

    expect(on).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
