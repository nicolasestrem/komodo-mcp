import assert from "node:assert/strict";
import { test } from "node:test";
import { readJson, startApp } from "./helpers.js";

test("end-to-end: initialize via streamable HTTP returns the MCP greeting", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer smoke-token",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1.0.0" },
      },
    }),
  });

  assert.equal(res.status, 200);
  // Response is SSE: "event: message\ndata: { ... }\n\n"
  const text = await res.text();
  const match = text.match(/data: (\{.*\})/);
  assert.ok(match, `expected SSE data line in body: ${text.slice(0, 200)}`);
  const payload = JSON.parse(match[1]);
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, 1);
  assert.equal(payload.result.serverInfo.name, "komodo");
  assert.ok(payload.result.capabilities.tools, "tools capability missing");
});

test("end-to-end: missing sessionId on subsequent /mcp request is handled by transport", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer smoke-token",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-session-id": "non-existent-session",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  // The SDK transport returns 400/404 for unknown sessions; we just assert
  // we don't get a 5xx and there's a structured error body.
  assert.notEqual(res.status, 500);
  assert.ok(res.status >= 400 && res.status < 500);
  const body = await readJson(res);
  assert.ok(body, "expected JSON error body");
});
