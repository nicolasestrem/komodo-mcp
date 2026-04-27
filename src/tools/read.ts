/**
 * Read operation tools for Komodo MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KomodoClient } from "../komodo-client.js";
import { formatResult } from "./utils.js";

export function registerReadTools(server: McpServer, client: KomodoClient): void {
  // List all servers
  server.registerTool(
    "komodo_list_servers",
    {
      title: "List Komodo servers",
      description: "List all Komodo servers with their status and configuration",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    },
    async () => {
      const result = await client.listServers();
      return formatResult(result, "Retrieved Komodo servers.");
    }
  );

  // List all stacks
  server.registerTool(
    "komodo_list_stacks",
    {
      title: "List Komodo stacks",
      description: "List all Komodo stacks with their current state (running/down)",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    },
    async () => {
      const result = await client.listStacks();
      return formatResult(result, "Retrieved stacks.");
    }
  );

  // List all deployments
  server.registerTool(
    "komodo_list_deployments",
    {
      title: "List deployments",
      description: "List all Komodo deployments",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    },
    async () => {
      const result = await client.listDeployments();
      return formatResult(result, "Retrieved deployments.");
    }
  );

  // Get stack details
  server.registerTool(
    "komodo_get_stack",
    {
      title: "Get stack details",
      description: "Get detailed information about a specific stack",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.getStack(stack);
      return formatResult(result, `Retrieved stack ${stack}.`);
    }
  );

  // Get stack logs
  server.registerTool(
    "komodo_get_stack_log",
    {
      title: "Get stack log",
      description: "Get deployment logs for a stack",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.getStackLog(stack);
      return formatResult(result, `Retrieved logs for stack ${stack}.`);
    }
  );

  // Get container logs
  server.registerTool(
    "komodo_get_container_log",
    {
      title: "Get container log",
      description: "Get logs from a specific container",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID"),
        tail: z
          .number()
          .optional()
          .describe("Number of lines to return (default: 100)"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container, tail }) => {
      const result = await client.getContainerLog(server, container, tail);
      return formatResult(result, `Retrieved logs for container ${container}.`);
    }
  );

  // List containers on a server
  server.registerTool(
    "komodo_list_containers",
    {
      title: "List containers",
      description: "List all Docker containers on a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server }) => {
      const result = await client.listDockerContainers(server);
      return formatResult(result, `Retrieved containers for server ${server}.`);
    }
  );

  // Inspect container
  server.registerTool(
    "komodo_inspect_container",
    {
      title: "Inspect container",
      description: "Get detailed information about a container",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container }) => {
      const result = await client.inspectDockerContainer(server, container);
      return formatResult(result, `Inspected container ${container}.`);
    }
  );

  // Get system stats
  server.registerTool(
    "komodo_get_system_stats",
    {
      title: "Get system stats",
      description: "Get system statistics for a server (CPU, memory, disk)",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server }) => {
      const result = await client.getSystemStats(server);
      return formatResult(result, `Retrieved system stats for server ${server}.`);
    }
  );

  // List Docker images
  server.registerTool(
    "komodo_list_images",
    {
      title: "List Docker images",
      description: "List all Docker images on a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server }) => {
      const result = await client.listDockerImages(server);
      return formatResult(result, `Retrieved Docker images for server ${server}.`);
    }
  );

  // List Docker networks
  server.registerTool(
    "komodo_list_networks",
    {
      title: "List Docker networks",
      description: "List all Docker networks on a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server }) => {
      const result = await client.listDockerNetworks(server);
      return formatResult(result, `Retrieved Docker networks for server ${server}.`);
    }
  );

  // List Docker volumes
  server.registerTool(
    "komodo_list_volumes",
    {
      title: "List Docker volumes",
      description: "List all Docker volumes on a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server }) => {
      const result = await client.listDockerVolumes(server);
      return formatResult(result, `Retrieved Docker volumes for server ${server}.`);
    }
  );

  // Get alerts
  server.registerTool(
    "komodo_get_alerts",
    {
      title: "Get system alerts",
      description: "List all system alerts",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    },
    async () => {
      const result = await client.listAlerts();
      return formatResult(result, "Retrieved Komodo alerts.");
    }
  );

  // Search container logs
  server.registerTool(
    "komodo_search_logs",
    {
      title: "Search container logs",
      description: "Search container logs for specific terms",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID"),
        terms: z.array(z.string()).describe("Search terms to find in logs"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container, terms }) => {
      const result = await client.searchContainerLog(server, container, terms);
      return formatResult(result, `Searched logs for container ${container}.`);
    }
  );

  // Get stacks summary
  server.registerTool(
    "komodo_get_stack_services",
    {
      title: "Get stack services",
      description: "Get summary of all stacks with their services and status",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    },
    async () => {
      const result = await client.getStacksSummary();
      return formatResult(result, "Retrieved stack services summary.");
    }
  );
}
