import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll, TOOLS } from "../dist/tools/registry.js";
import { makeFakeClient } from "./helpers.js";

function buildHarness() {
  const { client, calls } = makeFakeClient({ ok: true });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAll(server, client);
  // Reach into the SDK to invoke a tool by name. The McpServer wraps
  // registered tools in `_registeredTools[name]`, with `.handler` being the
  // user callback (post-2024 SDK rename from `.callback`).
  const registered = server._registeredTools ?? server.server?._registeredTools;
  assert.ok(registered, "expected SDK to expose _registeredTools");
  const callTool = async (name, args) => {
    const t = registered[name];
    assert.ok(t, `tool ${name} not registered`);
    // Validate args via the tool's input schema (mirrors what the SDK does).
    const parsed = t.inputSchema ? t.inputSchema.parse(args ?? {}) : (args ?? {});
    return t.handler(parsed, {});
  };
  return { server, client, calls, registered, callTool };
}

test("registry registers exactly 35 tools", () => {
  assert.equal(TOOLS.length, 35);
  const { registered } = buildHarness();
  const names = Object.keys(registered).filter((n) => n.startsWith("komodo_"));
  assert.equal(names.length, 35);
});

test("read tools carry readOnlyHint annotation; destructive tools carry destructiveHint", () => {
  const expectReadOnly = TOOLS.filter((t) => t.endpoint === "read").map((t) => t.name);
  const expectDestructive = [
    "komodo_destroy_stack",
    "komodo_prune_images",
    "komodo_prune_networks",
    "komodo_prune_system",
    "komodo_delete_stack",
    "komodo_delete_server",
    "komodo_write_stack_contents",
  ];
  for (const name of expectReadOnly) {
    const t = TOOLS.find((x) => x.name === name);
    assert.equal(t.annotations.readOnlyHint, true, `${name} missing readOnlyHint`);
  }
  for (const name of expectDestructive) {
    const t = TOOLS.find((x) => x.name === name);
    assert.equal(t.annotations.destructiveHint, true, `${name} missing destructiveHint`);
  }
});

test("each tool routes to client.call with correct (endpoint, operation)", async () => {
  const { calls, callTool } = buildHarness();
  // Provide minimal valid args for each shape.
  const args = (t) => {
    const out = {};
    if ("stack" in t.inputSchema) out.stack = "s";
    if ("server" in t.inputSchema) out.server = "srv";
    if ("container" in t.inputSchema) out.container = "c";
    if ("id" in t.inputSchema) out.id = "id1";
    if ("name" in t.inputSchema) out.name = "n";
    if ("server_id" in t.inputSchema) out.server_id = "srv-id";
    if ("address" in t.inputSchema) out.address = "https://periphery:8120";
    if ("contents" in t.inputSchema) out.contents = "version: '3'";
    if ("compose_contents" in t.inputSchema) out.compose_contents = "version: '3'";
    if ("config" in t.inputSchema) out.config = { server_id: "srv" };
    if ("terms" in t.inputSchema) out.terms = ["x"];
    return out;
  };
  for (const t of TOOLS) {
    calls.length = 0;
    const res = await callTool(t.name, args(t));
    assert.equal(res.isError, undefined, `${t.name} returned error: ${res.content?.[0]?.text}`);
    const last = calls.at(-1);
    assert.ok(last, `${t.name} did not invoke client`);
    assert.equal(last.method, "call", `${t.name} did not route via client.call`);
    assert.equal(last.args[0], t.endpoint, `${t.name} wrong endpoint`);
    assert.equal(last.args[1], t.operation, `${t.name} wrong operation`);
  }
});

test("Zod rejects komodo_get_stack without `stack`", async () => {
  const { callTool } = buildHarness();
  await assert.rejects(callTool("komodo_get_stack", {}));
});

test("get_container_log default tail is applied", async () => {
  const { calls, callTool } = buildHarness();
  await callTool("komodo_get_container_log", { server: "s", container: "c" });
  const last = calls.at(-1);
  assert.equal(last.args[2].tail, 100);
});

test("get_container_log rejects tail < 1 and > 10000", async () => {
  const { callTool } = buildHarness();
  await assert.rejects(
    callTool("komodo_get_container_log", { server: "s", container: "c", tail: 0 })
  );
  await assert.rejects(
    callTool("komodo_get_container_log", { server: "s", container: "c", tail: 100_000 })
  );
});

test("search_logs rejects empty terms array and oversize entries", async () => {
  const { callTool } = buildHarness();
  await assert.rejects(callTool("komodo_search_logs", { server: "s", container: "c", terms: [] }));
  await assert.rejects(
    callTool("komodo_search_logs", {
      server: "s",
      container: "c",
      terms: ["x".repeat(257)],
    })
  );
});

test("update_stack rejects forbidden secret-like keys in config", async () => {
  const { callTool } = buildHarness();
  for (const bad of ["api_key", "api-secret", "password", "secret", "webhook_secret", "token"]) {
    await assert.rejects(
      callTool("komodo_update_stack", { id: "s", config: { [bad]: "x" } }),
      `should reject config containing ${bad}`
    );
  }
});

test("update_stack accepts non-secret config keys", async () => {
  const { callTool } = buildHarness();
  const res = await callTool("komodo_update_stack", {
    id: "s",
    config: { server_id: "srv", branch: "main" },
  });
  assert.equal(res.isError, undefined);
});

test("update_server rejects api_secret key", async () => {
  const { callTool } = buildHarness();
  await assert.rejects(callTool("komodo_update_server", { id: "s", config: { api_secret: "x" } }));
});

test("write_stack_contents rejects oversize contents", async () => {
  const { callTool } = buildHarness();
  const huge = "y".repeat(300_000);
  await assert.rejects(callTool("komodo_write_stack_contents", { stack: "s", contents: huge }));
});

test("create_server rejects non-URL address", async () => {
  const { callTool } = buildHarness();
  await assert.rejects(callTool("komodo_create_server", { name: "n", address: "not-a-url" }));
});

test("handler exception (e.g. client throws) is surfaced as MCP error", async () => {
  // Build a server with a fake client whose `call` always throws.
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const throwingClient = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (typeof prop === "symbol") return undefined;
        return () => Promise.reject(new Error("client boom"));
      },
    }
  );
  registerAll(server, throwingClient);
  const registered = server._registeredTools ?? server.server?._registeredTools;
  const t = registered["komodo_list_servers"];
  const res = await t.handler({}, {});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /client boom/);
});

test("create_stack buildParams nests server_id under config", async () => {
  const { calls, callTool } = buildHarness();
  await callTool("komodo_create_stack", {
    name: "demo",
    server_id: "srv",
    compose_contents: "version: '3'",
  });
  const last = calls.at(-1);
  assert.equal(last.args[1], "CreateStack");
  assert.deepEqual(last.args[2], {
    name: "demo",
    config: { server_id: "srv", file_contents: "version: '3'" },
  });
});

test("create_server buildParams nests address under config", async () => {
  const { calls, callTool } = buildHarness();
  await callTool("komodo_create_server", { name: "n", address: "https://p:8120" });
  const last = calls.at(-1);
  assert.equal(last.args[1], "CreateServer");
  assert.deepEqual(last.args[2], { name: "n", config: { address: "https://p:8120" } });
});
