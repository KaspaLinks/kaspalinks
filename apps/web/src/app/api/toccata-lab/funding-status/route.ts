import { createRestKaspaIndexer, KaspaIndexerError } from "@kaspa-actions/kaspa-indexer";
import { prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  isToccataLabEnabled,
  toccataFundingStatusInputSchema,
} from "@/lib/toccata-lab";

const KASPA_REST_BASE_URL = "https://api.kaspa.org";
const UTXO_REQUEST_TIMEOUT_MS = 7_000;
const RECENT_FUNDING_SPENT_GRACE_MS = 10_000;

export async function POST(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_FUNDING_STATUS, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataFundingStatusInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid funding status request.",
      400,
    );
  }

  try {
    const registeredLink = parsed.data.linkKey
      ? await prisma.claimableLink.findUnique({
          select: { amountSompi: true, fundingAddress: true, status: true },
          where: { linkKey: parsed.data.linkKey },
        })
      : null;
    if (
      registeredLink &&
      (registeredLink.amountSompi.toString() !== parsed.data.amountSompi ||
        registeredLink.fundingAddress !== parsed.data.fundingAddress)
    ) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Funding request does not match the registered claimable link.",
        400,
      );
    }

    const indexer = createRestKaspaIndexer({
      cacheRevalidateSeconds: 3,
      limit: 20,
    });
    const amountSompi = BigInt(parsed.data.amountSompi);
    const match =
      parsed.data.fundingTransactionId && parsed.data.fundingOutputIndex !== undefined
        ? await indexer.findTransactionPayment({
            amountSompi,
            notBefore: parsed.data.notBefore,
            recipientAddress: parsed.data.fundingAddress,
            transactionId: parsed.data.fundingTransactionId,
          })
        : await indexer.findIncomingPayment({
            amountSompi,
            notBefore: parsed.data.notBefore,
            recipientAddress: parsed.data.fundingAddress,
            scanLimit: 20,
          });
    const verifiedMatch =
      match !== null &&
      (parsed.data.fundingOutputIndex === undefined ||
        match.outputIndex === parsed.data.fundingOutputIndex)
        ? match
        : null;
    const spent =
      verifiedMatch === null
        ? false
        : await isFundingOutputSpent({
            amountSompi: verifiedMatch.matchedSompi,
            blockTime: verifiedMatch.blockTime,
            fundingAddress: parsed.data.fundingAddress,
            outputIndex: verifiedMatch.outputIndex,
            transactionId: verifiedMatch.transactionId,
          });

    return apiJson({
      funded: verifiedMatch !== null,
      outputStatus: verifiedMatch === null ? "unfunded" : spent ? "spent" : "funded_unspent",
      spent,
      registeredStatus: registeredLink?.status ?? null,
      match:
        verifiedMatch === null
          ? null
          : {
              amountSompi: verifiedMatch.matchedSompi.toString(),
              blockTime: verifiedMatch.blockTime,
              outputIndex: verifiedMatch.outputIndex,
              transactionId: verifiedMatch.transactionId,
            },
    });
  } catch (error) {
    if (error instanceof KaspaIndexerError) {
      return apiError(ErrorCodes.SERVER_ERROR, error.message, 503);
    }

    return apiError(ErrorCodes.SERVER_ERROR, "Could not check claimable funding status.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};

async function isFundingOutputSpent(input: {
  amountSompi: bigint;
  blockTime: null | number;
  fundingAddress: string;
  outputIndex: number;
  transactionId: string;
}): Promise<boolean> {
  if (
    input.blockTime !== null &&
    Date.now() - input.blockTime >= 0 &&
    Date.now() - input.blockTime < RECENT_FUNDING_SPENT_GRACE_MS
  ) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UTXO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${KASPA_REST_BASE_URL}/addresses/${encodeURIComponent(input.fundingAddress)}/utxos`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new KaspaIndexerError(`Indexer responded with status ${response.status}.`, {
        code: "INDEXER_HTTP_ERROR",
      });
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new KaspaIndexerError("Indexer returned an unexpected UTXO payload shape.", {
        code: "INDEXER_PARSE_ERROR",
      });
    }

    return !payload.some((entry) =>
      isMatchingFundingUtxo(entry, {
        amountSompi: input.amountSompi,
        outputIndex: input.outputIndex,
        transactionId: input.transactionId,
      }),
    );
  } catch (error) {
    if (error instanceof KaspaIndexerError) throw error;
    throw new KaspaIndexerError(
      `Indexer UTXO request failed: ${error instanceof Error ? error.message : String(error)}`,
      { code: "INDEXER_NETWORK_ERROR" },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function isMatchingFundingUtxo(
  value: unknown,
  expected: { amountSompi: bigint; outputIndex: number; transactionId: string },
): boolean {
  if (!isRecord(value) || !isRecord(value.outpoint) || !isRecord(value.utxoEntry)) {
    return false;
  }

  const transactionId = value.outpoint.transactionId;
  const index = value.outpoint.index;
  const amount = parseSompi(value.utxoEntry.amount);

  return (
    typeof transactionId === "string" &&
    transactionId.toLowerCase() === expected.transactionId.toLowerCase() &&
    typeof index === "number" &&
    index === expected.outputIndex &&
    amount === expected.amountSompi
  );
}

function parseSompi(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  return BigInt(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
