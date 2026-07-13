# Komodo MCP Server Documentation

An MCP (Model Context Protocol) server providing AI assistants with full access to the Komodo Docker/container management API.

## Quick Navigation

| Document | Description |
|---|---|
| [Architecture](ARCHITECTURE.md) | System design, request flow, session lifecycle, reliability |
| [API Reference](API.md) | All 35 MCP tools with operations, annotations, and parameters |
| [Deployment Guide](DEPLOYMENT.md) | Threat model, reverse-proxy topology, env vars, Docker |
| [Development Guide](DEVELOPMENT.md) | Setup, registry-based tool authoring, testing |
| [Runbook](RUNBOOK.md) | Token rotation, draining, rollback, common error paths |
| [ADRs](adr/) | Architecture decision records |

## Overview

Komodo MCP Server enables AI assistants (like Claude) to manage Docker stacks, containers, and servers through the Komodo Core API. The server exposes **35 tools** organized into three categories:

- **Read Operations (15 tools)** — list/get/inspect resources
- **Execute Operations (12 tools)** — deploy, start, stop, restart, prune
- **Write Operations (8 tools)** — create, update, delete stacks/servers

## Quick Start

### Streamable HTTP (recommended)

```bash
git clone https://github.com/nicolasestrem/komodo-mcp.git
cd komodo-mcp
export KOMODO_ADDRESS=http://host.docker.internal:9120
export KOMODO_API_KEY='YOUR_KEY'
export KOMODO_API_SECRET='YOUR_SECRET'
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
```

Plain `docker compose` loads the local-development override and passes these variables into the container. Endpoint: `http://127.0.0.1:3113/mcp` (published on host loopback by default). Send `Authorization: Bearer $MCP_AUTH_TOKEN`; Docker requests cross a container-network boundary even when the published host port is loopback-only.

### Stdio (Claude Desktop)

```bash
MCP_TRANSPORT=stdio \
KOMODO_ADDRESS=http://your-komodo:9120 \
KOMODO_API_KEY=… KOMODO_API_SECRET=… \
node dist/index.js
```

## Features

- Streamable HTTP (default), legacy SSE, and stdio transports.
- Per-session `McpServer`; no cross-session MCP state, with one shared Komodo adapter and connection pool across HTTP sessions.
- Streamable sessions are created only by initialize requests; unknown session IDs return 404, and CORS exposes `mcp-session-id` to browser clients.
- HTTP sessions are capped at 100 by default (`MCP_MAX_SESSIONS`).
- Resettable 30-minute idle cleanup for streamable and legacy SSE sessions (`MCP_SESSION_IDLE_TIMEOUT_MS`).
- Bearer-token auth with constant-time SHA-256 compare; loopback-only fallback.
- Helmet + CORS + Origin/Host allow-list (DNS-rebinding defense).
- Pino structured logs with header redaction.
- Strict Zod input bounds; `update_*` rejects secret-like keys.
- Official `komodo_client@2.1.1` calls to `POST /read/<Operation>`, `/write/<Operation>`, and `/execute/<Operation>` with params bodies and API-key headers.
- Process-wide connection pooling (`undici.Agent`), concurrency cap (`p-limit`), absolute request deadline, response-size limit, and secret redaction.
- No automatic retries: every upstream operation is attempted once.
- `SIGTERM`/`SIGINT` graceful shutdown closes sessions before the shared adapter, bounded by a hard timer started before cleanup.

## Requirements

- Node.js 20.0.0 or higher
- Komodo Core API access with API key/secret
- Network connectivity to Komodo server

## License

The repository declares the MIT License; see [LICENSE](../LICENSE) for details.

The official `komodo_client@2.1.1` package declares GPL-3.0. Redistribution scenarios need a separate licensing review; this statement is not a legal conclusion.
