// Proves to the official MCP Registry that kaspalinks.com owns the
// `com.kaspalinks/*` namespace (HTTP verification). Only the public half of the
// Ed25519 key is published here; the private key never leaves the operator's machine.
// See docs/adr/0011 and server.json.

export const dynamic = "force-static";

const PROOF = "v=MCPv1; k=ed25519; p=N5B6hW5Xx8cdUxFICd2wBWHh8UgskR551sh04dwB4A4=";

export function GET() {
  return new Response(PROOF, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
