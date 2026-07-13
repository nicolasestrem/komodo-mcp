# ADR 0005: Official Komodo client with a no-retry adapter

**Status:** Accepted
**Date:** 2026-07-13
**Supersedes:** [ADR 0003](0003-retry-policy-and-deadline.md)

## Context

The server formerly implemented Komodo HTTP serialization, error classification, and retry policy itself. That duplicated the upstream contract and left the server responsible for deciding whether failed read, write, and execute operations were safe to replay.

Komodo publishes the typed `komodo_client` package. Version 2.1.1 sends API-key-authenticated requests as `POST /read/<Operation>`, `POST /write/<Operation>`, or `POST /execute/<Operation>`, with the operation params object as the JSON body. Using that package makes the upstream request shape an official dependency contract rather than a locally maintained approximation.

The official package uses the process-wide `fetch` dispatcher and does not expose the transport controls this service requires: bounded concurrency, connection-pool ownership, one absolute request deadline, response-size limiting, and application-specific secret redaction.

## Decision

- Use `komodo_client@2.1.1` for typed read, write, and execute calls.
- Keep a narrow process-owned adapter around it. The adapter installs an Undici dispatcher backed by a pooled `Agent`, limits in-flight calls with `p-limit`, enforces an absolute request deadline and maximum response size, and redacts the configured API key and secret from errors and inspection output.
- Attempt each operation exactly once. The adapter never retries any endpoint or error class, and exposes no retry configuration.
- Share one adapter across all HTTP sessions while retaining a separate `McpServer` and transport for every MCP session, as required by ADR 0001.
- During shutdown, close all sessions before closing the shared adapter, which restores the previous global dispatcher and closes its Agent. Track dispatcher predecessor links so multiple adapter instances can close out of order without restoring a closed Agent.

## Consequences

- ✅ Request paths, params bodies, API-key headers, and operation types follow the official client contract.
- ✅ Write and execute operations cannot be duplicated by a retry decision made in this server.
- ✅ All HTTP sessions share the concurrency budget and connection pool while their MCP state stays isolated.
- ✅ Deadline and response-size bounds apply to the official client's `fetch` calls without forking the package.
- ⚖️ Transient upstream failures surface immediately; callers must decide whether a later operation is safe to repeat.
- ⚠️ The adapter changes the process-wide Undici dispatcher for its lifetime. The service therefore owns one adapter and restores the prior dispatcher when it closes.
- ⚠️ `komodo_client@2.1.1` declares GPL-3.0. Redistribution implications require a separate licensing review; this ADR does not state a legal conclusion.
