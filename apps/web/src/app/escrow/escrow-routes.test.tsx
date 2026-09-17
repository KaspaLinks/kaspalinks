import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/escrow",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

Object.assign(globalThis, { React });

describe("escrow route smoke rendering", () => {
  afterEach(() => {
    delete process.env.ESCROW_LINKS_PROTOTYPE_ENABLED;
  });

  it("renders nothing escrow-related before the access check has passed", async () => {
    const { default: EscrowPage } = await import("./page");
    const markup = renderToStaticMarkup(<EscrowPage />);

    expect(markup).toContain("Loading...");
    expect(markup.toLowerCase()).not.toContain("escrow link");
    expect(markup).not.toContain("Buy &amp; sell");
  });

  it("renders the overview with the prototype notice and non-custodial promise", async () => {
    const { EscrowOverview } = await import("./EscrowOverview");
    const markup = renderToStaticMarkup(<EscrowOverview />);

    expect(markup).toContain("Buy &amp; sell with Kaspa escrow.");
    expect(markup).toContain("Nothing here sends KAS");
    expect(markup).toContain("KaspaLinks never holds your KAS or keys");
    expect(markup).toContain('href="/escrow/new"');
  });

  it("renders client placeholders for the create and deal routes", async () => {
    const [{ default: NewEscrowPage }, { default: EscrowDealPage }] = await Promise.all([
      import("./new/page"),
      import("./[id]/page"),
    ]);

    expect(renderToStaticMarkup(<NewEscrowPage />)).toContain("Loading...");
    const deal = await EscrowDealPage({ params: Promise.resolve({ id: "smartphone-pro" }) });
    expect(renderToStaticMarkup(deal)).toContain("Loading...");
  });

  it("returns not found for unknown deals", async () => {
    const { default: EscrowDealPage } = await import("./[id]/page");
    await expect(EscrowDealPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("hides every escrow route when the prototype flag is off", async () => {
    const { default: EscrowLayout } = await import("./layout");

    expect(renderToStaticMarkup(<EscrowLayout>ok</EscrowLayout>)).toBe("ok");
    process.env.ESCROW_LINKS_PROTOTYPE_ENABLED = "false";
    expect(() => EscrowLayout({ children: "ok" })).toThrow("NEXT_NOT_FOUND");
  });
});

describe("escrow trust copy", () => {
  const escrowDir = fileURLToPath(new URL(".", import.meta.url));

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  // KaspaLinks never holds escrowed KAS and never asks for wallet secrets.
  const FORBIDDEN = [
    /held by kaspa ?links/i,
    /kaspa ?links wallet/i,
    /(?:deposit|send|pay) (?:money|funds|kas) (?:in)?to kaspa ?links/i,
    /(?:enter|paste|share|provide) your (?:seed phrase|private key|recovery words)/i,
    /escrow protected/i,
    /buyer protection/i,
  ];

  it("never claims custody or asks for wallet secrets", () => {
    const files = sourceFiles(escrowDir);
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect({ file, match: source.match(pattern)?.[0] ?? null }).toEqual({ file, match: null });
      }
    }
  });
});
