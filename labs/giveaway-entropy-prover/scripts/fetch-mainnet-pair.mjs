#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../../..");
const requireFromKaspaPackage = createRequire(resolve(projectRoot, "packages/kaspa/package.json"));
const { Resolver, RpcClient } = requireFromKaspaPackage("kaspa-wasm");

const options = parseArguments(process.argv.slice(2));
const rpc = new RpcClient({ networkId: "mainnet", resolver: new Resolver() });

try {
  await withTimeout(rpc.connect(), options.timeoutMs, "Kaspa wRPC connection");
  const dag = await withTimeout(rpc.getBlockDagInfo(), options.timeoutMs, "Kaspa BlockDAG info");
  let candidate = await fetchHeader(dag.sink);
  const targetBlueScore = options.targetBlueScore ?? BigInt(candidate.blueScore);

  if (BigInt(candidate.blueScore) < targetBlueScore) {
    throw new Error(
      `Target blue score ${targetBlueScore} has not been reached by sink ${candidate.hash}.`,
    );
  }

  let parent;
  let traversed = 0;
  while (traversed <= options.maxSteps) {
    const parentHash = candidate.parentsByLevel?.[0]?.[0];
    if (!isHash(parentHash)) {
      throw new Error(`Candidate ${candidate.hash} has no valid selected parent.`);
    }
    parent = await fetchHeader(parentHash);
    if (
      BigInt(parent.blueScore) < targetBlueScore &&
      targetBlueScore <= BigInt(candidate.blueScore)
    ) {
      break;
    }
    candidate = parent;
    traversed += 1;
  }

  if (
    !parent ||
    !(BigInt(parent.blueScore) < targetBlueScore) ||
    !(targetBlueScore <= BigInt(candidate.blueScore))
  ) {
    throw new Error(
      `First crossing was not found within ${options.maxSteps} selected-parent steps.`,
    );
  }

  const capture = {
    network: "mainnet",
    capturedAt: new Date().toISOString(),
    sourceSink: dag.sink,
    sourceVirtualDaaScore: String(dag.virtualDaaScore),
    targetBlueScore: targetBlueScore.toString(),
    traversedSelectedParents: traversed,
    parent: normalizeHeader(parent),
    candidate: normalizeHeader(candidate),
  };
  const json = `${JSON.stringify(capture, null, 2)}\n`;

  if (options.outputPath) {
    const outputPath = resolve(process.cwd(), options.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(json);
  }
} finally {
  await rpc.disconnect().catch(() => undefined);
}

async function fetchHeader(hash) {
  const response = await withTimeout(
    rpc.getBlock({ hash, includeTransactions: false }),
    options.timeoutMs,
    `Kaspa block ${hash}`,
  );
  return response.block.header;
}

function normalizeHeader(header) {
  return {
    hash: normalizeHash(header.hash, "header hash"),
    version: header.version,
    parentsByLevel: header.parentsByLevel.map((level) =>
      level.map((hash) => normalizeHash(hash, "parent hash")),
    ),
    hashMerkleRoot: normalizeHash(header.hashMerkleRoot, "hash Merkle root"),
    acceptedIdMerkleRoot: normalizeHash(header.acceptedIdMerkleRoot, "sequence commitment"),
    utxoCommitment: normalizeHash(header.utxoCommitment, "UTXO commitment"),
    timestamp: String(header.timestamp),
    bits: header.bits,
    nonce: String(header.nonce),
    daaScore: String(header.daaScore),
    blueWork: normalizeBlueWork(header.blueWork),
    blueScore: String(header.blueScore),
    pruningPoint: normalizeHash(header.pruningPoint, "pruning point"),
  };
}

function normalizeBlueWork(value) {
  const raw = typeof value === "bigint" ? value.toString(16) : String(value);
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error("Header blue work is not hexadecimal.");
  const normalized = raw.replace(/^0+/, "").toLowerCase();
  if (normalized.length === 0) return "00";
  return normalized.length % 2 === 0 ? normalized : `0${normalized}`;
}

function normalizeHash(value, label) {
  if (!isHash(value)) throw new Error(`${label} is not a 32-byte hash.`);
  return value.toLowerCase();
}

function isHash(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function parseArguments(args) {
  const parsed = {
    maxSteps: 10_000,
    outputPath: null,
    targetBlueScore: null,
    timeoutMs: 30_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (name === "--output" && value) {
      parsed.outputPath = value;
      index += 1;
    } else if (name === "--target" && value && /^[0-9]+$/.test(value)) {
      parsed.targetBlueScore = BigInt(value);
      index += 1;
    } else if (name === "--max-steps" && value) {
      parsed.maxSteps = boundedInteger(value, "max steps", 0, 100_000);
      index += 1;
    } else if (name === "--timeout-ms" && value) {
      parsed.timeoutMs = boundedInteger(value, "timeout", 1, 300_000);
      index += 1;
    } else {
      throw new Error(`Unknown or invalid argument: ${name}`);
    }
  }
  return parsed;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
