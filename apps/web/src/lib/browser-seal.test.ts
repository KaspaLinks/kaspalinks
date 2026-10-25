import { afterEach, describe, expect, it } from "vitest";

import { openSecret, sealSecret, setSealKeyProviderForTests } from "./browser-seal";

function testKey() {
  return crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
}

describe("browser seal", () => {
  afterEach(() => setSealKeyProviderForTests(null));

  it("round-trips a secret without leaving it readable", async () => {
    const key = await testKey();
    setSealKeyProviderForTests(async () => key);

    const sealed = await sealSecret("https://kaspalinks.com/claim/lab-1#c=secret-code");
    expect(sealed).toMatch(/^seal1\./u);
    expect(sealed).not.toContain("secret-code");
    expect(await openSecret(sealed!)).toBe("https://kaspalinks.com/claim/lab-1#c=secret-code");
  });

  it("refuses a value sealed with another key or changed afterwards", async () => {
    setSealKeyProviderForTests(testKey);
    const sealed = (await sealSecret("token"))!;

    setSealKeyProviderForTests(testKey);
    expect(await openSecret(sealed)).toBeNull();
    expect(await openSecret(`${sealed.slice(0, -2)}AA`)).toBeNull();
    expect(await openSecret("plain")).toBeNull();
  });

  it("stores nothing when the browser has no key", async () => {
    setSealKeyProviderForTests(async () => null);
    expect(await sealSecret("token")).toBeNull();
  });
});
