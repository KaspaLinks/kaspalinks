import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Resolver, RpcClient, Transaction, version } = require("kaspa-wasm");

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? process.env.TOCCATA_RELAY_PORT ?? "3010");
const NETWORK_ID = "mainnet";
const BODY_LIMIT_BYTES = 250_000;
const SUBMIT_TIMEOUT_MS = Number(process.env.TOCCATA_RELAY_SUBMIT_TIMEOUT_MS ?? "20000");
const CONNECT_TIMEOUT_MS = Number(process.env.TOCCATA_RELAY_CONNECT_TIMEOUT_MS ?? "30000");
const WARM_CONNECT_INTERVAL_MS = Number(
  process.env.TOCCATA_RELAY_WARM_CONNECT_INTERVAL_MS ?? "60000",
);

let rpc = null;
let connectPromise = null;
let lastConnectError = null;
let warmTimer = null;

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      void warmRpcClient("health");
      writeJson(response, 200, {
        connected: Boolean(rpc),
        connecting: Boolean(connectPromise),
        lastConnectError,
        network: NETWORK_ID,
        ok: true,
        sdkVersion: readSdkVersion(),
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

    writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    const timedOut = message.toLowerCase().includes("timed out");
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
  void warmRpcClient("startup");
  warmTimer = setInterval(() => {
    void warmRpcClient("interval");
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
  const localTransactionId = transaction.id;

  if (localTransactionId !== expectedTransactionId) {
    throw new Error("Signed transaction id changed during wRPC submit preparation.");
  }

  console.info("[kaspa-wrpc-relay] submit received", {
    connected: Boolean(rpc),
    transactionId: expectedTransactionId,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const client = await getRpcClient();
      const submitted = await withTimeout(
        client.submitTransaction({
          allowOrphan: false,
          transaction,
        }),
        SUBMIT_TIMEOUT_MS,
        "Kaspa RPC submit",
      );

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

      if (shouldResetRpcClient(error)) {
        await resetRpcClient();
        if (attempt === 0) {
          console.warn("[kaspa-wrpc-relay] retrying submit after RPC reconnect", {
            message: error instanceof Error && error.message ? error.message : String(error),
            transactionId: localTransactionId,
          });
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error("Kaspa RPC submit failed after reconnect.");
}

async function getRpcClient() {
  if (rpc !== null) return rpc;
  if (connectPromise !== null) return connectPromise;

  connectPromise = (async () => {
    const client = new RpcClient({
      networkId: NETWORK_ID,
      resolver: new Resolver(),
    });
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "Kaspa RPC connect");
    rpc = client;
    connectPromise = null;
    lastConnectError = null;
    console.info("[kaspa-wrpc-relay] connected", { network: NETWORK_ID });
    return client;
  })().catch((error) => {
    connectPromise = null;
    lastConnectError = error instanceof Error && error.message ? error.message : String(error);
    throw error;
  });

  return connectPromise;
}

async function warmRpcClient(reason) {
  if (rpc !== null || connectPromise !== null) return;
  try {
    await getRpcClient();
  } catch (error) {
    console.warn("[kaspa-wrpc-relay] warm connect failed", {
      message: error instanceof Error && error.message ? error.message : String(error),
      reason,
    });
  }
}

async function resetRpcClient() {
  const current = rpc;
  rpc = null;
  connectPromise = null;
  if (current !== null) {
    await current.disconnect().catch(() => undefined);
  }
}

async function shutdown(signal) {
  console.info("[kaspa-wrpc-relay] shutting down", { signal });
  if (warmTimer !== null) clearInterval(warmTimer);
  server.close(() => undefined);
  await resetRpcClient();
  process.exit(0);
}

function shouldResetRpcClient(error) {
  const message =
    error instanceof Error && error.message ? error.message.toLowerCase() : String(error);
  return (
    message.includes("timed out") ||
    message.includes("not connected") ||
    message.includes("connection") ||
    message.includes("websocket") ||
    message.includes("network")
  );
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
  response.end(JSON.stringify(body));
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeoutId);
    });
  });
}

function readSdkVersion() {
  try {
    return typeof version === "function" ? version() : "unknown";
  } catch {
    return "unknown";
  }
}
