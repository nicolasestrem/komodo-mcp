import assert from "node:assert/strict";
import { test } from "node:test";
import { readJson, startApp } from "./helpers.js";

function initialize(baseUrl, token, origin) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
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
}

function callToolsList(baseUrl, token, sessionId) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
}

test("end-to-end: initialize returns the MCP greeting and exposes its session header", async (t) => {
  const origin = "https://client.example";
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_ALLOWED_ORIGINS: origin,
  });
  t.after(handle.close);

  const res = await initialize(handle.baseUrl, "smoke-token", origin);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("access-control-expose-headers") ?? "", /mcp-session-id/i);
  assert.ok(res.headers.get("mcp-session-id"));

  const text = await res.text();
  const match = text.match(/data: (\{.*\})/);
  assert.ok(match, `expected SSE data line in body: ${text.slice(0, 200)}`);
  const payload = JSON.parse(match[1]);
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, 1);
  assert.equal(payload.result.serverInfo.name, "komodo");
  assert.ok(payload.result.capabilities.tools, "tools capability missing");
});

test("unknown streamable session returns exact 404", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await callToolsList(handle.baseUrl, "smoke-token", "non-existent-session");
  assert.equal(res.status, 404);
  assert.deepEqual(await readJson(res), { error: "Session not found" });
});

test("idle streamable session expires", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_SESSION_IDLE_TIMEOUT_MS: "25",
  });
  t.after(handle.close);

  const initialized = await initialize(handle.baseUrl, "smoke-token");
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.ok(sessionId);
  await initialized.text();
  await new Promise((resolve) => setTimeout(resolve, 60));

  const res = await callToolsList(handle.baseUrl, "smoke-token", sessionId);
  assert.equal(res.status, 404);
});
