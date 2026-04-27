import assert from "node:assert/strict";
import { test } from "node:test";
import { KomodoClient } from "../dist/komodo-client.js";
import { makeClient, stubFetch } from "./helpers.js";

test("listServers returns parsed JSON on success", async (t) => {
  const stub = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  t.after(stub.restore);

  const { client } = makeClient();
  assert.deepEqual(await client.listServers(), { ok: true });
  assert.equal(stub.calls.length, 1);
});

test("request aborts after timeout", async (t) => {
  const stub = stubFetch(
    (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
  );
  t.after(stub.restore);

  // Real clock here — the timer must actually fire to abort fetch.
  const client = new KomodoClient({
    address: "http://example.com",
    apiKey: "k",
    apiSecret: "s",
    timeoutMs: 20,
  });
  await assert.rejects(client.listServers(), /timed out/);
});

test("retries transient 5xx on read and eventually succeeds", async (t) => {
  const stub = stubFetch(
    new Response(JSON.stringify({ msg: "busy" }), { status: 500 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  t.after(stub.restore);

  const { client } = makeClient();
  assert.deepEqual(await client.listServers(), { ok: true });
  assert.equal(stub.calls.length, 2);
});

test("retries on 429 Too Many Requests", async (t) => {
  const stub = stubFetch(
    new Response("rate limited", { status: 429 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  t.after(stub.restore);

  const { client } = makeClient();
  assert.deepEqual(await client.listServers(), { ok: true });
  assert.equal(stub.calls.length, 2);
});

test("retry exhaustion returns an error with the upstream status", async (t) => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ error: "still bad" }), { status: 500 })
  );
  t.after(stub.restore);

  const { client } = makeClient({ maxRetries: 3 });
  await assert.rejects(client.listServers(), /returned 500/);
  assert.equal(stub.calls.length, 3);
});

test("execute operations do not retry on 5xx", async (t) => {
  const stub = stubFetch(() => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
  t.after(stub.restore);

  const { client } = makeClient();
  await assert.rejects(client.deployStack("demo"));
  assert.equal(stub.calls.length, 1);
});

test("non-OK response includes parsed error context", async (t) => {
  const stub = stubFetch(
    new Response(JSON.stringify({ error: "invalid request" }), { status: 400 })
  );
  t.after(stub.restore);

  const { client } = makeClient();
  await assert.rejects(
    client.listServers(),
    /Komodo API read \(ListServers\) returned 400: invalid request/
  );
});

test("non-JSON error body is surfaced as text in the error message", async (t) => {
  const stub = stubFetch(new Response("<html>oops</html>", { status: 502 }));
  t.after(stub.restore);

  const { client } = makeClient({ maxRetries: 1 });
  await assert.rejects(client.deployStack("s"), /<html>oops<\/html>/);
});

test("KOMODO_ADDRESS trailing slash is normalized", async (t) => {
  const stub = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  t.after(stub.restore);

  const { client } = makeClient({ address: "http://example.com/" });
  await client.listServers();
  const sentUrl = stub.calls[0].input;
  assert.equal(sentUrl, "http://example.com/read", "expected canonical URL with single slash");
});

test("KOMODO_ADDRESS without scheme throws on construction", () => {
  assert.throws(
    () => new KomodoClient({ address: "example.com", apiKey: "k", apiSecret: "s" }),
    /not a valid URL|must be http/
  );
});

test("KOMODO_ADDRESS with file:// scheme is rejected", () => {
  assert.throws(
    () => new KomodoClient({ address: "file:///etc/passwd", apiKey: "k", apiSecret: "s" }),
    /must be http/
  );
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
    Object.assign(process.env, original);
  }
});

test("fromEnv builds client when all vars present + applies optional tuning", () => {
  const original = { ...process.env };
  try {
    process.env.KOMODO_ADDRESS = "http://komodo";
    process.env.KOMODO_API_KEY = "k";
    process.env.KOMODO_API_SECRET = "s";
    process.env.KOMODO_TIMEOUT_MS = "5000";
    process.env.KOMODO_MAX_RETRIES = "5";
    process.env.KOMODO_MAX_CONCURRENCY = "16";
    const c = KomodoClient.fromEnv();
    assert.equal(c.timeoutMs, 5000);
    assert.equal(c.maxRetries, 5);
    assert.equal(c.maxConcurrency, 16);
  } finally {
    Object.assign(process.env, original);
  }
});

test("backoff schedule advances with jitter (asserted via injected clock)", async (t) => {
  const stub = stubFetch(() => new Response(JSON.stringify({ error: "x" }), { status: 503 }));
  t.after(stub.restore);

  const { client, ticks } = makeClient({ maxRetries: 3 });
  await assert.rejects(client.listServers());
  // 2 retries → 2 sleeps. Jitter range: 50-150 then 100-300.
  assert.equal(ticks.length, 2);
  assert.ok(ticks[0] >= 50 && ticks[0] <= 150, `tick0=${ticks[0]}`);
  assert.ok(ticks[1] >= 100 && ticks[1] <= 300, `tick1=${ticks[1]}`);
});

test("response > maxResponseBytes is rejected before parsing", async (t) => {
  const big = "x".repeat(200);
  const stub = stubFetch(new Response(big, { status: 200 }));
  t.after(stub.restore);

  const { client } = makeClient({ extra: { maxResponseBytes: 100 } });
  await assert.rejects(client.listServers(), /exceeded 100 bytes/);
});
