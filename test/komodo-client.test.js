import assert from "node:assert/strict";
import { test } from "node:test";
import { KomodoClient } from "../dist/komodo-client.js";
import { startUpstream } from "./helpers.js";

function createClient(address, overrides = {}) {
  return new KomodoClient({
    address,
    apiKey: "test-key",
    apiSecret: "test-secret",
    ...overrides,
  });
}

test("official client routes a current read request", async (t) => {
  const upstream = await startUpstream(async (req, res) => {
    assert.equal(req.url, "/read/ListServers");
    assert.equal(req.headers["x-api-key"], "test-key");
    assert.equal(req.headers["x-api-secret"], "test-secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {});
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  t.after(upstream.close);
  const client = createClient(upstream.baseUrl);
  t.after(() => client.close());

  assert.deepEqual(await client.call("read", "ListServers", {}), { ok: true });
});

test("ambiguous write transport failure is attempted exactly once", async (t) => {
  let requests = 0;
  const upstream = await startUpstream((req) => {
    requests += 1;
    req.socket.destroy();
  });
  t.after(upstream.close);
  const client = createClient(upstream.baseUrl);
  t.after(() => client.close());

  await assert.rejects(client.call("write", "CreateStack", { name: "demo", config: {} }));
  assert.equal(requests, 1);
});

test("absolute timeout continues after response headers", async (t) => {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"unfinished":');
  });
  t.after(upstream.close);
  const client = createClient(upstream.baseUrl, { timeoutMs: 30 });
  t.after(() => client.close());

  const testDeadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("test deadline exceeded")), 200)
  );
  await assert.rejects(
    Promise.race([client.call("read", "ListServers", {}), testDeadline]),
    /timed out|TimeoutError/i
  );
});

test("response body limit is enforced by the transport", async (t) => {
  const upstream = await startUpstream((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ value: "x".repeat(200) }));
  });
  t.after(upstream.close);
  const client = createClient(upstream.baseUrl, { maxResponseBytes: 100 });
  t.after(() => client.close());

  await assert.rejects(client.call("read", "ListServers", {}), /100|response|exceed/i);
});

test("KOMODO_ADDRESS trailing slash is normalized", () => {
  const client = createClient("http://example.com/");
  assert.equal(client.address, "http://example.com");
  return client.close();
});

test("KOMODO_ADDRESS without scheme throws on construction", () => {
  assert.throws(() => createClient("example.com"), /not a valid URL|must be http/);
});

test("KOMODO_ADDRESS with file:// scheme is rejected", () => {
  assert.throws(() => createClient("file:///etc/passwd"), /must be http/);
});

test("fromEnv rejects when any required var is missing", () => {
  const original = { ...process.env };
  try {
    delete process.env.KOMODO_ADDRESS;
    delete process.env.KOMODO_API_KEY;
    delete process.env.KOMODO_API_SECRET;
    assert.throws(() => KomodoClient.fromEnv(), /Missing required environment/);

    process.env.KOMODO_ADDRESS = "http://x";
    assert.throws(() => KomodoClient.fromEnv(), /Missing required environment/);

    process.env.KOMODO_API_KEY = "k";
    assert.throws(() => KomodoClient.fromEnv(), /Missing required environment/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
});

test("fromEnv applies current optional transport tuning", async () => {
  const original = { ...process.env };
  try {
    process.env.KOMODO_ADDRESS = "http://komodo";
    process.env.KOMODO_API_KEY = "k";
    process.env.KOMODO_API_SECRET = "s";
    process.env.KOMODO_TIMEOUT_MS = "5000";
    process.env.KOMODO_MAX_CONCURRENCY = "16";
    process.env.KOMODO_MAX_RESPONSE_BYTES = "12345";
    delete process.env.KOMODO_MAX_RETRIES;
    const client = KomodoClient.fromEnv();
    assert.equal(client.timeoutMs, 5000);
    assert.equal(client.maxConcurrency, 16);
    assert.equal(client.maxResponseBytes, 12345);
    assert.equal("maxRetries" in client, false);
    await client.close();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
});
