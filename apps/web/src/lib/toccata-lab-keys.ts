import { etc, getPublicKey, utils } from "@noble/secp256k1";

export type ToccataLabKeyPair = {
  privateKey: string;
  publicKey: string;
  xOnlyPublicKey: string;
};

export function createToccataLabKeyPair(): ToccataLabKeyPair {
  const privateKeyBytes = utils.randomSecretKey();
  return deriveToccataLabKeyPair(etc.bytesToHex(privateKeyBytes));
}

export function deriveToccataLabKeyPair(privateKey: string): ToccataLabKeyPair {
  const normalized = privateKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Claim code must be a 32-byte private key.");
  }

  const privateKeyBytes = etc.hexToBytes(normalized);
  const publicKeyBytes = getPublicKey(privateKeyBytes, true);

  return {
    privateKey: normalized,
    publicKey: etc.bytesToHex(publicKeyBytes),
    xOnlyPublicKey: etc.bytesToHex(publicKeyBytes.slice(1)),
  };
}
