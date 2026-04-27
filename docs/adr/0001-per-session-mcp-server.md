# ADR 0001: One McpServer per session

**Status:** Accepted
**Date:** 2026-04-27

## Context

The MCP SDK's `McpServer` was historically constructed once at process start and connected to every new client transport. That design works for a single-client stdio process but breaks for HTTP transports where multiple clients can be active simultaneously: notifications fan out to the wrong session, request-id counters collide, and `transport.onclose` overwrites internal state shared between sessions. A code review identified this as a confidentiality/integrity bug — long-running tool results from session A could surface in session B.

## Decision

Each new HTTP session (Streamable HTTP `/mcp` initialize, or legacy `/sse`) instantiates its own `McpServer` via `createServer()`. The `KomodoClient` is shared across sessions because it is stateless aside from the connection pool and concurrency semaphore.

## Consequences

- ✅ Sessions are completely isolated. A panic or `transport.close()` in one session cannot affect another.
- ✅ The `closeAll()` shutdown path can iterate sessions cleanly.
- ⚖️ Higher per-session memory: each `McpServer` holds the registered tools table. The 35-tool registry is small (~50 KB), acceptable.
- ⚠️ A re-entry guard is needed in the cleanup path because `transport.close()` triggers `onclose` which calls `server.close()` which can call `transport.close()` again. Implemented via a `closing` boolean on each session.
