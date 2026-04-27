/**
 * Declarative tool registry.
 *
 * All 35 Komodo tools are described in this single table and registered in a
 * loop, so adding/changing a tool is a one-row edit. The table also drives the
 * MCP `annotations` (read-only / idempotent / destructive hints) consistently.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { KomodoClient } from "../komodo-client.js";
import { toolHandler } from "./utils.js";

type Endpoint = "read" | "write" | "execute";

type ToolAnnotations = {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
};

type AnyZodShape = Record<string, z.ZodTypeAny>;

// Internal type used by the array. `buildParams`/`summary` are widened to `any`
// because TypeScript's contravariant function-arg checking under
// `exactOptionalPropertyTypes` will otherwise refuse to widen
// `ToolSpec<{stack: ZodString}>` to `ToolSpec<AnyZodShape>`. The `spec()`
// constructor below preserves per-spec type-checking at the definition site.
type ToolSpec = {
  name: string;
  title: string;
  description: string;
  endpoint: Endpoint;
  operation: string;
  inputSchema: AnyZodShape;
  annotations: ToolAnnotations;
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  buildParams?: (args: any) => Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  summary?: (args: any) => string;
};

type ZodObjectInfer<Shape extends AnyZodShape> = z.infer<z.ZodObject<Shape>>;

// Per-spec generic constructor — gives the literal definition type-checking
// against its own `inputSchema` while the array stores the widened shape.
type ToolSpecInput<Shape extends AnyZodShape> = {
  name: string;
  title: string;
  description: string;
  endpoint: Endpoint;
  operation: string;
  inputSchema: Shape;
  annotations: ToolAnnotations;
  buildParams?: (args: ZodObjectInfer<Shape>) => Record<string, unknown>;
  summary?: (args: ZodObjectInfer<Shape>) => string;
};

// ---------- shared schema fragments ----------

const stackArg = { stack: z.string().describe("Stack name or ID") };
const serverArg = { server: z.string().describe("Server name or ID") };
const containerArg = { container: z.string().describe("Container name or ID") };
const idArg = { id: z.string().describe("Resource ID") };

// Forbid secret-like keys in update_* config so an LLM (or attacker) can't pivot
// to credentials by stuffing arbitrary keys. Belt-and-braces alongside server-side
// validation in Komodo.
const FORBIDDEN_CONFIG_KEY =
  /^(api[_-]?key|api[_-]?secret|password|secret|webhook[_-]?secret|token)/i;
const configRecord = z
  .record(z.string(), z.unknown())
  .refine((obj) => !Object.keys(obj).some((k) => FORBIDDEN_CONFIG_KEY.test(k)), {
    message:
      "config contains a forbidden key (api_key/api_secret/password/secret/webhook_secret/token)",
  })
  .describe("Configuration object to update (must not contain secret-like keys)");

const composeContents = z
  .string()
  .max(256_000, "compose contents too large (max 256 KiB)")
  .describe("Docker Compose file contents (YAML)");

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
const IDEMPOTENT_WRITE: ToolAnnotations = { idempotentHint: true, openWorldHint: true };
const NON_IDEMPOTENT_WRITE: ToolAnnotations = { idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE: ToolAnnotations = {
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// ---------- the table ----------

export const TOOLS: ToolSpec[] = [
  // ===== READ =====
  spec({
    name: "komodo_list_servers",
    title: "List Komodo servers",
    description: "List all Komodo servers with their status and configuration",
    endpoint: "read",
    operation: "ListServers",
    inputSchema: {},
    annotations: READ_ONLY,
    summary: () => "Retrieved Komodo servers.",
  }),
  spec({
    name: "komodo_list_stacks",
    title: "List Komodo stacks",
    description: "List all Komodo stacks with their current state (running/down)",
    endpoint: "read",
    operation: "ListStacks",
    inputSchema: {},
    annotations: READ_ONLY,
    summary: () => "Retrieved stacks.",
  }),
  spec({
    name: "komodo_list_deployments",
    title: "List deployments",
    description: "List all Komodo deployments",
    endpoint: "read",
    operation: "ListDeployments",
    inputSchema: {},
    annotations: READ_ONLY,
    summary: () => "Retrieved deployments.",
  }),
  spec({
    name: "komodo_get_stack",
    title: "Get stack details",
    description: "Get detailed information about a specific stack",
    endpoint: "read",
    operation: "GetStack",
    inputSchema: stackArg,
    annotations: READ_ONLY,
    summary: ({ stack }) => `Retrieved stack ${stack}.`,
  }),
  spec({
    name: "komodo_get_stack_log",
    title: "Get stack log",
    description: "Get deployment logs for a stack",
    endpoint: "read",
    operation: "GetStackLog",
    inputSchema: stackArg,
    annotations: READ_ONLY,
    summary: ({ stack }) => `Retrieved logs for stack ${stack}.`,
  }),
  spec({
    name: "komodo_get_container_log",
    title: "Get container log",
    description: "Get logs from a specific container",
    endpoint: "read",
    operation: "GetContainerLog",
    inputSchema: {
      ...serverArg,
      ...containerArg,
      tail: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .default(100)
        .describe("Number of lines to return (default: 100, max: 10000)"),
    },
    annotations: READ_ONLY,
    summary: ({ container }) => `Retrieved logs for container ${container}.`,
  }),
  spec({
    name: "komodo_list_containers",
    title: "List containers",
    description: "List all Docker containers on a server",
    endpoint: "read",
    operation: "ListDockerContainers",
    inputSchema: serverArg,
    annotations: READ_ONLY,
    summary: ({ server }) => `Retrieved containers for server ${server}.`,
  }),
  spec({
    name: "komodo_inspect_container",
    title: "Inspect container",
    description: "Get detailed information about a container",
    endpoint: "read",
    operation: "InspectDockerContainer",
    inputSchema: { ...serverArg, ...containerArg },
    annotations: READ_ONLY,
    summary: ({ container }) => `Inspected container ${container}.`,
  }),
  spec({
    name: "komodo_get_system_stats",
    title: "Get system stats",
    description: "Get system statistics for a server (CPU, memory, disk)",
    endpoint: "read",
    operation: "GetSystemStats",
    inputSchema: serverArg,
    annotations: READ_ONLY,
    summary: ({ server }) => `Retrieved system stats for server ${server}.`,
  }),
  spec({
    name: "komodo_list_images",
    title: "List Docker images",
    description: "List all Docker images on a server",
    endpoint: "read",
    operation: "ListDockerImages",
    inputSchema: serverArg,
    annotations: READ_ONLY,
    summary: ({ server }) => `Retrieved Docker images for server ${server}.`,
  }),
  spec({
    name: "komodo_list_networks",
    title: "List Docker networks",
    description: "List all Docker networks on a server",
    endpoint: "read",
    operation: "ListDockerNetworks",
    inputSchema: serverArg,
    annotations: READ_ONLY,
    summary: ({ server }) => `Retrieved Docker networks for server ${server}.`,
  }),
  spec({
    name: "komodo_list_volumes",
    title: "List Docker volumes",
    description: "List all Docker volumes on a server",
    endpoint: "read",
    operation: "ListDockerVolumes",
    inputSchema: serverArg,
    annotations: READ_ONLY,
    summary: ({ server }) => `Retrieved Docker volumes for server ${server}.`,
  }),
  spec({
    name: "komodo_get_alerts",
    title: "Get system alerts",
    description: "List all system alerts",
    endpoint: "read",
    operation: "ListAlerts",
    inputSchema: {},
    annotations: READ_ONLY,
    summary: () => "Retrieved Komodo alerts.",
  }),
  spec({
    name: "komodo_search_logs",
    title: "Search container logs",
    description: "Search container logs for specific terms",
    endpoint: "read",
    operation: "SearchContainerLog",
    inputSchema: {
      ...serverArg,
      ...containerArg,
      terms: z
        .array(z.string().max(256))
        .min(1)
        .max(20)
        .describe("Search terms to find in logs (1-20 entries, max 256 chars each)"),
    },
    annotations: READ_ONLY,
    summary: ({ container }) => `Searched logs for container ${container}.`,
  }),
  spec({
    name: "komodo_get_stack_services",
    title: "Get stack services",
    description: "Get summary of all stacks with their services and status",
    endpoint: "read",
    operation: "GetStacksSummary",
    inputSchema: {},
    annotations: READ_ONLY,
    summary: () => "Retrieved stack services summary.",
  }),

  // ===== EXECUTE =====
  spec({
    name: "komodo_deploy_stack",
    title: "Deploy stack",
    description: "Deploy or redeploy a stack (pulls images and starts containers)",
    endpoint: "execute",
    operation: "DeployStack",
    inputSchema: stackArg,
    annotations: NON_IDEMPOTENT_WRITE,
    summary: ({ stack }) => `Deployed stack ${stack}.`,
  }),
  spec({
    name: "komodo_start_stack",
    title: "Start stack",
    description: "Start a stopped stack",
    endpoint: "execute",
    operation: "StartStack",
    inputSchema: stackArg,
    annotations: IDEMPOTENT_WRITE,
    summary: ({ stack }) => `Started stack ${stack}.`,
  }),
  spec({
    name: "komodo_stop_stack",
    title: "Stop stack",
    description: "Stop a running stack (keeps containers, just stops them)",
    endpoint: "execute",
    operation: "StopStack",
    inputSchema: stackArg,
    annotations: IDEMPOTENT_WRITE,
    summary: ({ stack }) => `Stopped stack ${stack}.`,
  }),
  spec({
    name: "komodo_restart_stack",
    title: "Restart stack",
    description: "Restart a stack",
    endpoint: "execute",
    operation: "RestartStack",
    inputSchema: stackArg,
    annotations: IDEMPOTENT_WRITE,
    summary: ({ stack }) => `Restarted stack ${stack}.`,
  }),
  spec({
    name: "komodo_destroy_stack",
    title: "Destroy stack",
    description: "Destroy a stack (stops and removes containers). WARNING: destructive.",
    endpoint: "execute",
    operation: "DestroyStack",
    inputSchema: stackArg,
    annotations: DESTRUCTIVE,
    summary: ({ stack }) => `Destroyed stack ${stack}.`,
  }),
  spec({
    name: "komodo_pull_stack",
    title: "Pull stack images",
    description: "Pull latest images for a stack without deploying",
    endpoint: "execute",
    operation: "PullStackImages",
    inputSchema: stackArg,
    annotations: IDEMPOTENT_WRITE,
    summary: ({ stack }) => `Pulled images for stack ${stack}.`,
  }),
  spec({
    name: "komodo_start_container",
    title: "Start container",
    description: "Start a specific container",
    endpoint: "execute",
    operation: "StartContainer",
    inputSchema: { ...serverArg, ...containerArg },
    annotations: IDEMPOTENT_WRITE,
    summary: ({ container }) => `Started container ${container}.`,
  }),
  spec({
    name: "komodo_stop_container",
    title: "Stop container",
    description: "Stop a specific container",
    endpoint: "execute",
    operation: "StopContainer",
    inputSchema: { ...serverArg, ...containerArg },
    annotations: IDEMPOTENT_WRITE,
    summary: ({ container }) => `Stopped container ${container}.`,
  }),
  spec({
    name: "komodo_restart_container",
    title: "Restart container",
    description: "Restart a specific container",
    endpoint: "execute",
    operation: "RestartContainer",
    inputSchema: { ...serverArg, ...containerArg },
    annotations: IDEMPOTENT_WRITE,
    summary: ({ container }) => `Restarted container ${container}.`,
  }),
  spec({
    name: "komodo_prune_images",
    title: "Prune Docker images",
    description: "Remove unused Docker images from a server",
    endpoint: "execute",
    operation: "PruneDockerImages",
    inputSchema: serverArg,
    annotations: DESTRUCTIVE,
    summary: ({ server }) => `Pruned Docker images on server ${server}.`,
  }),
  spec({
    name: "komodo_prune_networks",
    title: "Prune Docker networks",
    description: "Remove unused Docker networks from a server",
    endpoint: "execute",
    operation: "PruneDockerNetworks",
    inputSchema: serverArg,
    annotations: DESTRUCTIVE,
    summary: ({ server }) => `Pruned Docker networks on server ${server}.`,
  }),
  spec({
    name: "komodo_prune_system",
    title: "Prune Docker system",
    description:
      "Full Docker system prune (images, networks, volumes, build cache). WARNING: destructive.",
    endpoint: "execute",
    operation: "PruneDockerSystem",
    inputSchema: serverArg,
    annotations: DESTRUCTIVE,
    summary: ({ server }) => `Pruned Docker system on server ${server}.`,
  }),

  // ===== WRITE =====
  spec({
    name: "komodo_create_stack",
    title: "Create stack",
    description: "Create a new stack in Komodo",
    endpoint: "write",
    operation: "CreateStack",
    inputSchema: {
      name: z.string().min(1).max(256).describe("Name for the new stack"),
      server_id: z.string().min(1).describe("Server ID to deploy the stack on"),
      compose_contents: composeContents.optional(),
    },
    annotations: NON_IDEMPOTENT_WRITE,
    buildParams: ({ name, server_id, compose_contents }) => ({
      name,
      config: { server_id, file_contents: compose_contents ?? "" },
    }),
    summary: ({ name }) => `Created stack ${name}.`,
  }),
  spec({
    name: "komodo_update_stack",
    title: "Update stack",
    description:
      "Update stack configuration. Secret-like keys (api_key, password, etc.) are rejected.",
    endpoint: "write",
    operation: "UpdateStack",
    inputSchema: {
      ...idArg,
      config: configRecord,
    },
    annotations: NON_IDEMPOTENT_WRITE,
    summary: ({ id }) => `Updated stack ${id}.`,
  }),
  spec({
    name: "komodo_delete_stack",
    title: "Delete stack",
    description: "Delete a stack from Komodo. WARNING: permanently removes the stack.",
    endpoint: "write",
    operation: "DeleteStack",
    inputSchema: idArg,
    annotations: DESTRUCTIVE,
    summary: ({ id }) => `Deleted stack ${id}.`,
  }),
  spec({
    name: "komodo_write_stack_contents",
    title: "Write stack contents",
    description:
      "Write or update the Docker Compose file contents for a stack. WARNING: overwrites existing contents.",
    endpoint: "write",
    operation: "WriteStackFileContents",
    inputSchema: {
      stack: z.string().describe("Stack name or ID"),
      contents: composeContents,
    },
    annotations: DESTRUCTIVE,
    summary: ({ stack }) => `Updated stack contents for ${stack}.`,
  }),
  spec({
    name: "komodo_create_server",
    title: "Create server",
    description: "Add a new server to Komodo",
    endpoint: "write",
    operation: "CreateServer",
    inputSchema: {
      name: z.string().min(1).max(256).describe("Name for the new server"),
      address: z.string().url().describe("Periphery address (e.g., https://periphery:8120)"),
    },
    annotations: NON_IDEMPOTENT_WRITE,
    buildParams: ({ name, address }) => ({ name, config: { address } }),
    summary: ({ name }) => `Created server ${name}.`,
  }),
  spec({
    name: "komodo_update_server",
    title: "Update server",
    description:
      "Update server configuration. Secret-like keys (api_key, password, etc.) are rejected.",
    endpoint: "write",
    operation: "UpdateServer",
    inputSchema: { ...idArg, config: configRecord },
    annotations: NON_IDEMPOTENT_WRITE,
    summary: ({ id }) => `Updated server ${id}.`,
  }),
  spec({
    name: "komodo_delete_server",
    title: "Delete server",
    description:
      "Permanently delete a server entry from Komodo. WARNING: removes the server record.",
    endpoint: "write",
    operation: "DeleteServer",
    inputSchema: idArg,
    annotations: DESTRUCTIVE,
    summary: ({ id }) => `Deleted server ${id}.`,
  }),
  spec({
    name: "komodo_rename_stack",
    title: "Rename stack",
    description: "Rename a stack",
    endpoint: "write",
    operation: "RenameStack",
    inputSchema: { ...idArg, name: z.string().min(1).max(256).describe("New stack name") },
    annotations: NON_IDEMPOTENT_WRITE,
    summary: ({ id, name }) => `Renamed stack ${id} to ${name}.`,
  }),
];

// ---------- registration ----------

export function registerAll(server: McpServer, client: KomodoClient): void {
  for (const t of TOOLS) {
    const handler = toolHandler(
      async (args: Record<string, unknown>) => {
        const params = t.buildParams ? t.buildParams(args) : args;
        return client.call(t.endpoint, t.operation, params);
      },
      (args) => (t.summary ? t.summary(args) : `${t.name} succeeded.`)
    );
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      },
      // SDK overload resolution can't disambiguate the generic `inputSchema`
      // here; cast keeps the runtime correct without losing per-spec safety.
      handler as Parameters<typeof server.registerTool>[2]
    );
  }
}

// Helper that preserves the Shape generic at the definition site so the inline
// `summary`/`buildParams` callbacks see the inferred arg type.
function spec<Shape extends AnyZodShape>(s: ToolSpecInput<Shape>): ToolSpec {
  return s as unknown as ToolSpec;
}
