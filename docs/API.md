# API Reference

Complete reference for all MCP tools provided by Komodo MCP Server.

## Tool annotations

Each tool exposes MCP annotations that compatible clients (Claude Code, Inspector, …) use to drive UI affordances and confirmation prompts:

- **`readOnlyHint: true`** — read tools that don't mutate state.
- **`idempotentHint: true`** — execute/write tools that are safe to repeat.
- **`destructiveHint: true`** — `komodo_destroy_stack`, `komodo_prune_*`, `komodo_delete_*`, `komodo_write_stack_contents`. Clients should require explicit confirmation before invoking these.
- **`openWorldHint: true`** — set on every tool because Komodo state can change between invocations.

## Auth & transport

Tool calls reach the server via Streamable HTTP (`POST /mcp`, default), legacy SSE (`/sse` + `/messages`), or stdio. When `MCP_AUTH_TOKEN` is configured, every HTTP caller must send it; when it is unset, only loopback callers are admitted — see [`DEPLOYMENT.md`](DEPLOYMENT.md). Each HTTP session owns an isolated `McpServer` while sharing one upstream adapter. Unknown sessions return 404, idle sessions expire after `MCP_SESSION_IDLE_TIMEOUT_MS` (30 minutes by default), and CORS exposes `mcp-session-id`.

The adapter delegates to official `komodo_client@2.1.1` calls that POST `params` bodies to `/read/<Operation>`, `/write/<Operation>`, or `/execute/<Operation>` with `X-Api-Key` / `X-Api-Secret` headers. It applies shared Undici pooling, an absolute timeout, a response-size limit, concurrency control, and secret redaction. Upstream operations are attempted once; there are no automatic retries.

## Input bounds

- `tail` (in log tools): integer 1–5000, default 100.
- `terms` (in `komodo_search_logs`): array of 1–20 strings, each ≤256 characters.
- `compose_contents` / `contents`: maximum string length 256,000.
- `update_stack` / `update_server` `config`: object whose keys do **not** begin with `api_key`, `api_secret`, `password`, `secret`, `webhook_secret`, or `token` (case-insensitive, with `_`/`-` variants).

---

<!-- BEGIN AUTOGEN: tool catalog -->

_This section is generated from `src/tools/registry.ts`. Do not edit by hand — run `npm run docs:api`._

Total tools: **35** (read 15, execute 12, write 8).

## Read Operations (15 tools)

### `komodo_list_servers`

**List Komodo servers** — List all Komodo servers with their status and configuration

- **Endpoint**: `read`
- **Operation**: `ListServers`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**: none

### `komodo_list_stacks`

**List Komodo stacks** — List all Komodo stacks with their current state (running/down)

- **Endpoint**: `read`
- **Operation**: `ListStacks`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**: none

### `komodo_list_deployments`

**List deployments** — List all Komodo deployments

- **Endpoint**: `read`
- **Operation**: `ListDeployments`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**: none

### `komodo_get_stack`

**Get stack details** — Get detailed information about a specific stack

- **Endpoint**: `read`
- **Operation**: `GetStack`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_get_stack_log`

**Get stack log** — Get deployment logs for a stack

- **Endpoint**: `read`
- **Operation**: `GetStackLog`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |
| `services` | `array` | no | `[]` | max 100 entries; each string min length 1, max length 256 | — |
| `tail` | `number` | no | `100` | min 1; max 5000; integer | — |
| `timestamps` | `boolean` | no | `false` | — | — |

### `komodo_get_container_log`

**Get container log** — Get logs from a specific container

- **Endpoint**: `read`
- **Operation**: `GetContainerLog`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |
| `tail` | `number` | no | `100` | min 1; max 5000; integer | Number of lines to return (default: 100, max: 5000) |

### `komodo_list_containers`

**List containers** — List all Docker containers on a server

- **Endpoint**: `read`
- **Operation**: `ListDockerContainers`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_inspect_container`

**Inspect container** — Get detailed information about a container

- **Endpoint**: `read`
- **Operation**: `InspectDockerContainer`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |

### `komodo_get_system_stats`

**Get system stats** — Get system statistics for a server (CPU, memory, disk)

- **Endpoint**: `read`
- **Operation**: `GetSystemStats`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_list_images`

**List Docker images** — List all Docker images on a server

- **Endpoint**: `read`
- **Operation**: `ListDockerImages`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_list_networks`

**List Docker networks** — List all Docker networks on a server

- **Endpoint**: `read`
- **Operation**: `ListDockerNetworks`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_list_volumes`

**List Docker volumes** — List all Docker volumes on a server

- **Endpoint**: `read`
- **Operation**: `ListDockerVolumes`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_get_alerts`

**Get system alerts** — List all system alerts

- **Endpoint**: `read`
- **Operation**: `ListAlerts`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**: none

### `komodo_search_logs`

**Search container logs** — Search container logs for specific terms

- **Endpoint**: `read`
- **Operation**: `SearchContainerLog`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |
| `terms` | `array` | yes | — | min 1 entries; max 20 entries; each string max length 256 | Search terms to find in logs (1-20 entries, max 256 chars each) |

### `komodo_get_stack_services`

**Get stack services** — List services configured for a stack

- **Endpoint**: `read`
- **Operation**: `ListStackServices`
- **Annotations**: `readOnlyHint`, `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

## Execute Operations (12 tools)

### `komodo_deploy_stack`

**Deploy stack** — Deploy or redeploy a stack (pulls images and starts containers)

- **Endpoint**: `execute`
- **Operation**: `DeployStack`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_start_stack`

**Start stack** — Start a stopped stack

- **Endpoint**: `execute`
- **Operation**: `StartStack`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_stop_stack`

**Stop stack** — Stop a running stack (keeps containers, just stops them)

- **Endpoint**: `execute`
- **Operation**: `StopStack`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_restart_stack`

**Restart stack** — Restart a stack

- **Endpoint**: `execute`
- **Operation**: `RestartStack`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_destroy_stack`

**Destroy stack** — Destroy a stack (stops and removes containers). WARNING: destructive.

- **Endpoint**: `execute`
- **Operation**: `DestroyStack`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_pull_stack`

**Pull stack images** — Pull latest images for a stack without deploying

- **Endpoint**: `execute`
- **Operation**: `PullStack`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |

### `komodo_start_container`

**Start container** — Start a specific container

- **Endpoint**: `execute`
- **Operation**: `StartContainer`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |

### `komodo_stop_container`

**Stop container** — Stop a specific container

- **Endpoint**: `execute`
- **Operation**: `StopContainer`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |

### `komodo_restart_container`

**Restart container** — Restart a specific container

- **Endpoint**: `execute`
- **Operation**: `RestartContainer`
- **Annotations**: `idempotentHint`, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |
| `container` | `string` | yes | — | — | Container name or ID |

### `komodo_prune_images`

**Prune Docker images** — Remove unused Docker images from a server

- **Endpoint**: `execute`
- **Operation**: `PruneImages`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_prune_networks`

**Prune Docker networks** — Remove unused Docker networks from a server

- **Endpoint**: `execute`
- **Operation**: `PruneNetworks`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

### `komodo_prune_system`

**Prune Docker system** — Full Docker system prune (images, networks, volumes, build cache). WARNING: destructive.

- **Endpoint**: `execute`
- **Operation**: `PruneSystem`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `server` | `string` | yes | — | — | Server name or ID |

## Write Operations (8 tools)

### `komodo_create_stack`

**Create stack** — Create a new stack in Komodo

- **Endpoint**: `write`
- **Operation**: `CreateStack`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `name` | `string` | yes | — | min length 1; max length 256 | Name for the new stack |
| `server_id` | `string` | yes | — | min length 1 | Server ID to deploy the stack on |
| `compose_contents` | `string` | no | — | max length 256000 | Docker Compose file contents (YAML) |

### `komodo_update_stack`

**Update stack** — Update stack configuration. Secret-like keys (api_key, password, etc.) are rejected.

- **Endpoint**: `write`
- **Operation**: `UpdateStack`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes | — | — | Resource ID |
| `config` | `record` | yes | — | — | Configuration object to update (must not contain secret-like keys) |

### `komodo_delete_stack`

**Delete stack** — Delete a stack from Komodo. WARNING: permanently removes the stack.

- **Endpoint**: `write`
- **Operation**: `DeleteStack`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes | — | — | Resource ID |

### `komodo_write_stack_contents`

**Write stack contents** — Write or update the Docker Compose file contents for a stack. WARNING: overwrites existing contents.

- **Endpoint**: `write`
- **Operation**: `WriteStackFileContents`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `stack` | `string` | yes | — | — | Stack name or ID |
| `file_path` | `string` | yes | — | min length 1; max length 4096 | Path to the stack file, for example compose.yaml |
| `contents` | `string` | yes | — | max length 256000 | Docker Compose file contents (YAML) |

### `komodo_create_server`

**Create server** — Add a new server to Komodo

- **Endpoint**: `write`
- **Operation**: `CreateServer`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `name` | `string` | yes | — | min length 1; max length 256 | Name for the new server |
| `address` | `string` | yes | — | format: url | Periphery address (e.g., https://periphery:8120) |

### `komodo_update_server`

**Update server** — Update server configuration. Secret-like keys (api_key, password, etc.) are rejected.

- **Endpoint**: `write`
- **Operation**: `UpdateServer`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes | — | — | Resource ID |
| `config` | `record` | yes | — | — | Configuration object to update (must not contain secret-like keys) |

### `komodo_delete_server`

**Delete server** — Permanently delete a server entry from Komodo. WARNING: removes the server record.

- **Endpoint**: `write`
- **Operation**: `DeleteServer`
- **Annotations**: **`destructiveHint`**, `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes | — | — | Resource ID |

### `komodo_rename_stack`

**Rename stack** — Rename a stack

- **Endpoint**: `write`
- **Operation**: `RenameStack`
- **Annotations**: `openWorldHint`

**Parameters**:

| Name | Type | Required | Default | Bounds | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes | — | — | Resource ID |
| `name` | `string` | yes | — | min length 1; max length 256 | New stack name |

<!-- END AUTOGEN: tool catalog -->
