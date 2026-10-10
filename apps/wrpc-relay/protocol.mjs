export function normalizeVirtualChainRequest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("VSPC request must be a JSON object.");
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => !["startHash", "dataVerbosityLevel", "minConfirmationCount"].includes(key))
  ) {
    throw new Error("VSPC request contains an unknown field.");
  }
  if (typeof value.startHash !== "string" || !/^[0-9a-fA-F]{64}$/.test(value.startHash)) {
    throw new Error("startHash must be a 32-byte transaction id.");
  }
  if (value.dataVerbosityLevel !== "Full") {
    throw new Error("VSPC request must use Full verbosity.");
  }
  const minConfirmationCount = value.minConfirmationCount;
  if (
    !Number.isSafeInteger(minConfirmationCount) ||
    minConfirmationCount < 1 ||
    minConfirmationCount > 100_000
  ) {
    throw new Error("VSPC confirmation count must be an integer from 1 through 100000.");
  }
  return {
    startHash: value.startHash.toLowerCase(),
    dataVerbosityLevel: "Full",
    minConfirmationCount,
  };
}

export function stringifyRelayJson(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}
