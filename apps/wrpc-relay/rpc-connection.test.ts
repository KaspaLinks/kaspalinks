import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";

import { describe, expect, it } from "vitest";

import { createRpcConnection } from "./rpc-connection.mjs";

const DISCONNECTED = "RPC Server (remote error) -> WebSocket disconnected";
const silentLog = { info: () => undefined, warn: () => undefined };

type Step = "ok" | "hang" | Error;

// Behaves like a kaspa-wasm RpcClient where it matters here: a connect() that
// does not succeed keeps retrying until disconnect(), and disconnect() rejects
// every call still waiting for an answer.
class FakeRpcClient {
  isConnected = false;
  connects = 0;
  retrying = false;
  readonly connectPlan: Step[] = [];
  readonly pingPlan: Step[] = [];
  readonly waiting = new Set<(error: Error) => void>();

  connect(): Promise<void> {
    this.connects += 1;
    const step = this.connectPlan.shift() ?? "ok";
    if (step === "ok") {
      this.isConnected = true;
      return Promise.resolve();
    }
    if (step instanceof Error) return Promise.reject(step);
    this.retrying = true;
    return this.waitForAnswer();
  }

  disconnect(): Promise<void> {
    this.isConnected = false;
    this.retrying = false;
    for (const reject of this.waiting) reject(new Error(DISCONNECTED));
    this.waiting.clear();
    return Promise.resolve();
  }

  ping(): Promise<void> {
    const step = this.pingPlan.shift() ?? "ok";
    if (step === "ok") return Promise.resolve();
    if (step instanceof Error) return Promise.reject(step);
    return this.waitForAnswer();
  }

  private waitForAnswer(): Promise<void> {
    return new Promise((_resolve, reject) => {
      this.waiting.add(reject);
    });
  }
}

function connectionFor(client: unknown, options: { connectTimeoutMs?: number } = {}) {
  return createRpcConnection({
    client,
    connectTimeoutMs: options.connectTimeoutMs ?? 1_000,
    disconnectTimeoutMs: 1_000,
    keepaliveTimeoutMs: 5,
    log: silentLog,
    network: "mainnet",
  });
}

describe("relay RPC connection", () => {
  it("stops the client's retry loop when a connect times out", async () => {
    const client = new FakeRpcClient();
    client.connectPlan.push("hang");
    const connection = connectionFor(client, { connectTimeoutMs: 20 });

    await expect(connection.withClient(async () => "unreachable")).rejects.toThrow(
      /connect timed out/u,
    );
    expect(client.retrying).toBe(false);
    expect(client.waiting.size).toBe(0);
    expect(connection.status()).toMatchObject({
      connected: false,
      lastConnectError: expect.stringMatching(/timed out/u),
    });

    // The next request connects the same client again.
    await expect(connection.withClient(async () => "ok")).resolves.toBe("ok");
    expect(client.connects).toBe(2);
  });

  it("reconnects once when many requests fail on the same connection", async () => {
    const client = new FakeRpcClient();
    const connection = connectionFor(client);
    await connection.warm("startup");

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        connection.callWithReconnect(
          async (rpc: FakeRpcClient) => {
            if (rpc.connects === 1) throw new Error(DISCONNECTED);
            return "ok";
          },
          1_000,
          "test read",
        ),
      ),
    );

    expect(results).toEqual(Array(10).fill("ok"));
    expect(client.connects).toBe(2);
  });

  it("keeps a newer connection when an older request fails late", async () => {
    const client = new FakeRpcClient();
    const connection = connectionFor(client);
    await connection.warm("startup");

    let failSlowRead: (error: Error) => void = () => undefined;
    const slowRead = connection.withClient(
      () =>
        new Promise((_resolve, reject) => {
          failSlowRead = reject;
        }),
    );

    // The keepalive finds the socket dead and reconnects meanwhile.
    client.pingPlan.push(new Error(DISCONNECTED));
    await connection.warm("interval");
    expect(client.connects).toBe(2);

    failSlowRead(new Error(DISCONNECTED));
    await expect(slowRead).rejects.toThrow(DISCONNECTED);
    expect(connection.status().connected).toBe(true);
    await connection.withClient(async () => "ok");
    expect(client.connects).toBe(2);
  });

  it("releases every unanswered ping across many keepalive reconnects", async () => {
    const client = new FakeRpcClient();
    const connection = connectionFor(client);
    await connection.warm("startup");

    for (let cycle = 0; cycle < 300; cycle += 1) {
      client.pingPlan.push("hang");
      await connection.warm("interval");
    }

    expect(connection.status()).toMatchObject({ connected: true, connects: 301 });
    expect(client.waiting.size).toBe(0);
    expect(client.retrying).toBe(false);
  });
});

// The same checks against the real kaspa-wasm client and a local WebSocket
// server that accepts connections but never answers a wRPC call.
type RealRpcClient = { free(): void };
type KaspaWasm = {
  RpcClient: new (config: { networkId: string; url: string }) => RealRpcClient;
  __wasm: { memory: WebAssembly.Memory };
};

const kaspa: KaspaWasm = createRequire(new URL("../web/package.json", import.meta.url))(
  "kaspa-wasm",
);

describe("relay RPC connection with kaspa-wasm", () => {
  it("reconnects one client in place without growing WASM memory", async () => {
    const node = await startSilentWebSocketServer();
    const client = new kaspa.RpcClient({ networkId: "mainnet", url: node.url });
    const connection = connectionFor(client);
    try {
      await connection.warm("startup");
      for (let cycle = 0; cycle < 20; cycle += 1) await connection.warm("interval");
      const wasmBytesBefore = kaspa.__wasm.memory.buffer.byteLength;

      // Each ping goes unanswered, so every cycle is a full reconnect. A new
      // RpcClient per reconnect kept ~16 KB each, about 3 MB for 200 cycles.
      for (let cycle = 0; cycle < 200; cycle += 1) await connection.warm("interval");

      expect(connection.status()).toMatchObject({ connected: true, connects: 221 });
      expect(node.accepted()).toBe(221);
      expect(kaspa.__wasm.memory.buffer.byteLength - wasmBytesBefore).toBeLessThan(512 * 1024);
    } finally {
      await connection.close();
      await waitUntil(() => node.openSockets() === 0);
      node.close();
    }
    expect(node.openSockets()).toBe(0);
  }, 30_000);

  it("leaves no retry loop behind after a connect times out", async () => {
    let attempts = 0;
    const refuser = createTcpServer((socket: Socket) => {
      attempts += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => refuser.listen(0, "127.0.0.1", resolve));
    const { port } = refuser.address() as AddressInfo;
    const client = new kaspa.RpcClient({ networkId: "mainnet", url: `ws://127.0.0.1:${port}` });
    const connection = connectionFor(client, { connectTimeoutMs: 300 });
    try {
      await expect(connection.withClient(async () => "unreachable")).rejects.toThrow(
        /connect timed out/u,
      );
      const attemptsAtTimeout = attempts;
      expect(attemptsAtTimeout).toBeGreaterThan(0);

      // A client left connecting retries about once a second.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(attempts).toBe(attemptsAtTimeout);
    } finally {
      await connection.close();
      refuser.close();
    }
  }, 15_000);
});

async function startSilentWebSocketServer() {
  const sockets = new Set<Duplex>();
  let accepted = 0;
  const server = createHttpServer((_request, response) => {
    response.writeHead(426).end();
  });
  server.on("upgrade", (request, socket: Duplex) => {
    accepted += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    // Answers a close frame like a node does; every other frame is ignored.
    socket.on("data", (data: Buffer) => {
      if (containsCloseFrame(data)) socket.end(Buffer.from([0x88, 0x00]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    accepted: () => accepted,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
    openSockets: () => sockets.size,
    url: `ws://127.0.0.1:${port}`,
  };
}

// Client frames are masked; walks the frames in one chunk.
function containsCloseFrame(data: Buffer): boolean {
  let offset = 0;
  while (offset + 2 <= data.length) {
    const opcode = data[offset] & 0x0f;
    if (opcode === 0x8) return true;
    let length = data[offset + 1] & 0x7f;
    let header = 2;
    if (length === 126) {
      length = data.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      length = Number(data.readBigUInt64BE(offset + 2));
      header = 10;
    }
    const masked = (data[offset + 1] & 0x80) !== 0;
    offset += header + (masked ? 4 : 0) + length;
  }
  return false;
}

async function waitUntil(condition: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
