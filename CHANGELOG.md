# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-04-30

### ⚠ BREAKING

- **Default bind moved from `0.0.0.0` to `127.0.0.1`.** Set `MCP_BIND_HOST=0.0.0.0` (and `MCP_AUTH_TOKEN`) to expose on the network. Inside the official Docker image the default is already `0.0.0.0` — host port mapping controls exposure.
- **`MCP_AUTH_TOKEN` is required for non-loopback callers.** Without a token, requests from non-loopback IPs are refused with 401.
- **Default transport is now `streamable` (Streamable HTTP).** Single endpoint `/mcp`. The legacy SSE transport (`/sse` + `/messages`) is still available under `MCP_TRANSPORT=sse`.
- **Per-session `McpServer`.** Each client connection gets its own server instance; previous shared-instance behavior could leak state across concurrent sessions.
- **`update_stack` and `update_server` reject secret-like keys** in `config` (`api_key`, `api_secret`, `password`, `secret`, `webhook_secret`, `token`, with hyphen/underscore variants). Callers that previously passed these through Komodo will now get a Zod validation error.
- **`outputSchema: z.object({})` removed from all tools.** Tools no longer advertise an empty (and misleading) output schema. Clients reading the tool catalog should treat `outputSchema` as absent.
- **Engine: Node.js >= 20.** Node 18 dropped from CI matrix.

### Added

- Bearer-token auth gate (`MCP_AUTH_TOKEN`, also `MCP_AUTH_TOKEN_FILE` for Docker secrets) with constant-time SHA-256 compare.
- Origin and Host allow-list middleware (`MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS`) — DNS-rebinding defense in depth.
- `MCP_BIND_HOST` env var.
- `KOMODO_TIMEOUT_MS`, `KOMODO_MAX_RETRIES`, `KOMODO_MAX_CONCURRENCY` env vars.
- `KOMODO_API_KEY_FILE`, `KOMODO_API_SECRET_FILE`, `MCP_AUTH_TOKEN_FILE` for Docker/Kubernetes secrets.
- Helmet security headers and a CORS allow-list configurable via `MCP_ALLOWED_ORIGINS`.
- Pino structured logging with header redaction (`Authorization`, `X-Api-Key`, `X-Api-Secret`); pino-http request logs.
- `SIGTERM`/`SIGINT` graceful shutdown — closes active sessions before exit.
- Shared `undici.Agent` (keep-alive 30s, 16 connections) for all Komodo requests.
- `p-limit` semaphore on the Komodo client (`KOMODO_MAX_CONCURRENCY`).
- Single deadline across all retries (no more 3× timeout budget).
- Jittered exponential backoff on retries.
- Pre-send transport errors (DNS, ECONNREFUSED, etc.) retry on any verb (idempotent because the request never reached Komodo).
- Tool annotations applied consistently: `readOnlyHint` on read tools, `idempotentHint` on start/stop/restart, `destructiveHint` on prune/destroy/delete and `write_stack_contents`.
- Bounded input schemas: `tail` 1–10000, `terms` 1–20 entries (each ≤256 chars), `compose_contents`/`contents` ≤256 KiB.
- Response-size guard (`maxResponseBytes`, default 16 MiB).
- `KomodoClient.toJSON()` and `util.inspect.custom` redact secrets (`[redacted]`).
- `formatResult` no longer pretty-prints; large payloads (>64 KiB) omit text inline and rely on `structuredContent` only.
- `toolHandler` wrapper turns thrown errors into MCP `{ isError: true }` results.
- `buildApp(options)` factory exported for tests; `test/helpers.js` with `startApp`/`stubFetch`/`makeFakeClient`/`rawRequest`.
- 56-test suite covering auth, secret leakage, tool routing, Zod boundaries, formatResult, client retry/backoff (via injected clock), and an end-to-end smoke handshake.
- ADRs under `docs/adr/`: per-session McpServer, loopback default bind, retry policy, streamable default.
- `docs/RUNBOOK.md` for rotation, draining, rollback, healthcheck failures.
- Hardened production compose at `docker-compose.prod.yml` (`read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, resource limits, Docker secrets).
- CI: `npm test`, `npm audit`, CodeQL, Trivy on the built image.
- Release workflow: npm publish with provenance + GHCR multi-arch image push with SBOM.

### Changed

- Express bumped to 5.x; route handlers rely on Express 5's native async error propagation.
- Zod bumped to 4.x.
- `KomodoClient` returns `Promise<unknown>` via a public generic `call(endpoint, operation, params)` (per-method wrappers retained for backward compatibility but considered deprecated; the registry uses `call`).
- `KOMODO_ADDRESS` is parsed as a URL on construction; non-`http(s)` schemes are rejected. Trailing slashes normalized.
- TypeScript stricter (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`).
- Biome introduced for lint+format (replaces ad-hoc).
- All `console.*` replaced by Pino; logs go to stderr regardless of transport.

### Removed

- `src/tools/{read,execute,write}.ts` — replaced by the declarative `src/tools/registry.ts` table.
- TypeScript `declaration`/`declarationMap` outputs (this is an app, not a library API).

### Security

- SSE/Streamable endpoints require bearer token unless the caller is loopback.
- Host-header allowlist mitigates DNS rebinding even with a loopback bind.
- Secrets are scrubbed from upstream error bodies before the error is surfaced to the MCP client.
- API credentials live in `#private` fields and are excluded from `JSON.stringify(client)` and `console.log(client)`.
- Helmet sets standard security headers; `X-Powered-By` is suppressed.
- Strict input bounds prevent runaway log/compose payloads.

## [1.0.0] - 2024-01-XX

### Added

- Initial release of Komodo MCP Server
- 35 tools for interacting with Komodo API:
  - 15 read tools (list, get, inspect operations)
  - 12 execute tools (deploy, start, stop, prune operations)
  - 8 write tools (create, update, delete operations)
- Support for SSE and stdio transports
- Docker support with multi-stage build
- TypeScript with strict mode
- Zod schema validation for all tool inputs
- Health check endpoint for SSE mode
- Comprehensive documentation
