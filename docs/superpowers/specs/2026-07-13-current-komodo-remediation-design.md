# Current Komodo Remediation Design

## Goal

Bring the MCP server onto the current `komodo_client@2.1.1` contract, replace the custom
Komodo HTTP implementation with the official client, repair the reviewed reliability and
transport defects, and restore a minimal CI gate.

## Scope and constraints

- Support the current Komodo API only; do not retain aliases for older operation names.
- Use the official `komodo_client` package for Komodo authentication, request routing,
  request/response types, and JSON handling.
- Preserve existing MCP tool names unless a tool's input must change to satisfy the current API.
- Preserve `KOMODO_TIMEOUT_MS` and `KOMODO_MAX_CONCURRENCY`; add
  `KOMODO_MAX_RESPONSE_BYTES` with a 16 MiB default.
- Remove automatic Komodo request retries. In particular, never retry write or execute calls.
- Add only regression tests that directly cover the repaired behavior.
- Add one CI workflow and one job; do not add a version matrix, release automation, coverage
  reporting, CodeQL, or container scanning in this change.
- The official client declares GPL-3.0. This implementation records it as a runtime dependency;
  license compatibility for redistribution must be reviewed separately before the next release.

## Architecture

### Official Komodo client adapter

`src/komodo-client.ts` remains the MCP-facing adapter so the rest of the application keeps a
small `call(endpoint, operation, params)` interface. Internally it constructs the official
`KomodoClient` with API-key authentication and dispatches through its `read`, `write`, and
`execute` methods. Endpoint and operation types come from `komodo_client.Types`, which makes an
invalid operation name a compile-time error.

The adapter retains only responsibilities that the official client does not provide:

- a process-wide `p-limit` concurrency gate;
- secret-safe error normalization;
- redacted `toJSON` and `util.inspect` output;
- ownership and closure of the shared Undici dispatcher.

There is one adapter instance per process for HTTP transports, shared by all MCP sessions. Stdio
creates one adapter for its single server.

### Network enforcement beneath the official client

The official client uses global `fetch` and does not expose `RequestInit` or dispatcher injection.
At process initialization the adapter therefore installs one process-owned Undici dispatcher.
The underlying `Agent` enforces the response-size ceiling and connection pooling. A composed
dispatcher handler starts an absolute deadline when a request begins and aborts the request if it
has not reached response completion by `KOMODO_TIMEOUT_MS`. Header and body inactivity timeouts use
the same configured value.

This dispatcher is intentionally process-wide because this application owns its Node process and
all upstream fetch traffic is Komodo traffic. Tests that need transport behavior use a local HTTP
server rather than replacing `global.fetch`.

No retry interceptor is installed. A failed read, write, or execute call returns one normalized
MCP tool error after one upstream attempt.

## Current Komodo tool contract

The registry will use the current canonical operations:

- `PullStack`
- `PruneImages`
- `PruneNetworks`
- `PruneSystem`

Additional schema corrections:

- `komodo_get_stack_log` sends `services`, `tail`, and `timestamps`; `services` defaults to an
  empty array, `tail` defaults to 100 and is bounded to 1-5000, and `timestamps` defaults to false.
- `komodo_get_container_log` lowers its maximum `tail` from 10000 to 5000.
- `komodo_get_stack_services` calls `ListStackServices` and requires `stack`.
- `komodo_write_stack_contents` requires `file_path` and sends it with `stack` and `contents`.
- Backward-compatibility wrapper methods in the adapter are removed; the registry uses only the
  typed generic `call` interface.

Generated API documentation and hand-written configuration documentation will be updated from
the registry and the final environment contract.

## Streamable HTTP lifecycle

- `buildApp()` creates or receives one shared Komodo adapter before mounting transports.
- A request containing an unknown `mcp-session-id` receives HTTP 404.
- A request without a session ID creates a session only when it is an MCP initialize request;
  other session-bound requests receive HTTP 400.
- CORS exposes `mcp-session-id` to allowed browser origins.
- Each initialized session owns an unreferenced idle timer. The timer defaults to 30 minutes,
  resets on valid session traffic, and closes/removes the session at expiry.
- `MCP_SESSION_IDLE_TIMEOUT_MS` configures the timeout and must be a positive integer.
- Session cleanup clears its timer and remains re-entry safe.
- Shutdown starts its 15-second forced-exit timer before closing the HTTP server or sessions.
- Shutdown closes the shared Komodo adapter after sessions close.

Legacy SSE retains the existing routes and session cap. Its sessions receive the same configured
idle-expiry timer without changing the legacy wire protocol.

## Deployment and packaging

- Production Compose gives `pids_limit` and `deploy.resources.limits.pids` the same value so the
  documented Compose command validates.
- The development override removes the predictable `devtoken` fallback. With no token configured,
  the existing loopback-only authentication fallback applies.
- `build` cleans `dist` before TypeScript compilation so removed files cannot enter packages.
- Documentation no longer claims workflows that do not exist.

## Minimal tests and CI

Focused regression coverage will be limited to:

1. Registry routing and parameter shapes for the corrected current Komodo operations.
2. One upstream attempt for an ambiguous network failure on a write call.
3. Absolute timeout and maximum response-size enforcement using a local HTTP server.
4. Shared client construction, CORS session-header exposure, unknown-session 404, and idle-session
   expiry in the existing HTTP test files.
5. Clean package contents through the build configuration; no separate packaging test suite.

The single CI job runs on Node 22 and performs:

1. `npm ci`
2. `npm test` (includes TypeScript build)
3. `npm run lint`
4. `npm run docs:check`
5. `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`

## Acceptance criteria

- TypeScript cannot compile the four stale Komodo operation names.
- All 35 registered tools use current Komodo operations and required parameters.
- A write or execute failure causes exactly one upstream attempt.
- Requests abort across headers and body consumption at the configured absolute deadline.
- Responses exceeding the configured maximum are rejected before full allocation.
- HTTP sessions share one concurrency gate and expire when idle.
- Browser clients can read `mcp-session-id`; unknown session IDs return 404.
- The documented production Compose command validates.
- A clean build and package contain only current generated files.
- The focused test suite, lint, docs check, production Compose validation, and Docker build pass.
