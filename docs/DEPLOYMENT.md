# Deployment Guide

Production deployment and configuration guide for Komodo MCP Server.

## Threat Model

This server holds Komodo admin credentials. A successful tool invocation can deploy code, prune systems, destroy stacks, or delete server records on every Komodo-managed host. Treat the listener as privileged and protect it accordingly.

| Asset | Adversary | Mitigation |
|---|---|---|
| `KOMODO_API_KEY` / `KOMODO_API_SECRET` (root over Komodo) | Anyone with TCP reach to the listener | `MCP_AUTH_TOKEN` (required for non-loopback); loopback-only default bind |
| Same | Browser tricked via DNS rebinding to 127.0.0.1 | `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` allow-lists; Helmet |
| Token in transit | Network sniffer | TLS-terminating reverse proxy (TLS not done in-process) |
| Secrets in error messages / logs | Operator copy-paste, log shippers | Pino redaction; `KomodoClient` redacts secrets in error messages, custom `toJSON`/`util.inspect` |
| Credential exfiltration via misconfigured `KOMODO_ADDRESS` | Operator typo, supply-chain attack | URL parse + http(s) scheme check at construction |

Out of scope: per-tool authorization, audit log of tool invocations beyond pino request logs, multi-tenant isolation.

## Deployment options

| Method | Transport | Use case |
|---|---|---|
| `npx komodo-mcp` (after publish) or `node dist/index.js` | streamable / stdio | Local CLI, direct integration |
| Docker | streamable / sse | Containerized deployment |
| Docker Compose (prod profile) | streamable | Hardened production runtime fronted by a reverse proxy |

## Environment variables

### Komodo upstream
| Variable | Required | Default | Notes |
|---|---|---|---|
| `KOMODO_ADDRESS` | yes | — | http(s) only. Trailing slash normalized. |
| `KOMODO_API_KEY` | yes | — | Or `KOMODO_API_KEY_FILE` for Docker secrets. |
| `KOMODO_API_SECRET` | yes | — | Or `KOMODO_API_SECRET_FILE`. |
| `KOMODO_TIMEOUT_MS` | no | 30000 | Single deadline shared across retries. |
| `KOMODO_MAX_RETRIES` | no | 2 | Read-op retries for 5xx/429/transient. |
| `KOMODO_MAX_CONCURRENCY` | no | 8 | In-flight semaphore. |

### MCP server
| Variable | Required | Default | Notes |
|---|---|---|---|
| `MCP_TRANSPORT` | no | `streamable` | `streamable` (recommended), `sse` (legacy), `stdio`. |
| `MCP_PORT` | no | 3113 | |
| `MCP_BIND_HOST` | no | `127.0.0.1` | Use `0.0.0.0` inside Docker (port mapping is the boundary). |
| `MCP_AUTH_TOKEN` | conditional | unset | Required for any non-loopback access. Or `MCP_AUTH_TOKEN_FILE`. |
| `MCP_ALLOWED_ORIGINS` | no | unset | Comma-separated. Empty = no `Origin` enforcement. |
| `MCP_ALLOWED_HOSTS` | no | `127.0.0.1,localhost` | Comma-separated. DNS-rebinding defense. |
| `LOG_LEVEL` | no | `info` | Pino level. |

## Getting Komodo API credentials

1. Log into the Komodo web UI.
2. **Settings → API Keys → Create API Key**.
3. Copy the key and secret (the secret is only shown once).

## Deployment methods

### Method 1: Streamable HTTP via Docker (recommended)

Compose ships two files:

- `docker-compose.yml` — base configuration (loopback host port mapping, file-based secrets, `MCP_BIND_HOST=0.0.0.0` inside the container).
- `docker-compose.prod.yml` — overrides hardening: `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, resource limits.

```bash
mkdir -p secrets
openssl rand -hex 32 > secrets/mcp_auth_token
echo "$KOMODO_API_KEY"    > secrets/komodo_api_key
echo "$KOMODO_API_SECRET" > secrets/komodo_api_secret
chmod 600 secrets/*

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

By default the host binding is `127.0.0.1:3113:3113` — the port is reachable on localhost only. Front it with a reverse proxy that terminates TLS for public access.

### Method 2: Streamable HTTP via npm

```bash
npm install
npm run build
MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
KOMODO_ADDRESS=http://komodo:9120 \
KOMODO_API_KEY=... KOMODO_API_SECRET=... \
node dist/index.js
```

### Method 3: stdio (local CLI / Claude Desktop)

Stdio transport runs without an HTTP listener — auth is implicit (the OS pipes are local). Logs go to stderr.

```bash
MCP_TRANSPORT=stdio \
KOMODO_ADDRESS=http://komodo:9120 \
KOMODO_API_KEY=... KOMODO_API_SECRET=... \
node dist/index.js
```

### Method 4: Legacy SSE (`MCP_TRANSPORT=sse`)

Two endpoints (`/sse` + `/messages`) for clients that don't speak Streamable HTTP. Keep this only for transitional compatibility.

## Transport modes

| Mode | Endpoint(s) | Connections | Notes |
|---|---|---|---|
| streamable (default) | `POST/GET/DELETE /mcp` | Many; per-session McpServer | Recommended. Supports SSE upstream + JSON. |
| sse (legacy) | `GET /sse`, `POST /messages?sessionId=…` | Many; per-session McpServer | Legacy. Slated for removal in a future major. |
| stdio | (none) | Single | Local CLI; logs on stderr. |

## Reverse-proxy topology (canonical for non-loopback)

```
Internet ──TLS──> nginx/Traefik ──http──> komodo-mcp (127.0.0.1:3113)
                                          │
                                          └─ KOMODO_ADDRESS=http://komodo-core:9120
```

The MCP container should bind only on the loopback interface of the host (handled by the compose override `127.0.0.1:3113:3113`), and the reverse proxy is the only thing that listens publicly.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.com;
    ssl_certificate     /etc/letsencrypt/live/mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.example.com/privkey.pem;

    location /mcp {
        proxy_pass http://127.0.0.1:3113;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;        # SSE upstream
        proxy_read_timeout 86400s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3113;
    }
}
```

Then set `MCP_ALLOWED_HOSTS=mcp.example.com,127.0.0.1,localhost`.

### Traefik

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.komodo-mcp.rule=Host(`mcp.example.com`)
  - traefik.http.routers.komodo-mcp.tls=true
  - traefik.http.routers.komodo-mcp.tls.certresolver=letsencrypt
  - traefik.http.services.komodo-mcp.loadbalancer.server.port=3113
```

## Multi-replica caveat

Sessions are stateful in-memory (per-session `McpServer`). Streamable HTTP propagates an `mcp-session-id` header which clients send on follow-up requests; multi-replica deployments need sticky sessions keyed on that header. Until then, run single-replica or fronted by a sticky-session-aware load balancer.

## Health monitoring

`/health` is anonymous and returns:

```json
{ "status": "ok", "transport": "streamable", "port": 3113 }
```

Use this for liveness probes. There is no readiness endpoint that reaches out to Komodo Core today (planned).

## Claude Desktop integration

Add to your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "komodo": {
      "command": "node",
      "args": ["/absolute/path/to/komodo-mcp/dist/index.js"],
      "env": {
        "KOMODO_ADDRESS": "http://your-komodo:9120",
        "KOMODO_API_KEY": "your-key",
        "KOMODO_API_SECRET": "your-secret",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Performance tuning

- `KOMODO_MAX_CONCURRENCY` — bound concurrent requests to Komodo Core (default 8).
- `KOMODO_MAX_RETRIES` — read retry budget; raise for flaky upstreams.
- `KOMODO_TIMEOUT_MS` — single shared deadline across retries.
- The shared `undici.Agent` keeps connections warm (30s keep-alive, 16 per-host).
- Memory: ~50–100 MB per instance idle.

## Troubleshooting

See [`docs/RUNBOOK.md`](RUNBOOK.md) for a runbook covering token rotation, draining a node before deploy, rolling back, stuck sessions, and common 401/403/500 paths.
