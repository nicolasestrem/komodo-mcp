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
3. After session cleanup, `closeAll()` closes the shared Komodo adapter and its Undici Agent.

The 15-second hard-exit timer starts before either HTTP or session cleanup, so a hung close cannot extend the grace period indefinitely.

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

Sessions are lost on rollback. Streamable HTTP clients must reconnect and initialize a new session.

## `/health` is failing

`/health` is anonymous and returns `{ status, transport, port }`. Failure modes:

| Symptom | Likely cause | Fix |
|---|---|---|
| Connection refused | Process not listening yet (still starting) or `MCP_BIND_HOST` wrong | Wait for `start_period`; check `MCP_BIND_HOST=0.0.0.0` inside Docker |
| 200 but tool results report an upstream error | Komodo Core unreachable; `KOMODO_ADDRESS` wrong | Test `curl $KOMODO_ADDRESS` from inside the container |
| 503 on `/mcp` or `/sse` | The process reached `MCP_MAX_SESSIONS` | Let idle cleanup run, reconnect later, or raise the session cap |
| Container OOM-killed | Memory limit too low; too many sessions or large responses | Raise the memory limit or lower `MCP_MAX_SESSIONS`, `KOMODO_MAX_RESPONSE_BYTES`, and `KOMODO_MAX_CONCURRENCY` |

## Stuck sessions

Streamable HTTP and legacy SSE sessions are stored in in-process maps. Each session has a resettable idle timer: activity restarts it, and cleanup runs after `MCP_SESSION_IDLE_TIMEOUT_MS` (default `1800000`, or 30 minutes), even if a disconnected client never closes cleanly.

Symptoms: a client receives `404 Session not found` on a previously valid streamable session ID, or an SSE client loses its session after being inactive longer than the configured timeout. The healthcheck remains green because expired sessions are an expected lifecycle event.

Fix:

- Reinitialize/reconnect the MCP client; an unknown streamable session ID intentionally returns 404 and never creates a replacement session.
- If legitimate operations sit idle longer than 30 minutes, raise `MCP_SESSION_IDLE_TIMEOUT_MS` and roll the container. The value must be a positive integer in milliseconds.
- If sessions remain resident beyond the configured timeout, inspect for event-loop stalls and session close errors, then restart the container if cleanup cannot recover. Sessions are not durable across restarts.

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

Pino writes JSON to stderr. HTTP completion logs include request metadata and response time; session lifecycle logs include `sessionId`. `Authorization`, `X-Api-Key`, and `X-Api-Secret` fields are redacted as `[redacted]`.

For aggregated logs, ship stderr to your log pipeline (Loki, ELK, Datadog) — Docker captures it automatically.

A `/metrics` endpoint is not included today.

Upstream calls are attempted once. There is no retry setting; investigate the original network or Komodo error instead of expecting automatic recovery. Tune `KOMODO_TIMEOUT_MS`, `KOMODO_MAX_CONCURRENCY`, and `KOMODO_MAX_RESPONSE_BYTES` when needed. This is intentional per [ADR 0005](adr/0005-official-client-no-retry-adapter.md), which supersedes ADR 0003.

## Known limitations

- Multi-replica deployments require sticky sessions (per-`mcp-session-id`). No external session store yet.
- Token rotation requires a restart (no dual-token validation).
- No readiness probe that round-trips to Komodo Core (only liveness).
- No audit log of tool invocations beyond Pino request logs.
- No rate limiting; a misbehaving client can DoS Komodo Core through this server.
- The official `komodo_client@2.1.1` runtime dependency is GPL-3.0; redistribution of production bundles or images requires a GPL-3.0 compliance review.
