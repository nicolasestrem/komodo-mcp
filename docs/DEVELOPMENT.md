# Development Guide

Guide for setting up a development environment and contributing to Komodo MCP Server.

## Prerequisites

- Node.js **20.0.0+**
- npm
- Access to a Komodo Core API instance for manual integration testing
- Git

## Getting started

```bash
git clone https://github.com/nicolasestrem/komodo-mcp.git
cd komodo-mcp
npm install
cp .env.example .env
# fill in KOMODO_* and (for non-loopback) MCP_AUTH_TOKEN
npm run build
npm start          # streamable transport, 127.0.0.1:3113
```

Plain `docker compose up` also loads `docker-compose.override.yml`. The local
overlay leaves `MCP_AUTH_TOKEN` unset by default and relies on the loopback-only
host port mapping; it does not install a predictable development token. Set a
token explicitly if you change the listener's exposure.

## Development commands

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm run lint` | Biome lint + format check |
| `npm run format` | Biome auto-format |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | `tsc --watch` |
| `npm run dev:streamable` | Start with a dev token, streamable transport |
| `npm run dev:sse` | Start with a dev token, legacy SSE transport |
| `npm test` | Build then run all node:test cases |
| `npm start` | Run compiled server |
| `npm run clean` | Remove `dist/` |

## Project structure

```
komodo-mcp/
├── src/
│   ├── index.ts            # buildApp() factory, transports, middleware, SIGTERM
│   ├── server.ts           # createServer({ client? })
│   ├── komodo-client.ts    # Adapter over official komodo_client
│   └── tools/
│       ├── registry.ts     # 35-tool TOOLS table + registerAll()
│       └── utils.ts        # formatResult, toolHandler
├── test/
│   ├── helpers.js          # local upstream, client/app factories, raw requests
│   ├── auth.test.js        # token / Origin / Host gates
│   ├── secret-leak.test.js # secrets never appear in errors / inspect output
│   ├── tools.test.js       # 35-tool routing + Zod boundary cases
│   ├── format-result.test.js
│   ├── komodo-client.test.js
│   └── smoke.test.js       # end-to-end /mcp initialize handshake
├── dist/                   # tsc output (generated)
├── docs/
├── secrets/                # gitignored — Docker secret files
├── biome.json
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

## Adding new tools

All 35 tools are registered from a single declarative table in `src/tools/registry.ts`. Adding a tool is a one-row edit — no new files, no separate client method needed.

### 1. Append a `spec({...})` entry to `TOOLS`

```typescript
spec({
  name: "komodo_my_new_tool",
  title: "Short title for clients",
  description: "Description seen by the LLM",
  endpoint: "read",                 // "read" | "execute" | "write"
  operation: "MyNewOperation",      // Komodo operation type literal
  inputSchema: {
    server: z.string().describe("Server name or ID"),
    flag: z.boolean().optional().describe("Optional toggle"),
  },
  annotations: READ_ONLY,           // or IDEMPOTENT_WRITE / NON_IDEMPOTENT_WRITE / DESTRUCTIVE
  // Optional: shape Komodo's params from the validated input.
  // buildParams: ({ server, flag }) => ({ server, options: { flag: flag ?? false } }),
  summary: ({ server }) => `Did the thing on ${server}.`,
}),
```

The handler will be wired through `toolHandler` (so any thrown error becomes an MCP `isError` result) and call `client.call(t.endpoint, t.operation, params)` automatically. The official client sends these operations to `/read/<Operation>`, `/write/<Operation>`, or `/execute/<Operation>`.

### 2. Add a wrapper on `KomodoClient` (optional)

Wrappers are kept for backward-compat callers but the registry uses the generic `client.call(...)` directly. Skip the wrapper unless something outside the registry needs to call this op.

### 3. Test

Append a row to the `cases` table in `test/tools.test.js` and any new boundary cases (e.g. Zod rejections). Run `npm test` — the registry test pins the tool count, routing, and annotation presets.

### 4. Document

Add the tool to README.md's tool tables and `docs/API.md`.

## Code style

- **Biome** for lint + format. Run `npm run lint` and `npm run format` before committing.
- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, etc.).
- **Tool names**: `komodo_snake_case`.
- **Class names**: `PascalCase`. **Files**: `kebab-case.ts`. **Functions**: `camelCase`.
- **Zod**: always include `.describe()` for AI context. Use bounded primitives (`min`, `max`, `int`, etc.) — avoid `z.string()` without bounds for user-supplied content.

## Testing

`npm test` runs `tsc` and then all `node --test` cases under `test/`.

### Test layout

- `test/auth.test.js` — verifies `requireAuth`, `validateOriginAndHost`, `X-Powered-By` suppression, anonymous `/health`. Uses `startApp(env)` to boot a fresh Express app on an ephemeral port and `rawRequest` for tests that need to spoof the `Host` header (which `fetch` won't allow).
- `test/secret-leak.test.js` — uses a disposable local upstream that echoes `apiKey`/`apiSecret` and asserts the values never appear in thrown messages, `JSON.stringify(client)`, or `util.inspect(client)`.
- `test/tools.test.js` — drives the registry with a Proxy-recording fake client. Asserts (a) 35 tools registered, (b) read tools carry `readOnlyHint`, destructive tools carry `destructiveHint`, (c) every tool routes to `client.call(endpoint, operation, params)` correctly, (d) `update_*` rejects secret-like config keys, (e) log `tail` is bounded to 1–5000 and other input bounds are enforced, (f) `buildParams` nesting is correct, (g) handler exceptions surface as MCP `isError`.
- `test/format-result.test.js` — `formatResult` branches and `toolHandler` error/success paths.
- `test/komodo-client.test.js` — drives the official `komodo_client@2.1.1` adapter against a disposable local HTTP upstream. It verifies current request paths and API-key headers, single-attempt writes, absolute timeout, response-size enforcement, address validation, and `fromEnv` tuning.
- `test/smoke.test.js` — boots the server and covers the MCP initialize handshake, session-header exposure, unknown-session handling, and idle session expiry.

### Test helpers (`test/helpers.js`)

- `makeClient({ ... })` — constructs the adapter with safe test defaults.
- `startUpstream(handler)` — starts a disposable local HTTP server for real adapter integration tests.
- `makeFakeClient(stubResult)` — Proxy-based fake `KomodoClient` recording every method call.
- `startApp(env, options)` — boots `buildApp()` on an ephemeral port. Re-imports `dist/index.js` with a cache-buster query string so module-level env reads pick up the override.
- `rawRequest({ port, path, method, headers, body })` — raw `node:http` request for tests that need to override the `Host` header.

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# or against a running streamable server:
npx @modelcontextprotocol/inspector --uri http://127.0.0.1:3113/mcp \
   --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

## Testing with curl

### Streamable HTTP (default)

```bash
TOKEN=$(cat secrets/mcp_auth_token)
SID=$(curl -sN -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3113/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  -D /tmp/h | grep -i mcp-session-id /tmp/h | awk '{print $2}' | tr -d '\r')
echo "session: $SID"

curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SID" \
  -X POST http://127.0.0.1:3113/mcp \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### Health

```bash
curl http://127.0.0.1:3113/health
```

## Debugging

### Logs

Pino writes structured JSON to **stderr**. Pretty-print locally with:

```bash
node dist/index.js | npx pino-pretty       # if you want pretty output via a sink
# or
LOG_LEVEL=debug node dist/index.js
```

### Common issues

1. **`Missing required environment variables`** — ensure `KOMODO_ADDRESS`/`KOMODO_API_KEY`/`KOMODO_API_SECRET` are set, or use the `*_FILE` variants pointing at readable files.
2. **`401 unauthorized`** on `/mcp` — token mismatch, or the request came from a non-loopback IP without a token configured. Check pino logs for the request `remoteAddress`.
3. **`403 forbidden host`** — `Host` header isn't in `MCP_ALLOWED_HOSTS`. Add the public hostname when fronted by a reverse proxy.
4. **`500 internal error`** during the very first `/mcp` POST — usually `KomodoClient.fromEnv()` failing because env is incomplete. Check stderr.
5. **Session disappeared after inactivity** — HTTP sessions are held in memory and expire after `MCP_SESSION_IDLE_TIMEOUT_MS` (30 minutes by default). Reinitialize the MCP connection; legacy SSE clients must reconnect.

## Building the Docker image

```bash
docker build -t komodo-mcp .
docker run --rm \
  -e KOMODO_ADDRESS=http://host.docker.internal:9120 \
  -e KOMODO_API_KEY=… -e KOMODO_API_SECRET=… \
  -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  -p 127.0.0.1:3113:3113 \
  komodo-mcp
```

For production, prefer `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
