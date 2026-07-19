import { createRestKaspaIndexer, KaspaIndexerError } from "@kaspa-actions/kaspa-indexer";
import { prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isToccataLabEnabled, toccataFundingStatusInputSchema } from "@/lib/toccata-lab";

const KASPA_REST_BASE_URL = "https://api.kaspa.org";
const UTXO_REQUEST_TIMEOUT_MS = 7_000;
const RECENT_FUNDING_SPENT_GRACE_MS = 10_000;
const MAX_UNMATCHED_OUTPUTS = 20;

type FundingUtxo = {
  amountSompi: bigint;
  outputIndex: number;
  transactionId: string;
};

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
    const historyMatch =
      match !== null &&
      (parsed.data.fundingOutputIndex === undefined ||
        match.outputIndex === parsed.data.fundingOutputIndex)
        ? match
        : null;
    let currentUtxos: FundingUtxo[] | null = null;
    try {
      currentUtxos = await readFundingUtxos(parsed.data.fundingAddress);
    } catch (error) {
      const needsAuthoritativeSpentCheck =
        historyMatch !== null && !isInsideRecentFundingGrace(historyMatch.blockTime);
      if (needsAuthoritativeSpentCheck) throw error;
    }
    // The UTXO endpoint can expose a newly accepted output before the address
    // transaction history catches up. Treat an exact unspent outpoint as an
    // authoritative funding match so a correct payment is never presented as
    // an amount mismatch during that indexer propagation window.
    const utxoMatch =
      historyMatch === null
        ? currentUtxos?.find(
            (output) =>
              output.amountSompi === amountSompi &&
              (parsed.data.fundingTransactionId === undefined ||
                (output.transactionId === parsed.data.fundingTransactionId.toLowerCase() &&
                  output.outputIndex === parsed.data.fundingOutputIndex)),
          ) ?? null
        : null;
    const verifiedMatch =
      historyMatch ??
      (utxoMatch
        ? {
            blockTime: null,
            matchedSompi: utxoMatch.amountSompi,
            outputIndex: utxoMatch.outputIndex,
            transactionId: utxoMatch.transactionId,
          }
        : null);
    const spent =
      verifiedMatch === null
        ? false
        : isInsideRecentFundingGrace(verifiedMatch.blockTime)
          ? false
          : !currentUtxos?.some((output) =>
              isSameFundingOutput(output, {
                amountSompi: verifiedMatch.matchedSompi,
                outputIndex: verifiedMatch.outputIndex,
                transactionId: verifiedMatch.transactionId,
              }),
            );
    const unmatchedOutputs = (currentUtxos ?? [])
      .filter(
        (output) =>
          verifiedMatch === null ||
          !isSameFundingOutput(output, {
            amountSompi: verifiedMatch.matchedSompi,
            outputIndex: verifiedMatch.outputIndex,
            transactionId: verifiedMatch.transactionId,
          }),
      )
      .slice(0, MAX_UNMATCHED_OUTPUTS)
      .map((output) => ({
        amountSompi: output.amountSompi.toString(),
        outputIndex: output.outputIndex,
        transactionId: output.transactionId,
      }));

    return apiJson({
      funded: verifiedMatch !== null,
      outputStatus: verifiedMatch === null ? "unfunded" : spent ? "spent" : "funded_unspent",
      spent,
      unmatchedOutputs,
      utxoScanAvailable: currentUtxos !== null,
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

async function readFundingUtxos(fundingAddress: string): Promise<FundingUtxo[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UTXO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${KASPA_REST_BASE_URL}/addresses/${encodeURIComponent(fundingAddress)}/utxos`,
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

    return payload.flatMap((entry) => {
      const parsed = parseFundingUtxo(entry);
      return parsed ? [parsed] : [];
    });
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

function parseFundingUtxo(value: unknown): FundingUtxo | null {
  if (!isRecord(value) || !isRecord(value.outpoint) || !isRecord(value.utxoEntry)) {
    return null;
  }

  const transactionId = value.outpoint.transactionId;
  const outputIndex = parseOutputIndex(value.outpoint.index);
  const amountSompi = parseSompi(value.utxoEntry.amount);

  return typeof transactionId === "string" &&
    /^[0-9a-fA-F]{64}$/.test(transactionId) &&
    outputIndex !== null &&
    amountSompi !== null
    ? { amountSompi, outputIndex, transactionId: transactionId.toLowerCase() }
    : null;
}

function isSameFundingOutput(
  output: FundingUtxo,
  expected: { amountSompi: bigint; outputIndex: number; transactionId: string },
): boolean {
  return (
    output.transactionId === expected.transactionId.toLowerCase() &&
    output.outputIndex === expected.outputIndex &&
    output.amountSompi === expected.amountSompi
  );
}

function isInsideRecentFundingGrace(blockTime: null | number): boolean {
  if (blockTime === null) return false;
  const ageMs = Date.now() - blockTime;
  return ageMs >= 0 && ageMs < RECENT_FUNDING_SPENT_GRACE_MS;
}

function parseOutputIndex(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
