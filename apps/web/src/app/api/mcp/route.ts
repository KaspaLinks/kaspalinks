import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiMethodNotAllowed } from "@/lib/errors";
import { loadOpenGiveaways } from "@/lib/featured-giveaway";
import { handleMcpMessage, jsonRpcError, JsonRpcErrors } from "@/lib/mcp-server";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

// Model Context Protocol endpoint for AI assistants (Streamable HTTP, stateless,
// JSON responses only). No authentication: every tool only reads. See docs/adr/0011.

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 64_000;

function rpcReply(body: unknown, status: number): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" }, status });
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(
    RateBuckets.MCP_REQUEST,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limited.allowed) return limited.response;

  // Assistants call from their servers without an Origin. A browser page on
  // another site must not drive this endpoint (DNS rebinding, drive-by calls).
  const appUrl = getPublicAppBaseUrl(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== appUrl) {
    return rpcReply(jsonRpcError(null, JsonRpcErrors.INVALID_REQUEST, "Origin not allowed."), 403);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return rpcReply(jsonRpcError(null, JsonRpcErrors.INVALID_REQUEST, "Message too large."), 413);
  }

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return rpcReply(jsonRpcError(null, JsonRpcErrors.PARSE_ERROR, "Body must be JSON."), 400);
  }

  const reply = await handleMcpMessage(
    message,
    { appUrl, loadOpenGiveaways: (limit) => loadOpenGiveaways(limit) },
    {
      method: request.headers.get("mcp-method"),
      name: request.headers.get("mcp-name"),
      protocolVersion: request.headers.get("mcp-protocol-version"),
    },
  );
  if (!reply.body) return new Response(null, { status: reply.status });
  return rpcReply(reply.body, reply.status);
}

// No server-initiated stream and no sessions, so GET and DELETE are not offered.
const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
