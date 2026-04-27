# Runbook

Operational procedures for Komodo MCP Server.

## Token rotation

Sessions are stateful and tied to the in-memory token. Rotating `MCP_AUTH_TOKEN` requires a restart and drops every active session.

```bash
# 1) Generate a new token and write it where the server reads from.
NEW=$(openssl rand -hex 32)
echo "$NEW" > secrets/mcp_auth_token

# 2) Roll the container.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate komodo-mcp

# 3) Distribute $NEW to every MCP client (.mcp.json `Authorization` header).
```

For zero-downtime rotation we'd need dual-token validation (`MCP_AUTH_TOKEN` + `MCP_AUTH_TOKEN_NEXT`); not implemented yet.

## Drain a node before deploy

`SIGTERM` triggers graceful shutdown:

1. `httpServer.close()` stops accepting new connections; in-flight HTTP requests finish.
2. `closeAll()` iterates the streamable + SSE session maps and calls `server.close()` on each.
3. After 15 s a hard exit fires (configurable via the `setTimeout(...).unref()` in `src/index.ts`).

In Docker:

```bash
docker compose stop -t 30 komodo-mcp   # 30 s grace matches stop_grace_period
```

If a deploy must complete before clients reconnect, drain by:

1. Remove the container from the upstream LB pool (or stop the service unit).
2. Wait for the SIGTERM handler to drain — watch logs for `shutdown initiated` followed by per-session `streamable session closed`.
3. Restart with the new image.

## Roll back to a previous image

```bash
# 1) Find the desired tag.
docker pull ghcr.io/nicolasestrem/komodo-mcp:vPREV

# 2) Update the running compose to use it.
sed -i 's|komodo-mcp:latest|komodo-mcp:vPREV|' docker-compose.yml
docker compose up -d komodo-mcp
```

Sessions are lost on rollback. Clients on Streamable HTTP will reconnect automatically.

## `/health` is failing

`/health` is anonymous and returns `{ status, transport, port }`. Failure modes:

| Symptom | Likely cause | Fix |
|---|---|---|
| Connection refused | Process not listening yet (still starting) or `MCP_BIND_HOST` wrong | Wait for `start_period`; check `MCP_BIND_HOST=0.0.0.0` inside Docker |
| 200 but tool calls 500 | Komodo Core unreachable; `KOMODO_ADDRESS` wrong | Test `curl $KOMODO_ADDRESS` from inside the container |
| 503 / OOM-kill | Memory limit too low; large log responses | Raise compose `deploy.resources.limits.memory`; lower `tail` defaults; cap `KOMODO_MAX_CONCURRENCY` |

## Stuck sessions

Streamable HTTP sessions are stored in an in-process `Map`. If a client drops without proper close (network drop, kill -9 on the client), the session entry persists until the transport's `onclose` fires (typically after the next failed write).

Symptoms: growing memory, healthcheck still green, `/health` reports more sessions than active clients.

Fix: restart the container — sessions are not load-bearing across restarts.

Long-term fix (planned): periodic stale-session sweeper based on last-activity timestamp.

## 401 unauthorized on `/mcp`

1. Token mismatch — verify the client's `Authorization: Bearer …` matches the contents of `secrets/mcp_auth_token`. Pino redacts the token in request logs.
2. Non-loopback request without `MCP_AUTH_TOKEN` configured — set the token, or restrict the deployment to loopback.

## 403 forbidden host / origin

- **`forbidden host`**: the client's `Host` header isn't in `MCP_ALLOWED_HOSTS`. Add the public hostname when fronted by a reverse proxy: `MCP_ALLOWED_HOSTS=mcp.example.com,127.0.0.1,localhost`.
- **`forbidden origin`**: a browser-origin caller's `Origin` isn't in `MCP_ALLOWED_ORIGINS`. Add the expected web app origin, or remove `MCP_ALLOWED_ORIGINS` if you accept any (non-browser) caller.

## Komodo upstream auth errors

```
Komodo API read (ListServers) returned 401: invalid api key
```

- Verify `KOMODO_API_KEY` / `KOMODO_API_SECRET` (or `*_FILE` paths) match a valid key in Komodo Settings → API Keys.
- The MCP error message has the secret values redacted; cross-reference against Komodo's audit log if needed.

## Deploying behind a different Komodo

Set `KOMODO_ADDRESS` (or `KOMODO_ADDRESS_FILE`) to the new URL and roll the container. The address is parsed at startup and trailing slashes are normalized; non-`http(s)` schemes are rejected.

## Observability

Pino writes JSON to stderr. Each request log line includes `req.id`, `remoteAddress`, `responseTime`, and (on streamable) `sessionId`. `Authorization`, `X-Api-Key`, `X-Api-Secret` are redacted as `[redacted]`.

For aggregated logs, ship stderr to your log pipeline (Loki, ELK, Datadog) — Docker captures it automatically.

A `/metrics` endpoint is not included today. Adding `prom-client` is tracked in the project's deferred work.

## Known limitations

- Multi-replica deployments require sticky sessions (per-`mcp-session-id`). No external session store yet.
- Token rotation requires a restart (no dual-token validation).
- No readiness probe that round-trips to Komodo Core (only liveness).
- No audit log of tool invocations beyond Pino request logs.
- No rate limiting; a misbehaving client can DoS Komodo Core through this server.
