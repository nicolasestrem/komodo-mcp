Never mark a task complete without pasting the verbatim output of the verification command (tests, build, lint, or run). No summary, no paraphrase — the raw output.
Never stub, mock, hardcode expected values, or insert placeholder code (TODO, pass, ...) to make something appear to work. If blocked, stop and ask.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Komodo MCP Server — an MCP server providing AI assistants with full access to the Komodo Docker/container management API. 35 tools across read, execute, and write categories. Default transport is **MCP Streamable HTTP**; legacy SSE and stdio are still supported.

## Build & Development Commands

```bash
npm install              # Install dependencies
npm run lint             # Biome (lint + format check)
npm run format           # Biome auto-format
npm run build            # Compile TypeScript to dist/
npm run dev              # Watch mode (auto-rebuild on changes)
npm test                 # Build then run all node:test suites (56 tests)
npm start                # Run the compiled server (streamable, loopback)
npm run dev:streamable   # Start with a dev token + streamable transport
npm run dev:sse          # Start with a dev token + legacy SSE transport
npm run clean            # Remove dist/
```

### Docker

```bash
docker compose up -d                                                        # Build & run with default loopback bind on host
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d       # Hardened production variant
docker build -t komodo-mcp .                                                # Build image only
```

## Architecture

```
src/
├── index.ts            # Express buildApp(), transports (streamable/sse/stdio),
│                       # auth/Origin/Host middleware, SIGTERM/SIGINT shutdown
├── server.ts           # createServer({ client? }) — DI-friendly McpServer factory
├── komodo-client.ts    # KomodoClient: shared undici Agent, p-limit semaphore,
│                       # single-deadline retry+jitter, secret redaction, *_FILE env
└── tools/
    ├── registry.ts     # Declarative TOOLS table (35 entries) + registerAll(server, client)
    └── utils.ts        # formatResult, toolHandler (errors → MCP isError result)
```

**Request flow**: MCP client → HTTP middleware (Helmet → CORS → Origin/Host gate → bearer-token auth → pino-http) → transport (`StreamableHTTPServerTransport` on `/mcp`, or legacy `SSEServerTransport` on `/sse`+`/messages`) → per-session `McpServer` → `toolHandler` → `KomodoClient.call(endpoint, op, params)` → `/read|/execute|/write` on Komodo Core.

**Transport selection** via `MCP_TRANSPORT`:
- `streamable` (default) — single `/mcp` endpoint (POST + optional SSE upstream + DELETE)
- `sse` — legacy two-endpoint `/sse` + `/messages`
- `stdio` — local CLI/pipe usage; no HTTP server. Logs go to stderr only.

`/health` is anonymous and reports `{ status, transport, port }`.

## Tool Registration Pattern

All 35 tools live in a single `TOOLS: ToolSpec[]` table (`src/tools/registry.ts`). Each spec has:

- `name`, `title`, `description`
- `endpoint`: `read | write | execute`
- `operation`: Komodo operation type literal (e.g. `ListStacks`)
- `inputSchema`: a Zod raw shape (e.g. `{ stack: z.string() }`)
- `annotations`: `READ_ONLY` | `IDEMPOTENT_WRITE` | `NON_IDEMPOTENT_WRITE` | `DESTRUCTIVE`
- optional `buildParams` to nest fields under Komodo's `config` shape
- optional `summary` for the human-readable text reply

`registerAll(server, client)` iterates the table and calls `server.registerTool(...)` once per spec, wrapping the handler in `toolHandler` so any thrown error becomes `{ isError: true }` instead of a transport error.

To add a tool: append a `spec({...})` row, run `npm test`. No new files needed.

## Environment Variables

### Komodo upstream
| Variable | Description |
|---|---|
| `KOMODO_ADDRESS` | Komodo Core URL (http(s) only). Trailing slash normalized. |
| `KOMODO_API_KEY` | API key. `KOMODO_API_KEY_FILE` reads from a file (Docker secrets). |
| `KOMODO_API_SECRET` | API secret. `KOMODO_API_SECRET_FILE` reads from a file. |
| `KOMODO_TIMEOUT_MS` | Per-request timeout (single deadline across retries). Default 30000. |
| `KOMODO_MAX_RETRIES` | Read-op retry budget. Default 2. |
| `KOMODO_MAX_CONCURRENCY` | In-flight semaphore. Default 8. |

### MCP server
| Variable | Description |
|---|---|
| `MCP_TRANSPORT` | `streamable` (default), `sse`, or `stdio` |
| `MCP_PORT` | HTTP port. Default 3113. |
| `MCP_BIND_HOST` | Bind interface. Default `127.0.0.1`; use `0.0.0.0` inside Docker. |
| `MCP_AUTH_TOKEN` | Bearer token. `MCP_AUTH_TOKEN_FILE` reads from file. **Unset = loopback-only.** |
| `MCP_ALLOWED_ORIGINS` | Comma-separated `Origin` allow-list. |
| `MCP_ALLOWED_HOSTS` | Comma-separated `Host`-header allow-list. Default `127.0.0.1,localhost`. |
| `LOG_LEVEL` | Pino log level (default `info`). |

## Komodo API Endpoints

`KomodoClient.call(endpoint, operation, params)` POSTs to:
- `/read` — non-mutating queries (`ListStacks`, `GetContainerLog`, etc.)
- `/execute` — runtime operations (`DeployStack`, `StartContainer`, etc.)
- `/write` — configuration changes (`CreateStack`, `UpdateServer`, etc.)

All requests include `X-Api-Key` and `X-Api-Secret` headers with body `{ type, params }`. Errors propagate with secrets scrubbed before the message reaches the MCP client. Reads retry on 5xx/429 and on transient `TypeError`s with jittered exponential backoff and a single shared deadline; pre-send transport errors (DNS, ECONNREFUSED, etc.) retry on any verb.

## Testing

`npm test` runs 56 node:test cases across `test/`:
- `auth.test.js` — bearer token, loopback fallback, Host/Origin allow-lists, X-Powered-By suppression
- `secret-leak.test.js` — `apiKey`/`apiSecret` never appear in error messages or `JSON.stringify(client)`
- `tools.test.js` — table-driven over all 35 tools: routing, Zod boundary cases, `buildParams` nesting, secret-key rejection in `update_*`
- `format-result.test.js` — `formatResult` and `toolHandler` branches
- `komodo-client.test.js` — retry/timeout/backoff (via injected `clock`), `fromEnv` permutations, response-size guard
- `smoke.test.js` — end-to-end `/mcp` initialize handshake

Test helpers (`test/helpers.js`): `makeClient`, `stubFetch`, `makeFakeClient`, `startApp` (boots Express on an ephemeral port and returns `{ baseUrl, port, close }`), `rawRequest` (raw HTTP for tests that need to spoof `Host`).
