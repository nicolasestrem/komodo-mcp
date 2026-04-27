# Komodo MCP Server

An MCP (Model Context Protocol) server that exposes [Komodo](https://komo.do) — a Docker/container management and deployment system — to AI assistants.

## Highlights

- **35 tools** across read / execute / write categories
- **Streamable HTTP transport** (default) per the latest MCP spec, plus legacy SSE and stdio
- **Per-session `McpServer`** — concurrent clients are isolated
- **Bearer-token auth** with constant-time compare; loopback-only fallback when no token is configured
- **DNS-rebinding defense** via strict `Origin` and `Host` allow-lists
- **Helmet** security headers; **CORS** allow-list
- **Pino** structured logs with `Authorization`/`X-Api-Secret`/`X-Api-Key` redaction
- **Graceful shutdown** on `SIGTERM`/`SIGINT`
- **Strict input schemas**: bounded `tail`, `terms`, `compose_contents`; `update_stack`/`update_server` reject keys matching `secret*`/`password*`/`api_key`/`token`
- **Connection pooling** via shared `undici.Agent` (keep-alive 30s, 16 connections); per-process concurrency cap via `p-limit`

## Quick Start

### Local (loopback) with Docker Compose

```bash
git clone https://github.com/nicolasestrem/komodo-mcp.git
cd komodo-mcp
cp .env.example .env
# Edit .env with KOMODO_API_KEY / KOMODO_API_SECRET / KOMODO_ADDRESS
mkdir -p secrets
openssl rand -hex 32 > secrets/mcp_auth_token
echo "$KOMODO_API_KEY"    > secrets/komodo_api_key
echo "$KOMODO_API_SECRET" > secrets/komodo_api_secret
docker compose up -d
```

The container binds `0.0.0.0:3113` internally but `docker-compose.yml` publishes the port only to host loopback (`127.0.0.1:3113:3113`). Front it with a reverse proxy when you need network access.

### Add to Claude Code (`.mcp.json`)

**Local / loopback** (no token needed):
```json
{
  "mcpServers": {
    "komodo": {
      "type": "http",
      "url": "http://127.0.0.1:3113/mcp"
    }
  }
}
```

**Networked** (token required):
```json
{
  "mcpServers": {
    "komodo": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

### Local development (npm)

```bash
npm install
npm run build
npm start         # default streamable HTTP on 127.0.0.1:3113
npm run dev:sse   # legacy SSE transport with a dev token
```

## Configuration

### Komodo upstream

| Variable | Description | Default |
|---|---|---|
| `KOMODO_ADDRESS` | Komodo Core URL (http(s) only; trailing slash normalized) | required |
| `KOMODO_API_KEY` | API key — also reads from `KOMODO_API_KEY_FILE` for Docker secrets | required |
| `KOMODO_API_SECRET` | API secret — also reads from `KOMODO_API_SECRET_FILE` | required |
| `KOMODO_TIMEOUT_MS` | Per-request timeout (single deadline across retries) | `30000` |
| `KOMODO_MAX_RETRIES` | Max attempts for read operations (5xx/429/transient + pre-send transport errors) | `2` |
| `KOMODO_MAX_CONCURRENCY` | In-flight request semaphore | `8` |

### MCP server

| Variable | Description | Default |
|---|---|---|
| `MCP_TRANSPORT` | `streamable` (default), `sse` (legacy), or `stdio` | `streamable` |
| `MCP_PORT` | HTTP listener port | `3113` |
| `MCP_BIND_HOST` | Host to bind on | `127.0.0.1` (use `0.0.0.0` inside Docker) |
| `MCP_AUTH_TOKEN` | Bearer token (also `MCP_AUTH_TOKEN_FILE`). When **unset**, only loopback callers are admitted. | unset |
| `MCP_ALLOWED_ORIGINS` | Comma-separated `Origin` allow-list (browser CSRF defense). Empty = no `Origin` enforcement. | unset |
| `MCP_ALLOWED_HOSTS` | Comma-separated `Host`-header allow-list (DNS-rebinding defense). | `127.0.0.1,localhost` |
| `LOG_LEVEL` | Pino log level | `info` |

### Getting Komodo API credentials

1. Open the Komodo web UI
2. Go to **Settings → API Keys**
3. Click **Create API Key**, copy the key and secret

## Security model

This server holds Komodo admin credentials. A successful tool call can deploy code, prune systems, or destroy stacks on every Komodo-managed host. Treat it as privileged.

The defaults aim for "secure by accident":

- Bind is `127.0.0.1` unless explicitly opened.
- `MCP_AUTH_TOKEN` is required for any non-loopback caller.
- `Host` and `Origin` allow-lists block DNS rebinding even if a browser is tricked into reaching the loopback port.
- All requests, including loopback, go through Helmet + CORS.
- Errors emitted to MCP clients have the API key/secret scrubbed from upstream bodies.

For non-loopback deployments use a reverse proxy that terminates TLS, set a random `MCP_AUTH_TOKEN` (`openssl rand -hex 32`), and configure `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` for your domain. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Available tools

35 tools registered from a single declarative table in `src/tools/registry.ts`. Annotations are applied consistently (`readOnlyHint` on read tools, `idempotentHint` on start/stop/restart, `destructiveHint` on prune/destroy/delete/`write_stack_contents`).

### Read (15)

| Tool | Description |
|---|---|
| `komodo_list_servers` | List all connected servers |
| `komodo_list_stacks` | List stacks with state |
| `komodo_list_deployments` | List deployments |
| `komodo_get_stack` | Stack details |
| `komodo_get_stack_log` | Stack deployment logs |
| `komodo_get_container_log` | Container logs (`tail` 1–10000, default 100) |
| `komodo_list_containers` | Containers on a server |
| `komodo_inspect_container` | Inspect a container |
| `komodo_get_system_stats` | CPU/memory/disk for a server |
| `komodo_list_images` | Docker images |
| `komodo_list_networks` | Docker networks |
| `komodo_list_volumes` | Docker volumes |
| `komodo_get_alerts` | Komodo alerts |
| `komodo_search_logs` | Search container logs (1–20 terms, max 256 chars each) |
| `komodo_get_stack_services` | Stack services summary |

### Execute (12)

| Tool | Hint | Description |
|---|---|---|
| `komodo_deploy_stack` | non-idempotent | Deploy/redeploy a stack |
| `komodo_start_stack` | idempotent | Start a stopped stack |
| `komodo_stop_stack` | idempotent | Stop a running stack |
| `komodo_restart_stack` | idempotent | Restart a stack |
| `komodo_destroy_stack` | **destructive** | Stop and remove |
| `komodo_pull_stack` | idempotent | Pull latest images |
| `komodo_start_container` | idempotent | Start a container |
| `komodo_stop_container` | idempotent | Stop a container |
| `komodo_restart_container` | idempotent | Restart a container |
| `komodo_prune_images` | **destructive** | Prune unused images |
| `komodo_prune_networks` | **destructive** | Prune unused networks |
| `komodo_prune_system` | **destructive** | Full Docker system prune |

### Write (8)

| Tool | Hint | Description |
|---|---|---|
| `komodo_create_stack` | non-idempotent | Create a stack |
| `komodo_update_stack` | non-idempotent | Update stack config (rejects secret-like keys) |
| `komodo_delete_stack` | **destructive** | Delete a stack |
| `komodo_write_stack_contents` | **destructive** | Overwrite compose contents (max 256 KiB) |
| `komodo_create_server` | non-idempotent | Add a server |
| `komodo_update_server` | non-idempotent | Update server config (rejects secret-like keys) |
| `komodo_delete_server` | **destructive** | Remove a server |
| `komodo_rename_stack` | non-idempotent | Rename a stack |

## Example prompts

- "List all my Komodo stacks"
- "Show me the logs for the nginx stack"
- "Restart the wordpress stack"
- "What containers are running on my server?"
- "Deploy the staging stack"

## Development

```bash
npm install
npm run lint     # biome
npm run build    # tsc
npm test         # node:test (56 tests, includes auth/secret/tool/format/smoke)
npm run dev      # tsc --watch
```

## Architecture

```
src/
├── index.ts            # Express factory, transports, auth/Origin/Host gates, SIGTERM
├── server.ts           # createServer(client?) — DI-friendly factory
├── komodo-client.ts    # HTTP client: undici Agent, pooling, retry+jitter+single deadline
└── tools/
    ├── registry.ts     # Declarative TOOLS table + registerAll(server, client)
    └── utils.ts        # formatResult + toolHandler (errors → MCP isError)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for diagrams and the request-flow walk-through.

## API reference

The server wraps the [Komodo Core API](https://komo.do/docs/api). All Komodo requests are JSON over POST:

```bash
curl -X POST http://your-komodo:9120/read \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -H "X-Api-Secret: YOUR_SECRET" \
  -d '{"type": "ListStacks", "params": {}}'
```

## License

MIT — see [LICENSE](LICENSE).

## Links

- [Komodo documentation](https://komo.do/docs)
- [Komodo GitHub](https://github.com/moghtech/komodo)
- [MCP protocol](https://modelcontextprotocol.io)
