import { z } from "zod";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

const blockDagInfoSchema = z.object({
  networkName: z.string(),
  pastMedianTime: z.string(),
  virtualDaaScore: z.string().regex(/^[0-9]+$/),
});

export async function GET(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_DAG_INFO, ipHash);
  if (!limited.allowed) return limited.response;

  try {
    const response = await fetch("https://api.kaspa.org/info/blockdag", {
      headers: { accept: "application/json" },
      next: { revalidate: 5 },
    });

    if (!response.ok) {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        "Could not read current Kaspa BlockDAG info.",
        503,
      );
    }

    const parsed = blockDagInfoSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.networkName !== "kaspa-mainnet") {
      return apiError(ErrorCodes.SERVER_ERROR, "Unexpected Kaspa BlockDAG response.", 503);
    }

    return apiJson({
      network: "mainnet",
      pastMedianTime: parsed.data.pastMedianTime,
      virtualDaaScore: parsed.data.virtualDaaScore,
    });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Could not reach Kaspa BlockDAG info.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
