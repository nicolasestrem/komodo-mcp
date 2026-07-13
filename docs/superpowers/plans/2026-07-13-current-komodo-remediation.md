# Current Komodo Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the custom HTTP implementation with komodo_client 2.1.1, correct current API contracts, repair transport and deployment defects, and restore minimal CI.

**Architecture:** Keep src/komodo-client.ts as a narrow adapter over the official client. A composed process-wide Undici dispatcher enforces absolute deadlines, inactivity timeouts, response-size limits, and pooling; one concurrency gate and one adapter are shared across HTTP sessions. Registry operations compile against official Komodo request unions.

**Tech Stack:** Node.js 22, TypeScript 6, komodo_client 2.1.1, Undici 8, MCP SDK 1.27, Express 5, Zod 4, node:test, Docker Compose.

## Global Constraints

- Support current Komodo only; no legacy aliases or API-version detection.
- Never retry Komodo requests.
- Preserve MCP tool names; change inputs only when the current API requires it.
- Add focused regression tests only.
- Add one Node 22 CI job without matrix, coverage, release, CodeQL, or scanning jobs.
- Record the official client's GPL-3.0 declaration for separate redistribution review.

---

### Task 1: Official client adapter

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Replace: src/komodo-client.ts
- Modify: test/komodo-client.test.js
- Modify: test/secret-leak.test.js
- Modify: test/helpers.js

**Interfaces:**
- Consumes: official KomodoClient(url, API-key options).
- Produces: KomodoClient.fromEnv(), typed call(endpoint, operation, params), close(), and redacted inspection.
- Produces: KOMODO_TIMEOUT_MS, KOMODO_MAX_CONCURRENCY, and KOMODO_MAX_RESPONSE_BYTES.

- [ ] **Step 1: Install the official dependency**

~~~bash
npm install komodo_client@2.1.1
~~~

Expected: manifest and lockfile add the official runtime package.

- [ ] **Step 2: Write failing integration tests**

Add to test/helpers.js:

~~~js
export async function startUpstream(handler) {
  const server = createHttpServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: "http://127.0.0.1:" + address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
~~~

Add focused tests that:

1. Assert ListServers sends POST /read/ListServers, body {}, and API-key headers.
2. Destroy the socket during CreateStack and assert exactly one upstream request.
3. Send response headers plus an unfinished JSON body and assert a 30 ms timeout.
4. Return more than 100 bytes and assert the response-size failure.
5. Preserve existing address, environment, and secret-redaction assertions.

The first test body is:

~~~js
test("official client routes a current read request", async (t) => {
  const upstream = await startUpstream(async (req, res) => {
    assert.equal(req.url, "/read/ListServers");
    assert.equal(req.headers["x-api-key"], "test-key");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {});
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  t.after(upstream.close);
  const client = new KomodoClient({
    address: upstream.baseUrl,
    apiKey: "test-key",
    apiSecret: "test-secret",
  });
  t.after(() => client.close());
  assert.deepEqual(await client.call("read", "ListServers", {}), { ok: true });
});
~~~

- [ ] **Step 3: Verify RED**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/komodo-client.test.js test/secret-leak.test.js
~~~

Expected: failures identify the old request envelope, retry behavior, incomplete deadline, and old API.

- [ ] **Step 4: Implement the official adapter**

Use these type definitions:

~~~ts
import { KomodoClient as createOfficialClient, type Types } from "komodo_client";

type Endpoint = "read" | "write" | "execute";
export type OperationFor<E extends Endpoint> = E extends "read"
  ? Types.ReadRequest["type"]
  : E extends "write"
    ? Types.WriteRequest["type"]
    : Types.ExecuteRequest["type"];

export interface KomodoConfig {
  address: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  maxResponseBytes?: number;
}
~~~

Create an Undici Agent with 16 connections, pipelining 1, keep-alive settings, and maxResponseSize. Compose a dispatcher which:

- forwards headersTimeout and bodyTimeout equal to timeoutMs;
- starts an unreferenced timer in onRequestStart;
- calls controller.abort(new DOMException("Request timed out", "TimeoutError")) at the absolute deadline;
- clears the timer in onResponseEnd and onResponseError.

Save and install the prior global dispatcher. Construct the official API-key client and one pLimit gate.

Implement one-attempt routing:

~~~ts
async call<E extends Endpoint>(
  endpoint: E,
  operation: OperationFor<E>,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  return this.#limit(async () => {
    try {
      if (endpoint === "read") {
        return await this.#official.read(operation as never, params as never);
      }
      if (endpoint === "write") {
        return await this.#official.write(operation as never, params as never);
      }
      return await this.#official.execute(operation as never, params as never);
    } catch (error) {
      const detail = this.#redact(errorDetail(error));
      throw new Error("Komodo API " + endpoint + " (" + operation + ") request failed: " + detail);
    }
  });
}
~~~

errorDetail prefers Error.message, then an official rejection's result, then safe JSON/string conversion. close() restores the prior dispatcher only if still installed, then closes the owned dispatcher. fromEnv() reads KOMODO_MAX_RESPONSE_BYTES and removes KOMODO_MAX_RETRIES. Preserve redacted toJSON and util.inspect.

- [ ] **Step 5: Verify GREEN and commit**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/komodo-client.test.js test/secret-leak.test.js
git add package.json package-lock.json src/komodo-client.ts test/helpers.js test/komodo-client.test.js test/secret-leak.test.js
git commit -m "refactor: use official Komodo client"
~~~

Expected: selected tests pass with one request per call.

---

### Task 2: Current tool contracts

**Files:**
- Modify: src/tools/registry.ts
- Modify: test/tools.test.js
- Regenerate: docs/API.md

**Interfaces:**
- Consumes: OperationFor<E>.
- Produces: 35 endpoint/operation pairs compiled against official request unions.

- [ ] **Step 1: Write failing contract tests**

Add file_path to the generic argument builder. Add a table asserting:

~~~js
const cases = [
  ["komodo_pull_stack", { stack: "s" }, ["execute", "PullStack", { stack: "s" }]],
  ["komodo_prune_images", { server: "srv" }, ["execute", "PruneImages", { server: "srv" }]],
  ["komodo_prune_networks", { server: "srv" }, ["execute", "PruneNetworks", { server: "srv" }]],
  ["komodo_prune_system", { server: "srv" }, ["execute", "PruneSystem", { server: "srv" }]],
  ["komodo_get_stack_log", { stack: "s" }, [
    "read", "GetStackLog",
    { stack: "s", services: [], tail: 100, timestamps: false },
  ]],
  ["komodo_get_stack_services", { stack: "s" }, [
    "read", "ListStackServices", { stack: "s" },
  ]],
  ["komodo_write_stack_contents", {
    stack: "s", file_path: "compose.yaml", contents: "services: {}",
  }, [
    "write", "WriteStackFileContents",
    { stack: "s", file_path: "compose.yaml", contents: "services: {}" },
  ]],
];
~~~

Change the container-log boundary assertion to reject 5001 and require file_path in the size test.

- [ ] **Step 2: Verify RED**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/tools.test.js
~~~

Expected: four stale operations, three wrong parameter shapes, and old tail limit fail.

- [ ] **Step 3: Implement typed current contracts**

Make ToolSpecInput generic over endpoint and type operation as OperationFor<E>. Apply:

- PullStack
- PruneImages
- PruneNetworks
- PruneSystem
- ListStackServices with required stack
- WriteStackFileContents with required file_path string, length 1-4096
- GetStackLog with services default [], tail default 100/max 5000, timestamps default false
- GetContainerLog maximum 5000

Use this log schema:

~~~ts
inputSchema: {
  ...stackArg,
  services: z.array(z.string().min(1).max(256)).max(100).default([]),
  tail: z.number().int().min(1).max(5000).default(100),
  timestamps: z.boolean().default(false),
},
~~~

- [ ] **Step 4: Verify GREEN, regenerate, and commit**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/tools.test.js
npm run docs:api
git add src/tools/registry.ts test/tools.test.js docs/API.md
git commit -m "fix: align tools with current Komodo API"
~~~

Expected: tests pass and generated docs show current operations and inputs.

---

### Task 3: Shared client and bounded sessions

**Files:**
- Modify: src/index.ts
- Modify: test/smoke.test.js
- Modify: test/helpers.js
- Modify: .env.example

**Interfaces:**
- Consumes: one shared KomodoClient.
- Produces: unknown-session 404, initialize-only creation, exposed session header, configurable idle expiry, and early shutdown deadline.

- [ ] **Step 1: Write failing session tests**

Tighten unknown session to status 404 and body { error: "Session not found" }. Add an initialize Origin and assert access-control-expose-headers contains mcp-session-id. Add:

~~~js
test("idle streamable session expires", async (t) => {
  const handle = await startApp({
    MCP_AUTH_TOKEN: "smoke-token",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_SESSION_IDLE_TIMEOUT_MS: "25",
  });
  t.after(handle.close);
  const initialized = await initialize(handle.baseUrl, "smoke-token");
  const sessionId = initialized.headers.get("mcp-session-id");
  await initialized.text();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const res = await callToolsList(handle.baseUrl, "smoke-token", sessionId);
  assert.equal(res.status, 404);
});
~~~

Extract initialize and callToolsList helpers in the same test file.

- [ ] **Step 2: Verify RED**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/smoke.test.js
~~~

Expected: current 400, absent exposed header, and non-expiring session fail.

- [ ] **Step 3: Implement session lifecycle**

Import isInitializeRequest from @modelcontextprotocol/sdk/types.js. Strictly parse MCP_SESSION_IDLE_TIMEOUT_MS with default 1800000. Construct once:

~~~ts
const sharedClient = options.client ?? KomodoClient.fromEnv();
~~~

Store touch() per session. Its timer clears, resets, invokes close(), and calls unref(). Handle requests in this order:

~~~ts
if (sessionIdHeader) {
  const existing = sessions.get(sessionIdHeader);
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  existing.touch();
  await existing.transport.handleRequest(req, res, req.body);
  return;
}
if (req.method !== "POST" || !isInitializeRequest(req.body)) {
  res.status(400).json({ error: "Initialization request required" });
  return;
}
~~~

Start/clear idle timers in Streamable and SSE session lifecycle. Configure CORS exposedHeaders: ["mcp-session-id"]. Start the forced-exit timer before awaiting closeAll(). Close the shared client after session cleanup.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm run build
LOG_LEVEL=silent node --test --test-reporter=spec test/smoke.test.js test/auth.test.js
git add src/index.ts test/smoke.test.js test/helpers.js .env.example
git commit -m "fix: bound MCP session lifecycle"
~~~

Expected: exact 404, CORS exposure, expiry, and auth tests pass.

---

### Task 4: Compose and clean packaging

**Files:**
- Modify: docker-compose.prod.yml
- Modify: docker-compose.override.yml
- Modify: package.json

**Interfaces:**
- Produces: valid production Compose, no predictable token, and clean dist on every build.

- [ ] **Step 1: Verify existing failures**

~~~bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
docker compose config | rg "MCP_AUTH_TOKEN: devtoken"
npm run build
test ! -e dist/tools/read.js
~~~

Expected: PID conflict, devtoken match, and stale-module check failure.

- [ ] **Step 2: Apply exact fixes**

Add pids: 256 under deploy.resources.limits. Set MCP_AUTH_TOKEN to the environment value with an empty default in the development override. Change build to:

~~~json
"build": "npm run clean && tsc"
~~~

- [ ] **Step 3: Verify and commit**

~~~bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config >/dev/null
npm run build
test ! -e dist/tools/read.js
test ! -e dist/tools/execute.js
test ! -e dist/tools/write.js
git add docker-compose.prod.yml docker-compose.override.yml package.json
git commit -m "fix: harden deployment and clean builds"
~~~

Expected: every command exits 0 and resolved local Compose has no devtoken.

---

### Task 5: Minimal CI and documentation

**Files:**
- Create: .github/workflows/ci.yml
- Modify: README.md
- Modify: CLAUDE.md
- Modify: CHANGELOG.md
- Modify: docs/ARCHITECTURE.md
- Modify: docs/DEVELOPMENT.md
- Modify: docs/DEPLOYMENT.md
- Modify: docs/RUNBOOK.md
- Modify: .env.example
- Regenerate: docs/API.md

**Interfaces:**
- Produces: one Node 22 job and docs matching implemented behavior.

- [ ] **Step 1: Create minimal CI**

~~~yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npm run docs:check
      - run: docker compose -f docker-compose.yml -f docker-compose.prod.yml config
~~~

- [ ] **Step 2: Align documentation**

Across the listed docs:

- document official /read/<Operation>, /write/<Operation>, and /execute/<Operation> routing;
- remove retry/backoff and KOMODO_MAX_RETRIES;
- add KOMODO_MAX_RESPONSE_BYTES=16777216 and MCP_SESSION_IDLE_TIMEOUT_MS=1800000;
- change log tail maximum to 5000;
- document get_stack_services(stack) and write_stack_contents(stack,file_path,contents);
- describe one shared client and session expiry;
- remove claims for deleted CodeQL, Trivy, release, and npm workflows;
- explain loopback auth with an unset local token;
- add the official-client GPL-3.0 redistribution-review note;
- add an Unreleased changelog entry.

Regenerate with npm run docs:api.

- [ ] **Step 3: Verify and commit**

~~~bash
npm run docs:check
! rg "PullStackImages|PruneDockerImages|PruneDockerNetworks|PruneDockerSystem|KOMODO_MAX_RETRIES|max: 10000|1–10000" README.md CLAUDE.md CHANGELOG.md docs .env.example src test
git add .github/workflows/ci.yml README.md CLAUDE.md CHANGELOG.md docs .env.example
git commit -m "ci: restore minimal verification"
~~~

Expected: docs match generated output and stale contracts are absent.

---

### Task 6: Full verification and completion audit

**Files:**
- Verify all changed files; add no new scope.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: evidence for every approved acceptance criterion.

- [ ] **Step 1: Run complete verification**

~~~bash
npm ci
npm test
npm run lint
npm run docs:check
npm audit --omit=dev
docker compose -f docker-compose.yml -f docker-compose.prod.yml config >/dev/null
docker build -t komodo-mcp:verify .
npm pack --dry-run
~~~

Expected: all commands exit 0, all tests pass, audit is clean, Docker builds, and the package has only current generated modules and package documentation.

- [ ] **Step 2: Audit requirements and diff**

~~~bash
git status --short
rg -n "komodo_client|MCP_SESSION_IDLE_TIMEOUT_MS|KOMODO_MAX_RESPONSE_BYTES|exposedHeaders|ListStackServices|WriteStackFileContents|PruneSystem" package.json src README.md docs .env.example .github/workflows/ci.yml
git diff HEAD~5 --check
git diff HEAD~5 --stat
~~~

Expected: only approved files changed, every named contract exists, and the diff has no whitespace errors.

