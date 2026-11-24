// The relay's one connection to a Kaspa node.
//
// Two kaspa-wasm (v2.0.1) properties shape this module:
//
// 1. Every RpcClient instance keeps roughly 12-16 KB of WASM memory for good,
//    even after disconnect() and free(), and WASM memory never shrinks. The
//    relay used to create a new client on every reconnect; it now creates one
//    client per process and reconnects that same client in place.
// 2. A started connect() keeps retrying in the background (about once a
//    second) until disconnect() is called. A connect that times out is
//    therefore always followed by disconnect(); before, each timed-out connect
//    left a client behind that retried forever.
//
// Reconnects are single-flight, and a failure seen on an older connection
// never tears down a newer one (the connection epoch guards that).

const DEFAULT_DISCONNECT_TIMEOUT_MS = 5_000;

export function createRpcConnection({
  client,
  connectTimeoutMs,
  keepaliveTimeoutMs,
  disconnectTimeoutMs = DEFAULT_DISCONNECT_TIMEOUT_MS,
  log = console,
  network,
}) {
  let epoch = 0;
  let healthy = false;
  let connecting = null;
  let keepaliveRunning = false;
  let lastConnectError = null;
  let closed = false;

  async function stopClient() {
    try {
      await withTimeout(client.disconnect(), disconnectTimeoutMs, "Kaspa RPC disconnect");
    } catch (error) {
      log.warn("[kaspa-wrpc-relay] disconnect failed", { message: errorMessage(error) });
    }
  }

  async function reconnect() {
    // Closes a stale socket and stops the client's own retry loop first.
    await stopClient();
    try {
      await withTimeout(client.connect(), connectTimeoutMs, "Kaspa RPC connect");
    } catch (error) {
      lastConnectError = errorMessage(error);
      await stopClient();
      throw error;
    }
    if (closed) {
      await stopClient();
      throw new Error("Kaspa RPC connection is closed.");
    }
    epoch += 1;
    healthy = true;
    lastConnectError = null;
    log.info("[kaspa-wrpc-relay] connected", { network });
  }

  async function ensureConnected() {
    if (closed) throw new Error("Kaspa RPC connection is closed.");
    if (!healthy) {
      if (connecting === null) {
        connecting = reconnect().finally(() => {
          connecting = null;
        });
      }
      await connecting;
    }
    return epoch;
  }

  async function withClient(operation) {
    const seenEpoch = await ensureConnected();
    try {
      return await operation(client);
    } catch (error) {
      // A failure on an older connection must not tear down a newer one.
      if (isConnectionError(error) && seenEpoch === epoch) healthy = false;
      throw error;
    }
  }

  async function callWithReconnect(operation, timeoutMs, label) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await withClient((rpc) => withTimeout(operation(rpc), timeoutMs, label));
      } catch (error) {
        if (attempt === 0 && isConnectionError(error)) continue;
        throw error;
      }
    }
    throw new Error(`${label} failed after reconnect.`);
  }

  async function keepAlive() {
    if (!healthy || keepaliveRunning) return;
    keepaliveRunning = true;
    const seenEpoch = epoch;
    try {
      if (!client.isConnected) throw new Error("WebSocket is not connected");
      await withTimeout(client.ping(), keepaliveTimeoutMs, "Kaspa RPC keepalive");
      return;
    } catch (error) {
      // A request may already have replaced the connection while the ping ran.
      if (seenEpoch === epoch && healthy) {
        log.warn("[kaspa-wrpc-relay] keepalive failed, reconnecting", {
          message: errorMessage(error),
        });
        healthy = false;
      }
    } finally {
      keepaliveRunning = false;
    }
    await warm("keepalive");
  }

  async function warm(reason) {
    if (closed) return;
    if (healthy) {
      if (reason === "interval") await keepAlive();
      return;
    }
    if (connecting !== null) return;
    try {
      await ensureConnected();
    } catch (error) {
      log.warn("[kaspa-wrpc-relay] warm connect failed", {
        message: errorMessage(error),
        reason,
      });
    }
  }

  async function close() {
    closed = true;
    healthy = false;
    await stopClient();
  }

  function status() {
    return {
      connected: healthy,
      connecting: connecting !== null,
      connects: epoch,
      lastConnectError,
    };
  }

  return { callWithReconnect, close, status, warm, withClient };
}

export function isConnectionError(error) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("not connected") ||
    message.includes("connection") ||
    message.includes("websocket") ||
    message.includes("network")
  );
}

export function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function withTimeout(promise, timeoutMs, label) {
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
