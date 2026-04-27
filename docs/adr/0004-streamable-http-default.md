# ADR 0004: Streamable HTTP as the default transport

**Status:** Accepted
**Date:** 2026-04-27

## Context

The MCP spec dated 2025-03-26 deprecated the SSE-based two-endpoint transport (`/sse` + `/messages`) in favor of Streamable HTTP (a single `/mcp` endpoint that handles POST + an optional SSE upstream + DELETE for session close). Modern MCP clients (Claude Code, Inspector, mcp-remote, Claude Desktop) negotiate Streamable HTTP first and fall back to SSE only when the server advertises it.

## Decision

- Default `MCP_TRANSPORT=streamable`. The server mounts a single `/mcp` route that handles all verbs.
- Legacy SSE remains available via `MCP_TRANSPORT=sse` for one minor version, after which it will be removed.
- Stdio (`MCP_TRANSPORT=stdio`) remains the canonical local-CLI transport (Claude Desktop default).
- Both HTTP transports use per-session `McpServer` (ADR 0001) and route through the same auth/Origin/Host middleware stack.

## Consequences

- ✅ One endpoint, one auth check, simpler middleware ordering.
- ✅ Streamable HTTP is more LB-friendly: clients send `mcp-session-id` headers that sticky-session ingress controllers can route on.
- ✅ Aligns with the SDK's recommended transport going forward.
- ⚖️ Existing `.mcp.json` configurations that pointed at `http://host/sse` need to update to `http://host/mcp` and switch type from `sse` to `http`. CHANGELOG flags this as breaking.
- ⚖️ Streamable sessions are still in-process state, so multi-replica deployments need sticky sessions. Documented as a known limitation; future work to externalize session state.
