import assert from "node:assert/strict";
import { test } from "node:test";
import { rawRequest, readJson, startApp } from "./helpers.js";

test("loopback request is admitted when MCP_AUTH_TOKEN is unset", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: undefined,
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(body.status, "ok");
});

test("/mcp without token returns 401 over loopback (auth required for /mcp)", async (t) => {
  // Loopback fallback only opens /health-style paths via the per-request gate;
  // /mcp routes through requireAuth which still admits loopback when no token
  // is set. We verify the configured-token path explicitly here.
  const handle = await startApp({
    MCP_AUTH_TOKEN: "right-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("/mcp with wrong token returns 401", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "right-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer wrong-token-of-equal-length-as-right",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("/mcp with token of different length still returns 401 (not 500/crash)", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "right",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("/mcp with forbidden Host header returns 403", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  // fetch strips the Host header (forbidden by spec), so use raw http.
  const res = await rawRequest({
    port: handle.port,
    path: "/mcp",
    headers: { authorization: "Bearer tok", host: "evil.com" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /forbidden host/);
});

test("Host header with port is normalized correctly", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await rawRequest({
    port: handle.port,
    path: "/mcp",
    headers: { authorization: "Bearer tok", host: "127.0.0.1:9999" },
    body: "{}",
  });
  assert.notEqual(res.status, 403);
});

test("uppercase Host header LOCALHOST is admitted (case-insensitive)", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await rawRequest({
    port: handle.port,
    path: "/mcp",
    headers: { authorization: "Bearer tok", host: "LOCALHOST" },
    body: "{}",
  });
  assert.notEqual(res.status, 403);
});

test("forbidden Origin header returns 403 when allowlist non-empty", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_ALLOWED_ORIGINS: "https://good.example",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer tok",
      "content-type": "application/json",
      host: "127.0.0.1",
      origin: "https://evil.example",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
});

test("absent Origin header is admitted (browser-CSRF model)", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_ALLOWED_ORIGINS: "https://good.example",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer tok",
      "content-type": "application/json",
      host: "127.0.0.1",
    },
    body: "{}",
  });
  assert.notEqual(res.status, 403);
});

test("X-Powered-By header is suppressed", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: undefined,
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/health`);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("/health is anonymous (no token required) and reports config", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "tok",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
  });
  t.after(handle.close);

  const res = await fetch(`${handle.baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(body.status, "ok");
  assert.equal(body.transport, "streamable");
});
