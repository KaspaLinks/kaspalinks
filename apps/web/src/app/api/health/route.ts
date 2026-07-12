import { apiMethodNotAllowed } from "@/lib/errors";

export function GET() {
  return Response.json({
    commit: process.env.APP_COMMIT_SHA?.trim() || null,
    service: "kaspa-actions",
    status: "ok",
    version: "0.1.0",
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
