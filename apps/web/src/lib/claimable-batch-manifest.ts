export type StoredClaimableBatchOutput = {
  amountSompi: string;
  linkKey: string;
  scriptPublicKeyHex: string;
};

export function parseStoredClaimableBatchOutputs(value: unknown): StoredClaimableBatchOutput[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) {
    throw new Error("Stored batch outputs are invalid.");
  }
  return value.map((output) => {
    if (typeof output !== "object" || output === null || Array.isArray(output)) {
      throw new Error("Stored batch output is invalid.");
    }
    const record = output as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(",") !== "amountSompi,linkKey,scriptPublicKeyHex") {
      throw new Error("Stored batch output is invalid.");
    }
    const amountSompi = record.amountSompi;
    const linkKey = record.linkKey;
    const scriptPublicKeyHex = record.scriptPublicKeyHex;
    if (
      typeof amountSompi !== "string" ||
      !/^[1-9][0-9]*$/.test(amountSompi) ||
      typeof linkKey !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(linkKey) ||
      typeof scriptPublicKeyHex !== "string" ||
      !/^[0-9a-f]+$/.test(scriptPublicKeyHex) ||
      scriptPublicKeyHex.length % 2 !== 0
    ) {
      throw new Error("Stored batch output is invalid.");
    }
    return output as StoredClaimableBatchOutput;
  });
}
