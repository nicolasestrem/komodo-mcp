import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { KomodoClient } from "../dist/komodo-client.js";

export function makeClient(opts = {}) {
  const client = new KomodoClient({
    address: opts.address ?? "http://komodo.invalid",
    apiKey: opts.apiKey ?? "k",
    apiSecret: opts.apiSecret ?? "s",
    timeoutMs: opts.timeoutMs ?? 30_000,
    maxConcurrency: opts.maxConcurrency ?? 8,
    ...opts.extra,
  });
  return { client };
}

/** Start a disposable local HTTP server for real client integration tests. */
export async function startUpstream(handler) {
  const server = createHttpServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

/**
 * Replace global.fetch with a queued sequence of responses or factories. Each
 * entry is either a Response or a function (req, init) => Response/Promise.
 * The mock records every invocation in `calls`.
 */
export function stubFetch(...responses) {
  const original = global.fetch;
  const calls = [];
  let idx = 0;
  global.fetch = async (input, init) => {
    calls.push({ input, init, body: init?.body });
    const next = responses[Math.min(idx, responses.length - 1)];
    idx++;
    if (typeof next === "function") return next(input, init);
    return next;
  };
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

/**
 * Build a Proxy-based fake KomodoClient that records every method invocation
 * and returns a stub result. Used to assert tool routing without hitting the
 * network.
 */
export function makeFakeClient(stubResult = { ok: true }) {
  const calls = [];
  const handler = {
    get(_target, prop) {
      if (prop === "then") return undefined; // never look like a promise
      if (typeof prop === "symbol") return undefined;
      return (...args) => {
        calls.push({ method: prop, args });
        return Promise.resolve(stubResult);
      };
    },
  };
  const fake = new Proxy({}, handler);
  return { client: fake, calls };
}

/**
 * Boot a fresh Express app via `buildApp(env)` on an ephemeral port and return
 * `{ baseUrl, close }`. Tests must `await close()` in t.after to release the
 * socket. Forks the env dynamically: env values applied via process.env BEFORE
 * importing the dist module the first time only — we re-import via dynamic
 * import to pick up changes when supported. For env-sensitive tests, prefer
 * mutating the env once at the top of the file before the first import.
 */
export async function startApp(envOverrides = {}, options = {}) {
  // Default Komodo creds so createServer() in streamable/sse handlers can
  // build a client. Tests can override or inject a fake via options.client.
  const defaults = {
    KOMODO_ADDRESS: "http://komodo.invalid",
    KOMODO_API_KEY: "test-api-key",
    KOMODO_API_SECRET: "test-api-secret",
  };
  const merged = { ...defaults, ...envOverrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  // Re-import buildApp every call so module-level env reads are fresh.
  const cacheBuster = `?ts=${randomBytes(4).toString("hex")}`;
  const mod = await import(`../dist/index.js${cacheBuster}`);
  const buildOptions = options.buildOptions ?? {};
  if (options.client) buildOptions.client = options.client;
  const handle = mod.buildApp(buildOptions);
  const httpServer = createHttpServer(handle.app);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    port,
    close: async () => {
      await new Promise((resolve) => httpServer.close(() => resolve()));
      await handle.closeAll();
    },
  };
}

/** Convenience: read JSON body from a fetch Response, returns null on parse failure. */
export async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Raw HTTP request that allows overriding the Host header (which fetch
 * forbids). Returns { status, headers, body }.
 */
export async function rawRequest({ port, method = "POST", path = "/", headers = {}, body = "" }) {
  const { request: httpRequest } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
