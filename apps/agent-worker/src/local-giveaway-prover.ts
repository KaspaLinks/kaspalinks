import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import { z } from "zod";

const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const proverRoot = resolve(projectRoot, "labs/giveaway-entropy-prover");
const captureScript = resolve(proverRoot, "scripts/fetch-mainnet-pair.mjs");
const defaultProverBin = resolve(proverRoot, "target/release/prove_job");
const MAX_REQUEST_BYTES = 64_000;
const MAX_CHILD_OUTPUT_BYTES = 1_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_COUNT = 30;

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const scoreSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u).refine((value) =>
  value.length <= 20 && BigInt(value) <= (1n << 64n) - 1n,
);
// One job per draw slot: the receipt attests the first selected-chain block
// crossing the target and nothing Giveaway-specific, so every Giveaway of the
// slot is served from the same cached result.
const requestSchema = z.object({
  jobKey: hashSchema,
  entropyTargetBlueScore: scoreSchema,
}).strict();
const readySchema = z.object({
  status: z.literal("ready"),
  compactProofHex: z.string().regex(/^[0-9a-f]{256}$/u),
  parentBlockHashHex: hashSchema,
  parentBlueScore: scoreSchema,
  parentSequenceCommitmentHex: hashSchema,
  candidateBlockHashHex: hashSchema,
  candidateBlueScore: scoreSchema,
  candidateSequenceCommitmentHex: hashSchema,
}).strict();

export type LocalProofRequest = z.infer<typeof requestSchema>;
export type LocalProofReady = z.infer<typeof readySchema>;
type Job = { createdAt: number; status: "pending" } | { createdAt: number; status: "ready"; result: LocalProofReady };
type Runner = (request: LocalProofRequest) => Promise<LocalProofReady>;

export function parseLocalProofRequest(value: unknown): LocalProofRequest {
  const request = requestSchema.parse(value);
  const commitment = JSON.stringify({ entropyTargetBlueScore: request.entropyTargetBlueScore });
  const expected = createHash("sha256").update(commitment).digest("hex");
  if (request.jobKey !== expected) throw new Error("Invalid proof job key.");
  return request;
}

/** The HTTP listener is loopback-only. A private tunnel can carry worker jobs to it. */
export function createLocalGiveawayProverServer(runJob: Runner): Server {
  const jobs = new Map<string, Job>();
  const recentRequests: number[] = [];
  let activeJobKey: string | null = null;
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/prove") {
      sendError(response, 404, "NOT_FOUND", "Proof endpoint not found.");
      return;
    }
    const now = Date.now();
    while (recentRequests.length && recentRequests[0]! <= now - RATE_LIMIT_WINDOW_MS) recentRequests.shift();
    if (recentRequests.length >= RATE_LIMIT_COUNT) {
      sendError(response, 429, "RATE_LIMITED", "Too many proof requests.");
      return;
    }
    recentRequests.push(now);
    let input: LocalProofRequest;
    try {
      const bytes = await readBody(request);
      input = parseLocalProofRequest(JSON.parse(bytes.toString("utf8")) as unknown);
    } catch {
      sendError(response, 400, "INVALID_REQUEST", "Invalid public proof job.");
      return;
    }
    for (const [key, job] of jobs) if (job.createdAt < now - 24 * 60 * 60_000) jobs.delete(key);
    const existing = jobs.get(input.jobKey);
    if (existing?.status === "ready") {
      sendJson(response, 200, existing.result);
      return;
    }
    if (existing?.status === "pending" || activeJobKey !== null) {
      sendJson(response, 202, { status: "pending", retryAfterSeconds: 60 });
      return;
    }
    activeJobKey = input.jobKey;
    jobs.set(input.jobKey, { createdAt: now, status: "pending" });
    void Promise.resolve()
      .then(() => runJob(input))
      .then((result) => {
        jobs.set(input.jobKey, { createdAt: Date.now(), status: "ready", result: readySchema.parse(result) });
      })
      .catch(() => {
        jobs.delete(input.jobKey);
      })
      .finally(() => {
        activeJobKey = null;
      });
    sendJson(response, 202, { status: "pending", retryAfterSeconds: 60 });
  });
}

export async function runLocalProofJob(request: LocalProofRequest): Promise<LocalProofReady> {
  const captured = await childJson("node", [captureScript, "--target", request.entropyTargetBlueScore], undefined, 300_000);
  const proverBin = process.env.GIVEAWAY_PROVER_BIN?.trim() || defaultProverBin;
  const workDir = process.env.RISC0_WORK_DIR?.trim() || resolve(homedir(), ".cache/kaspa-groth16");
  await mkdir(workDir, { recursive: true });
  const result = await childJson(
    proverBin,
    [],
    JSON.stringify({
      entropyTargetBlueScore: request.entropyTargetBlueScore,
      capturedPair: captured,
    }),
    2 * 60 * 60_000,
    { RISC0_WORK_DIR: workDir },
  );
  return readySchema.parse(result);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function childJson(
  command: string,
  args: string[],
  stdin: string | undefined,
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_CHILD_OUTPUT_BYTES) child.kill("SIGKILL");
      else output.push(chunk);
    });
    // Drain diagnostics without logging header data or process internals.
    child.stderr.resume();
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || bytes > MAX_CHILD_OUTPUT_BYTES) {
        reject(new Error("Proof subprocess failed."));
        return;
      }
      try {
        resolveResult(JSON.parse(Buffer.concat(output).toString("utf8")) as unknown);
      } catch {
        reject(new Error("Proof subprocess returned invalid JSON."));
      }
    });
    child.stdin.end(stdin);
  });
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendError(response: import("node:http").ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.GIVEAWAY_PROVER_PORT || "3020");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid prover port.");
  createLocalGiveawayProverServer(runLocalProofJob).listen(port, "127.0.0.1", () => {
    console.info(`Giveaway prover listening on 127.0.0.1:${port}.`);
  });
}
