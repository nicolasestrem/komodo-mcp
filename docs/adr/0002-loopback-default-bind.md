# ADR 0002: Loopback default bind + bearer-token gate

**Status:** Accepted
**Date:** 2026-04-27

## Context

Earlier versions bound the SSE listener to `0.0.0.0:3113` with no authentication. Combined with destructive tools (`prune_system`, `destroy_stack`, `delete_server`) that the server invokes with full Komodo admin credentials, anyone reaching port 3113 could effectively run code on every Komodo-managed Docker host. A security review classified this as Critical (CVSS ~9.8).

## Decision

1. Default `MCP_BIND_HOST` is `127.0.0.1`. Operators must set `MCP_BIND_HOST=0.0.0.0` (or run in Docker, where the published-port mapping is the network boundary) to expose the server.
2. `MCP_AUTH_TOKEN` enforces bearer-token auth on `/mcp` and `/messages`. When unset, only loopback callers are admitted (a 401 with a "set MCP_AUTH_TOKEN" hint is returned otherwise). Token compare is constant-time over SHA-256 digests to avoid both timing attacks and length leaks.
3. `MCP_ALLOWED_HOSTS` (default `127.0.0.1,localhost`) and `MCP_ALLOWED_ORIGINS` enforce a strict allow-list on `Host` and `Origin` headers — defense in depth against DNS-rebinding even when bound to loopback.
4. `/health` remains anonymous so Docker healthchecks and reverse proxies can probe.

**Current implementation note (2026-07-13):** The same auth and Origin/Host gates protect all mounted MCP HTTP entry points: `/mcp`, legacy `/sse`, and legacy `/messages`. CORS exposes `mcp-session-id` for streamable browser clients without exposing credentials.

## Consequences

- ✅ The default no-config experience is "secure by accident": fresh checkouts only accept loopback.
- ✅ Production deployments need to make a deliberate choice (set a token, expand the host allow-list).
- ⚠️ Breaking change for anyone running the previous version with port-forwarding — flagged in CHANGELOG as breaking.
- ⚖️ `Host` header strictness can surprise operators behind reverse proxies; documented in `docs/DEPLOYMENT.md` with the canonical proxy example.
