export const KASWARE_EVENT_NAMES = ["accountsChanged", "balanceChanged", "networkChanged"] as const;

export type KaspaWalletNetwork = "devnet" | "mainnet" | "testnet" | "unknown";
export type KaswareEventName = (typeof KASWARE_EVENT_NAMES)[number];
export type KaswareEventHandler = (payload: unknown) => void;

export type KaswareBalance = {
  confirmed: string;
  total: string;
  unconfirmed: string;
};

export type KaswareProvider = {
  disconnect?: (origin?: string) => Promise<unknown>;
  getAccounts?: () => Promise<unknown>;
  getBalance?: () => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
  on?: (eventName: KaswareEventName, handler: KaswareEventHandler) => void;
  removeListener?: (eventName: KaswareEventName, handler: KaswareEventHandler) => void;
  requestAccounts?: () => Promise<unknown>;
  sendKaspa?: (toAddress: string, sompi: number, options?: unknown) => Promise<unknown>;
  signPSKT?: KaswareSignPsktMethod;
  signPskt?: KaswareSignPsktMethod;
};

export type KaswareWalletConnection = {
  accounts: string[];
  balance: KaswareBalance | null;
  network: KaspaWalletNetwork;
  provider: "kasware";
};

export class WalletAdapterError extends Error {
  readonly code: string;

  constructor(message: string, options: { code: string }) {
    super(message);
    this.name = "WalletAdapterError";
    this.code = options.code;
  }
}

export function getKaswareProvider(target: unknown = globalThis): KaswareProvider | null {
  if (!isRecord(target)) {
    return null;
  }

  const provider = target.kasware;

  return isKaswareProvider(provider) ? provider : null;
}

export function isKaswareInstalled(target: unknown = globalThis): boolean {
  return getKaswareProvider(target) !== null;
}

export async function connectKaswareWallet(
  provider: KaswareProvider,
): Promise<KaswareWalletConnection> {
  if (typeof provider.requestAccounts !== "function") {
    throw new WalletAdapterError("KasWare requestAccounts is not available.", {
      code: "KASWARE_UNAVAILABLE",
    });
  }

  const accounts = normalizeAccounts(await provider.requestAccounts());

  return {
    accounts,
    balance: await readKaswareBalance(provider),
    network: await readKaswareNetwork(provider),
    provider: "kasware",
  };
}

export type SendKaspaPaymentInput = {
  amountSompi: bigint;
  toAddress: string;
};

export type SendKaspaPaymentResult = {
  txId: null | string;
};

export type KaswareSignPsktInput = {
  txJsonString: string;
  options?: {
    signInputs: Array<{
      index: number;
      sighashType?: number | string;
    }>;
  };
};

export type KaswareSignPsktMethod = (input: KaswareSignPsktInput) => Promise<unknown>;

export type KaswareWalletCapabilityKind = "account" | "network" | "payment" | "pskt" | "utility";

export type KaswareWalletCapability = {
  available: boolean;
  kind: KaswareWalletCapabilityKind;
  method: string;
};

export type KaswareWalletCapabilities = {
  availableFunctionNames: string[];
  canRequestAccounts: boolean;
  canSendKaspa: boolean;
  canSignPskt: boolean;
  installed: boolean;
  methods: KaswareWalletCapability[];
  preferredPsktMethod: null | "signPSKT" | "signPskt";
};

export type SignKaswarePsktProbeInput = {
  signInputs?: NonNullable<KaswareSignPsktInput["options"]>["signInputs"];
  txJsonString: string;
};

export type SignKaswarePsktProbeResult = {
  method: "signPSKT" | "signPskt";
  resultSummary: string;
  resultType: string;
};

const MAX_SAFE_SOMPI = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PSKT_JSON_LENGTH = 250_000;

const KASWARE_CAPABILITY_METHODS = [
  { kind: "account", method: "requestAccounts" },
  { kind: "account", method: "getAccounts" },
  { kind: "network", method: "getNetwork" },
  { kind: "utility", method: "getBalance" },
  { kind: "payment", method: "sendKaspa" },
  { kind: "pskt", method: "signPskt" },
  { kind: "pskt", method: "signPSKT" },
  { kind: "utility", method: "disconnect" },
] as const satisfies ReadonlyArray<{
  kind: KaswareWalletCapabilityKind;
  method: string;
}>;

/**
 * Forwards a payment intent to the connected KasWare wallet. The adapter never
 * touches private keys or seed phrases: KasWare displays its own confirmation
 * dialog, the user approves, and KasWare signs and broadcasts. Wallet versions
 * do not always return the resulting transaction id, so callers must also rely
 * on their on-chain detector. Throws a typed `WalletAdapterError` on missing
 * support, unsafe amounts, or user rejection.
 */
export async function sendKaspaPayment(
  provider: KaswareProvider,
  input: SendKaspaPaymentInput,
): Promise<SendKaspaPaymentResult> {
  if (typeof provider.sendKaspa !== "function") {
    throw new WalletAdapterError("KasWare sendKaspa is not available.", {
      code: "KASWARE_SEND_UNAVAILABLE",
    });
  }

  const recipient = input.toAddress.trim();
  if (recipient.length === 0 || /\s/.test(recipient)) {
    throw new WalletAdapterError("Recipient address is required.", {
      code: "KASWARE_INVALID_RECIPIENT",
    });
  }

  if (input.amountSompi <= 0n) {
    throw new WalletAdapterError("Amount must be greater than zero sompi.", {
      code: "KASWARE_INVALID_AMOUNT",
    });
  }

  if (input.amountSompi > MAX_SAFE_SOMPI) {
    throw new WalletAdapterError("Amount exceeds the wallet bridge's safe integer range.", {
      code: "KASWARE_AMOUNT_TOO_LARGE",
    });
  }

  let raw: unknown;
  try {
    raw = await provider.sendKaspa(recipient, Number(input.amountSompi));
  } catch {
    throw new WalletAdapterError("KasWare send was rejected or failed.", {
      code: "KASWARE_SEND_REJECTED",
    });
  }

  const txId = extractTxId(raw);
  return { txId };
}

export function inspectKaswareProviderCapabilities(
  provider: KaswareProvider | null,
): KaswareWalletCapabilities {
  const availableFunctionNames = provider ? collectProviderFunctionNames(provider) : [];
  const availableNameSet = new Set(availableFunctionNames);
  const methods = KASWARE_CAPABILITY_METHODS.map(({ kind, method }) => ({
    available: availableNameSet.has(method),
    kind,
    method,
  }));
  const preferredPsktMethod = pickKaswarePsktMethod(provider);

  return {
    availableFunctionNames,
    canRequestAccounts: availableNameSet.has("requestAccounts"),
    canSendKaspa: availableNameSet.has("sendKaspa"),
    canSignPskt: preferredPsktMethod !== null,
    installed: provider !== null,
    methods,
    preferredPsktMethod,
  };
}

/**
 * Lab-only bridge for KasWare's documented `signPskt` page-provider method.
 * Despite the method name, current KasWare builds expect a
 * Transaction.serializeToSafeJSON()-compatible transaction JSON string. The
 * adapter never signs by itself and never broadcasts; it only forwards a
 * caller-provided wallet transaction JSON string after an explicit user action.
 */
export async function signKaswarePsktProbe(
  provider: KaswareProvider,
  input: SignKaswarePsktProbeInput,
): Promise<SignKaswarePsktProbeResult> {
  const method = pickKaswarePsktMethod(provider);
  if (method === null) {
    throw new WalletAdapterError("KasWare signPskt is not available.", {
      code: "KASWARE_PSKT_SIGN_UNAVAILABLE",
    });
  }

  const txJsonString = input.txJsonString.trim();
  if (txJsonString.length === 0) {
    throw new WalletAdapterError("Wallet transaction JSON is required.", {
      code: "KASWARE_PSKT_EMPTY",
    });
  }

  if (txJsonString.length > MAX_PSKT_JSON_LENGTH) {
    throw new WalletAdapterError("Wallet transaction JSON exceeds the lab size limit.", {
      code: "KASWARE_PSKT_TOO_LARGE",
    });
  }

  let raw: unknown;
  try {
    raw = await provider[method]?.({
      options: {
        signInputs: input.signInputs ?? [],
      },
      txJsonString,
    });
  } catch {
    throw new WalletAdapterError("KasWare signPskt was rejected or failed.", {
      code: "KASWARE_PSKT_SIGN_REJECTED",
    });
  }

  return {
    method,
    resultSummary: summarizeWalletResult(raw),
    resultType: describeResultType(raw),
  };
}

function extractTxId(value: unknown): null | string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^[0-9a-f]{1,128}$/i.test(trimmed) ? trimmed : null;
  }
  if (isRecord(value)) {
    for (const key of ["txId", "txid", "transactionId", "transaction_id", "id"] as const) {
      const candidate = value[key];
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (/^[0-9a-f]{1,128}$/i.test(trimmed)) return trimmed;
      }
    }
  }
  return null;
}

function pickKaswarePsktMethod(provider: KaswareProvider | null): null | "signPSKT" | "signPskt" {
  if (!provider) {
    return null;
  }

  if (typeof provider.signPskt === "function") {
    return "signPskt";
  }

  if (typeof provider.signPSKT === "function") {
    return "signPSKT";
  }

  return null;
}

export type DisconnectKaswareResult = {
  /** True when the provider exposes a disconnect() method we could call. */
  providerDisconnected: boolean;
};

/**
 * Best-effort wallet disconnect. This never signs or broadcasts anything. If
 * the provider exposes `disconnect()` (newer KasWare
 * builds), we call it; otherwise we report that the caller must reset local
 * state manually. Errors are swallowed because some builds reject the call
 * after the site permission was already revoked.
 */
export async function disconnectKaswareWallet(
  provider: KaswareProvider,
  origin?: string,
): Promise<DisconnectKaswareResult> {
  if (typeof provider.disconnect !== "function") {
    return { providerDisconnected: false };
  }

  try {
    await provider.disconnect(origin);
    return { providerDisconnected: true };
  } catch {
    return { providerDisconnected: false };
  }
}

export async function readKaswareAccounts(provider: KaswareProvider): Promise<string[]> {
  if (typeof provider.getAccounts !== "function") {
    return [];
  }

  return normalizeAccounts(await provider.getAccounts());
}

export async function readKaswareNetwork(provider: KaswareProvider): Promise<KaspaWalletNetwork> {
  if (typeof provider.getNetwork !== "function") {
    return "unknown";
  }

  return normalizeKaswareNetwork(await provider.getNetwork());
}

export async function readKaswareBalance(
  provider: KaswareProvider,
): Promise<KaswareBalance | null> {
  if (typeof provider.getBalance !== "function") {
    return null;
  }

  return normalizeKaswareBalance(await provider.getBalance());
}

export function normalizeKaswareNetwork(value: unknown): KaspaWalletNetwork {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");

  if (
    normalized.startsWith("kaspa_mainnet") ||
    normalized === "kaspa" ||
    normalized === "mainnet" ||
    normalized === "livenet"
  ) {
    return "mainnet";
  }

  if (
    normalized.startsWith("kaspa_testnet") ||
    normalized === "kaspatest" ||
    normalized === "testnet"
  ) {
    return "testnet";
  }

  if (normalized.startsWith("kaspa_devnet") || normalized === "devnet") {
    return "devnet";
  }

  return "unknown";
}

export function normalizeKaswareBalance(value: unknown): KaswareBalance | null {
  if (!isRecord(value)) {
    return null;
  }

  const confirmed = normalizeSompiValue(value.confirmed);
  const total = normalizeSompiValue(value.total);
  const unconfirmed = normalizeSompiValue(value.unconfirmed);

  if (confirmed === null || total === null || unconfirmed === null) {
    return null;
  }

  return { confirmed, total, unconfirmed };
}

export function onKaswareEvent(
  provider: KaswareProvider,
  eventName: KaswareEventName,
  handler: KaswareEventHandler,
): () => void {
  if (typeof provider.on !== "function") {
    return () => {};
  }

  provider.on(eventName, handler);

  return () => {
    if (typeof provider.removeListener === "function") {
      provider.removeListener(eventName, handler);
    }
  };
}

function isKaswareProvider(value: unknown): value is KaswareProvider {
  return (
    isRecord(value) &&
    (typeof value.requestAccounts === "function" ||
      typeof value.getAccounts === "function" ||
      typeof value.getNetwork === "function" ||
      typeof value.signPskt === "function" ||
      typeof value.signPSKT === "function")
  );
}

function collectProviderFunctionNames(provider: KaswareProvider): string[] {
  const names = new Set<string>();
  let current: unknown = provider;
  let depth = 0;

  while (isRecord(current) && depth < 5) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
        names.add(name);
      }
    }

    current = Object.getPrototypeOf(current);
    depth += 1;
  }

  for (const { method } of KASWARE_CAPABILITY_METHODS) {
    if (typeof (provider as Record<string, unknown>)[method] === "function") {
      names.add(method);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function normalizeAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !/\s/.test(item));
}

function normalizeSompiValue(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeResultType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function summarizeWalletResult(value: unknown): string {
  if (typeof value === "string") {
    return value.length <= 180 ? value : `${value.slice(0, 179)}…`;
  }

  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).slice(0, 12);
    return keys.length > 0 ? `object keys: ${keys.join(", ")}` : "object";
  }

  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return String(value);
}
