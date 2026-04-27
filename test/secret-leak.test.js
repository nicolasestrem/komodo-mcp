import assert from "node:assert/strict";
import { test } from "node:test";
import { makeClient, stubFetch } from "./helpers.js";

const SECRET = "super-secret-value";
const KEY = "super-secret-key";

test("error from upstream that echoes the API key/secret is redacted in thrown message", async (t) => {
  const stub = stubFetch(
    new Response(
      JSON.stringify({
        message: `denied for caller using key=${KEY} secret=${SECRET}`,
      }),
      { status: 401 }
    )
  );
  t.after(stub.restore);

  const { client } = makeClient({ apiKey: KEY, apiSecret: SECRET });

  await assert.rejects(client.listServers(), (err) => {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, new RegExp(SECRET));
    assert.doesNotMatch(err.message, new RegExp(KEY));
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
});

test("non-JSON error body is also redacted", async (t) => {
  const stub = stubFetch(new Response(`<html>error: secret=${SECRET}</html>`, { status: 502 }));
  t.after(stub.restore);

  const { client } = makeClient({ apiKey: KEY, apiSecret: SECRET, maxRetries: 1 });

  await assert.rejects(client.deployStack("s"), (err) => {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, new RegExp(SECRET));
    return true;
  });
});

test("toJSON omits secrets", () => {
  const { client } = makeClient({ apiKey: KEY, apiSecret: SECRET });
  const serialized = JSON.stringify(client);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, new RegExp(KEY));
  assert.match(serialized, /\[redacted\]/);
});

test("util.inspect on the client redacts secrets", async () => {
  const { inspect } = await import("node:util");
  const { client } = makeClient({ apiKey: KEY, apiSecret: SECRET });
  const out = inspect(client);
  assert.doesNotMatch(out, new RegExp(SECRET));
  assert.doesNotMatch(out, new RegExp(KEY));
});
