import { prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { listClaimableFundingUtxos } from "@/lib/claimable-onchain";
import { buildClaimableReturnFile } from "@/lib/claimable-return-file";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

// The prepared return of a funded v2 link as a downloadable file. Public like
// "Return now": it holds no secret and can only pay the committed return address.

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ linkKey: string }> };

const linkKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export async function GET(request: Request, context: RouteContext) {
  if (!isToccataLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Claimable links are disabled.", 403);
  }

  const limited = enforceRateLimit(
    RateBuckets.CLAIMABLE_RETURN_FILE,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limited.allowed) return limited.response;

  const parsedKey = linkKeySchema.safeParse((await context.params).linkKey);
  if (!parsedKey.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Claimable link key is invalid.", 400);
  }

  const link = await prisma.claimableLink.findUnique({ where: { linkKey: parsedKey.data } });
  let funded = link;
  // Links without an account never store their funding output: find the
  // payment of the exact link amount on-chain, as the return worker does.
  if (link && link.scriptVersion === 2 && link.fundingTxId === null) {
    let utxos;
    try {
      utxos = await listClaimableFundingUtxos(link.fundingAddress);
    } catch {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        "The payment could not be looked up right now. Try again in a minute.",
        502,
      );
    }
    const payment = utxos.find((utxo) => utxo.amountSompi === link.amountSompi);
    funded = payment
      ? { ...link, fundingOutputIndex: payment.outputIndex, fundingTxId: payment.transactionId }
      : link;
  }
  const file = funded ? buildClaimableReturnFile(funded) : null;
  if (!file) {
    return apiError(
      ErrorCodes.NOT_FOUND,
      "No return file yet: it exists once an auto-return link's payment is detected.",
      404,
    );
  }
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="kaspa-links-return-${file.linkKey}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
