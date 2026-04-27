# Komodo MCP Server Documentation

An MCP (Model Context Protocol) server providing AI assistants with full access to the Komodo Docker/container management API.

## Quick Navigation

| Document | Description |
|---|---|
| [Architecture](ARCHITECTURE.md) | System design, request flow, session lifecycle, reliability |
| [API Reference](API.md) | All 35 MCP tools with annotations, parameters, returns |
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
cp .env.example .env
# fill in KOMODO_* and (for non-loopback) MCP_AUTH_TOKEN
mkdir -p secrets
openssl rand -hex 32 > secrets/mcp_auth_token
echo "$KOMODO_API_KEY"    > secrets/komodo_api_key
echo "$KOMODO_API_SECRET" > secrets/komodo_api_secret
docker compose up -d
```

Endpoint: `http://127.0.0.1:3113/mcp` (loopback only by default).

### Stdio (Claude Desktop)

```bash
MCP_TRANSPORT=stdio \
KOMODO_ADDRESS=http://your-komodo:9120 \
KOMODO_API_KEY=… KOMODO_API_SECRET=… \
node dist/index.js
```

## Features

- Streamable HTTP (default), legacy SSE, and stdio transports.
- Per-session `McpServer`; no cross-session state.
- Bearer-token auth with constant-time SHA-256 compare; loopback-only fallback.
- Helmet + CORS + Origin/Host allow-list (DNS-rebinding defense).
- Pino structured logs with header redaction.
- Strict Zod input bounds; `update_*` rejects secret-like keys.
- Connection pooling (`undici.Agent`) and concurrency cap (`p-limit`).
- Single-deadline retry with jitter; pre-send transport errors retry on any verb.
- `SIGTERM`/`SIGINT` graceful shutdown.

## Requirements

- Node.js 20.0.0 or higher
- Komodo Core API access with API key/secret
- Network connectivity to Komodo server

## License

MIT License — see [LICENSE](../LICENSE) for details.
