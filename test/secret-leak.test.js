import assert from "node:assert/strict";
import { test } from "node:test";
import { KomodoClient } from "../dist/komodo-client.js";
import { startUpstream } from "./helpers.js";

const SECRET = "super-secret-value";
const KEY = "super-secret-key";

function createClient(address) {
  return new KomodoClient({ address, apiKey: KEY, apiSecret: SECRET });
}

test("upstream errors redact API credentials", async (t) => {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `denied for key=${KEY} secret=${SECRET}` }));
  });
  t.after(upstream.close);
  const client = createClient(upstream.baseUrl);
  t.after(() => client.close());

  await assert.rejects(client.call("read", "ListServers", {}), (error) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, new RegExp(SECRET));
    assert.doesNotMatch(error.message, new RegExp(KEY));
    assert.match(error.message, /\[redacted\]/);
    return true;
  });
});

test("toJSON omits secrets", async () => {
  const client = createClient("http://example.com");
  const serialized = JSON.stringify(client);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, new RegExp(KEY));
  assert.match(serialized, /\[redacted\]/);
  await client.close();
});

test("util.inspect on the client redacts secrets", async () => {
  const { inspect } = await import("node:util");
  const client = createClient("http://example.com");
  const output = inspect(client);
  assert.doesNotMatch(output, new RegExp(SECRET));
  assert.doesNotMatch(output, new RegExp(KEY));
  await client.close();
});
