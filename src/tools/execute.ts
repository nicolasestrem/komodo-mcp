/**
 * Execute operation tools for Komodo MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KomodoClient } from "../komodo-client.js";
import { formatResult } from "./utils.js";

export function registerExecuteTools(server: McpServer, client: KomodoClient): void {
  // Deploy stack
  server.registerTool(
    "komodo_deploy_stack",
    {
      title: "Deploy stack",
      description: "Deploy or redeploy a stack (pulls images and starts containers)",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID to deploy"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.deployStack(stack);
      return formatResult(result, `Deployed stack ${stack}.`);
    }
  );

  // Start stack
  server.registerTool(
    "komodo_start_stack",
    {
      title: "Start stack",
      description: "Start a stopped stack",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID to start"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.startStack(stack);
      return formatResult(result, `Started stack ${stack}.`);
    }
  );

  // Stop stack
  server.registerTool(
    "komodo_stop_stack",
    {
      title: "Stop stack",
      description: "Stop a running stack (keeps containers, just stops them)",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID to stop"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.stopStack(stack);
      return formatResult(result, `Stopped stack ${stack}.`);
    }
  );

  // Restart stack
  server.registerTool(
    "komodo_restart_stack",
    {
      title: "Restart stack",
      description: "Restart a stack (stop then start)",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID to restart"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.restartStack(stack);
      return formatResult(result, `Restarted stack ${stack}.`);
    }
  );

  // Destroy stack
  server.registerTool(
    "komodo_destroy_stack",
    {
      title: "Destroy stack",
      description:
        "Destroy a stack (stops and removes containers). WARNING: This is destructive!",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID to destroy"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ stack }) => {
      const result = await client.destroyStack(stack);
      return formatResult(result, `Destroyed stack ${stack}.`);
    }
  );

  // Pull stack images
  server.registerTool(
    "komodo_pull_stack",
    {
      title: "Pull stack images",
      description: "Pull latest images for a stack without deploying",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack }) => {
      const result = await client.pullStackImages(stack);
      return formatResult(result, `Pulled images for stack ${stack}.`);
    }
  );

  // Start container
  server.registerTool(
    "komodo_start_container",
    {
      title: "Start container",
      description: "Start a specific container",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID to start"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container }) => {
      const result = await client.startContainer(server, container);
      return formatResult(result, `Started container ${container}.`);
    }
  );

  // Stop container
  server.registerTool(
    "komodo_stop_container",
    {
      title: "Stop container",
      description: "Stop a specific container",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID to stop"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container }) => {
      const result = await client.stopContainer(server, container);
      return formatResult(result, `Stopped container ${container}.`);
    }
  );

  // Restart container
  server.registerTool(
    "komodo_restart_container",
    {
      title: "Restart container",
      description: "Restart a specific container",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
        container: z.string().describe("Container name or ID to restart"),
      }),
      outputSchema: z.object({}),
    },
    async ({ server, container }) => {
      const result = await client.restartContainer(server, container);
      return formatResult(result, `Restarted container ${container}.`);
    }
  );

  // Prune images
  server.registerTool(
    "komodo_prune_images",
    {
      title: "Prune Docker images",
      description: "Remove unused Docker images from a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ server }) => {
      const result = await client.pruneDockerImages(server);
      return formatResult(result, `Pruned Docker images on server ${server}.`);
    }
  );

  // Prune networks
  server.registerTool(
    "komodo_prune_networks",
    {
      title: "Prune Docker networks",
      description: "Remove unused Docker networks from a server",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ server }) => {
      const result = await client.pruneDockerNetworks(server);
      return formatResult(result, `Pruned Docker networks on server ${server}.`);
    }
  );

  // Prune system
  server.registerTool(
    "komodo_prune_system",
    {
      title: "Prune Docker system",
      description:
        "Full Docker system prune (images, networks, volumes, build cache). WARNING: This is destructive!",
      inputSchema: z.object({
        server: z.string().describe("Server name or ID"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ server }) => {
      const result = await client.pruneDockerSystem(server);
      return formatResult(result, `Pruned Docker system on server ${server}.`);
    }
  );
}
