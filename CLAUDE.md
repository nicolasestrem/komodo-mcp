Never mark a task complete without pasting the verbatim output of the verification command (tests, build, lint, or run). No summary, no paraphrase � the raw output.
Never stub, mock, hardcode expected values, or insert placeholder code (TODO, pass, ...) to make something appear to work. If blocked, stop and ask.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Komodo MCP Server - An MCP (Model Context Protocol) server providing AI assistants with full access to the Komodo Docker/container management API. Supports 35 tools across read, execute, and write operations via stdio or SSE transports.

## Build & Development Commands

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode (auto-rebuild on changes)
npm start          # Run the compiled server
npm run clean      # Remove dist/ directory
```

### Docker

```bash
docker compose up -d             # Build and run in Docker
docker build -t komodo-mcp .     # Build image only
```

## Architecture

```
src/
├── index.ts           # Entry point - SSE/stdio transport setup, Express server
├── server.ts          # MCP server factory - creates McpServer and registers tools
├── komodo-client.ts   # Komodo API client - HTTP calls to Komodo Core API
└── tools/
    ├── read.ts        # 15 read tools (list, get, inspect operations)
    ├── execute.ts     # 12 execute tools (deploy, start, stop, prune operations)
    └── write.ts       # 8 write tools (create, update, delete operations)
```

**Request Flow**: MCP Client → SSE/stdio transport → McpServer → Tool handler → KomodoClient → Komodo Core API

**Transport Selection**: Set `MCP_TRANSPORT=stdio` for local usage or leave default `sse` for Docker/network. SSE server exposes:
- `/sse` - SSE connection endpoint
- `/messages` - Client-to-server message endpoint
- `/health` - Health check

## Tool Registration Pattern

Tools are registered in `tools/*.ts` using `server.tool()` with Zod schemas for parameter validation. Each tool calls a corresponding `KomodoClient` method and returns JSON-stringified results.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KOMODO_ADDRESS` | Komodo Core API URL (required) |
| `KOMODO_API_KEY` | API key from Komodo Settings → API Keys (required) |
| `KOMODO_API_SECRET` | API secret (required) |
| `MCP_PORT` | SSE server port (default: 3113) |
| `MCP_TRANSPORT` | Transport type: `sse` (default) or `stdio` |

## Komodo API Endpoints

The KomodoClient makes POST requests to three endpoints:
- `/read` - Non-mutating queries (ListStacks, GetContainerLog, etc.)
- `/execute` - Runtime operations (DeployStack, StartContainer, etc.)
- `/write` - Configuration changes (CreateStack, UpdateServer, etc.)

All requests include `X-Api-Key` and `X-Api-Secret` headers with JSON body `{type: "OperationType", params: {...}}`.
