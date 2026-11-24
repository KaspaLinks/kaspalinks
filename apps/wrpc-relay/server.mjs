import { createServer } from "node:http";
import { createRequire } from "node:module";

import {
  normalizeBlockHeadersRequest,
  normalizeVirtualChainRequest,
  stringifyRelayJson,
} from "./protocol.mjs";
import {
  createRpcConnection,
  errorMessage,
  isConnectionError,
  withTimeout,
} from "./rpc-connection.mjs";

const require = createRequire(import.meta.url);
const kaspa = require("kaspa-wasm");
const { Resolver, RpcClient, Transaction, version } = kaspa;

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? process.env.TOCCATA_RELAY_PORT ?? "3010");
const NETWORK_ID = "mainnet";
// Toccata caps a transaction at 1,000,000 transient mass (about 250 KB of bytes),
// which is about 500 KB as SafeJSON hex. A 4-shard Giveaway V6 freeze is already
// ~325 KB; the former 250 KB limit silently refused it before any submit.
const BODY_LIMIT_BYTES = 1_000_000;
const SUBMIT_TIMEOUT_MS = Number(process.env.TOCCATA_RELAY_SUBMIT_TIMEOUT_MS ?? "20000");
const READ_TIMEOUT_MS = Number(process.env.TOCCATA_RELAY_READ_TIMEOUT_MS ?? "30000");
const CONNECT_TIMEOUT_MS = Number(process.env.TOCCATA_RELAY_CONNECT_TIMEOUT_MS ?? "30000");
const WARM_CONNECT_INTERVAL_MS = Number(
  process.env.TOCCATA_RELAY_WARM_CONNECT_INTERVAL_MS ?? "30000",
);
// A connected client is pinged on the same interval. Public nodes drop idle
// WebSockets silently; without the ping the next submit found a dead socket and
// waited 10-20 s for a fresh resolver connection.
const KEEPALIVE_TIMEOUT_MS = 5_000;

// One client for the whole process, reconnected in place (see rpc-connection.mjs).
const rpcConnection = createRpcConnection({
  client: new RpcClient({ networkId: NETWORK_ID, resolver: new Resolver() }),
  connectTimeoutMs: CONNECT_TIMEOUT_MS,
  keepaliveTimeoutMs: KEEPALIVE_TIMEOUT_MS,
  network: NETWORK_ID,
});
let warmTimer = null;

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      void rpcConnection.warm("health");
      const { connected, connecting, connects, lastConnectError } = rpcConnection.status();
      writeJson(response, 200, {
        connected,
        connecting,
        connects,
        lastConnectError,
        memory: readMemory(),
        network: NETWORK_ID,
        ok: true,
        sdkVersion: readSdkVersion(),
        service: "kaspa-wrpc-relay",
      });
      return;
    }

    if (request.method === "GET" && request.url === "/ready") {
      void rpcConnection.warm("readiness");
      const { connected } = rpcConnection.status();
      writeJson(response, connected ? 200 : 503, {
        connected,
        network: NETWORK_ID,
        ok: connected,
        service: "kaspa-wrpc-relay",
      });
      return;
    }

    if (request.method === "POST" && request.url === "/submit") {
      const input = await readJsonBody(request);
      const result = await submitSignedTransaction(input);
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url === "/network") {
      const result = await rpcConnection.callWithReconnect(
        (client) => client.getCurrentNetwork(),
        READ_TIMEOUT_MS,
        "Kaspa RPC network read",
      );
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/virtual-chain-v2") {
      const input = normalizeVirtualChainRequest(await readJsonBody(request));
      const result = await rpcConnection.callWithReconnect(
        (client) => client.getVirtualChainFromBlockV2(input),
        READ_TIMEOUT_MS,
        "Kaspa VSPC v2 read",
      );
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/block-headers") {
      const input = normalizeBlockHeadersRequest(await readJsonBody(request));
      const blocks = await rpcConnection.callWithReconnect(
        (client) =>
          Promise.all(
            input.hashes.map((hash) => client.getBlock({ hash, includeTransactions: false })),
          ),
        READ_TIMEOUT_MS,
        "Kaspa block-header read",
      );
      writeJson(response, 200, { blocks });
      return;
    }

    writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
  } catch (error) {
    const message = errorMessage(error);
    const timedOut = message.toLowerCase().includes("timed out");
    // Public chain data only; without this a refused request left no trace at all.
    console.warn("[kaspa-wrpc-relay] request failed", {
      message: message.slice(0, 500),
      path: request.url,
    });
    writeJson(response, timedOut ? 504 : 400, {
      error: {
        code: timedOut ? "UPSTREAM_TIMEOUT" : "INVALID_RELAY_REQUEST",
        message,
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.info("[kaspa-wrpc-relay] listening", {
    host: HOST,
    network: NETWORK_ID,
    port: PORT,
    sdkVersion: readSdkVersion(),
  });
  void rpcConnection.warm("startup");
  warmTimer = setInterval(() => {
    void rpcConnection.warm("interval");
  }, WARM_CONNECT_INTERVAL_MS);
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

async function submitSignedTransaction(input) {
  const expectedTransactionId = normalizeTransactionId(input?.expectedTransactionId);
  const transactionSafeJson = normalizeTransactionSafeJson(input?.transactionSafeJson);
  const transaction = Transaction.deserializeFromSafeJSON(transactionSafeJson);
  const submits = [];
  try {
    const localTransactionId = transaction.id;

    if (localTransactionId !== expectedTransactionId) {
      throw new Error("Signed transaction id changed during wRPC submit preparation.");
    }

    console.info("[kaspa-wrpc-relay] submit received", {
      connected: rpcConnection.status().connected,
      transactionId: expectedTransactionId,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const submitted = await rpcConnection.withClient((client) => {
          const submit = client.submitTransaction({
            allowOrphan: false,
            transaction,
          });
          submits.push(submit);
          return withTimeout(submit, SUBMIT_TIMEOUT_MS, "Kaspa RPC submit");
        });

        return {
          localTransactionId,
          submittedTransactionId: submitted.transactionId || localTransactionId,
        };
      } catch (error) {
        if (isAlreadyAcceptedError(error)) {
          console.info("[kaspa-wrpc-relay] submit already accepted", {
            transactionId: localTransactionId,
          });
          return {
            localTransactionId,
            submittedTransactionId: localTransactionId,
          };
        }

        if (attempt === 0 && isConnectionError(error)) {
          console.warn("[kaspa-wrpc-relay] retrying submit after RPC reconnect", {
            message: errorMessage(error),
            transactionId: localTransactionId,
          });
          continue;
        }
        throw error;
      }
    }

    throw new Error("Kaspa RPC submit failed after reconnect.");
  } finally {
    // A deserialized transaction lives in WASM memory (about 260 KB for a 300 KB
    // SafeJSON). The garbage collector does not see that size and WASM memory
    // never shrinks, so it is freed here once every submit attempt has settled.
    void Promise.allSettled(submits).then(() => freeWasmObject(transaction));
  }
}

async function shutdown(signal) {
  console.info("[kaspa-wrpc-relay] shutting down", { signal });
  if (warmTimer !== null) clearInterval(warmTimer);
  server.close(() => undefined);
  await rpcConnection.close();
  process.exit(0);
}

function isAlreadyAcceptedError(error) {
  const message =
    error instanceof Error && error.message ? error.message.toLowerCase() : String(error);
  return (
    message.includes("already accepted by the consensus") ||
    message.includes("was already accepted")
  );
}

function normalizeTransactionId(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("expectedTransactionId must be a 32-byte transaction id.");
  }
  return value.toLowerCase();
}

function normalizeTransactionSafeJson(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("transactionSafeJson is required.");
  }
  if (Buffer.byteLength(value, "utf8") > BODY_LIMIT_BYTES) {
    throw new Error("transactionSafeJson is too large for the relay.");
  }
  return value;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new Error("Request body is too large for the relay.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    throw new Error("Request body must be JSON.");
  }
  return JSON.parse(raw);
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(stringifyRelayJson(body));
}

function freeWasmObject(value) {
  try {
    value.free();
  } catch (error) {
    console.warn("[kaspa-wrpc-relay] could not free a WASM object", {
      message: errorMessage(error),
    });
  }
}

function readMemory() {
  const { heapUsed, rss } = process.memoryUsage();
  const wasmBytes = kaspa.__wasm?.memory?.buffer?.byteLength;
  return {
    heapUsedMb: toMegabytes(heapUsed),
    rssMb: toMegabytes(rss),
    wasmMb: typeof wasmBytes === "number" ? toMegabytes(wasmBytes) : null,
  };
}

function toMegabytes(bytes) {
  return Math.round(bytes / 1_000_000);
}

function readSdkVersion() {
  try {
    return typeof version === "function" ? version() : "unknown";
  } catch {
    return "unknown";
  }
}
