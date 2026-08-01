import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { readResilientMainnetDagInfo } from "@/lib/mainnet-dag-info";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

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
    const dagInfo = await readResilientMainnetDagInfo();
    return apiJson({
      network: "mainnet",
      pastMedianTime: dagInfo.pastMedianTime,
      virtualDaaScore: dagInfo.virtualDaaScore,
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
