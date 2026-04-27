/**
 * Write operation tools for Komodo MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KomodoClient } from "../komodo-client.js";
import { formatResult } from "./utils.js";

export function registerWriteTools(server: McpServer, client: KomodoClient): void {
  // Create stack
  server.registerTool(
    "komodo_create_stack",
    {
      title: "Create stack",
      description: "Create a new stack in Komodo",
      inputSchema: z.object({
        name: z.string().describe("Name for the new stack"),
        server_id: z.string().describe("Server ID to deploy the stack on"),
        compose_contents: z
          .string()
          .optional()
          .describe("Docker Compose file contents (YAML)"),
      }),
      outputSchema: z.object({}),
    },
    async ({ name, server_id, compose_contents }) => {
      const result = await client.createStack(name, server_id, compose_contents);
      return formatResult(result, `Created stack ${name}.`);
    }
  );

  // Update stack
  server.registerTool(
    "komodo_update_stack",
    {
      title: "Update stack",
      description: "Update stack configuration",
      inputSchema: z.object({
        id: z.string().describe("Stack ID to update"),
        config: z.record(z.unknown()).describe("Configuration object to update"),
      }),
      outputSchema: z.object({}),
    },
    async ({ id, config }) => {
      const result = await client.updateStack(id, config);
      return formatResult(result, `Updated stack ${id}.`);
    }
  );

  // Delete stack
  server.registerTool(
    "komodo_delete_stack",
    {
      title: "Delete stack",
      description:
        "Delete a stack from Komodo. WARNING: This permanently removes the stack configuration!",
      inputSchema: z.object({
        id: z.string().describe("Stack ID to delete"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const result = await client.deleteStack(id);
      return formatResult(result, `Deleted stack ${id}.`);
    }
  );

  // Write stack file contents
  server.registerTool(
    "komodo_write_stack_contents",
    {
      title: "Write stack contents",
      description: "Write or update the Docker Compose file contents for a stack",
      inputSchema: z.object({
        stack: z.string().describe("Stack name or ID"),
        contents: z.string().describe("Docker Compose file contents (YAML)"),
      }),
      outputSchema: z.object({}),
    },
    async ({ stack, contents }) => {
      const result = await client.writeStackFileContents(stack, contents);
      return formatResult(result, `Updated stack contents for ${stack}.`);
    }
  );

  // Create server
  server.registerTool(
    "komodo_create_server",
    {
      title: "Create server",
      description: "Add a new server to Komodo",
      inputSchema: z.object({
        name: z.string().describe("Name for the new server"),
        address: z.string().describe("Periphery address (e.g., https://periphery:8120)"),
      }),
      outputSchema: z.object({}),
    },
    async ({ name, address }) => {
      const result = await client.createServer(name, address);
      return formatResult(result, `Created server ${name}.`);
    }
  );

  // Update server
  server.registerTool(
    "komodo_update_server",
    {
      title: "Update server",
      description: "Update server configuration",
      inputSchema: z.object({
        id: z.string().describe("Server ID to update"),
        config: z.record(z.unknown()).describe("Configuration object to update"),
      }),
      outputSchema: z.object({}),
    },
    async ({ id, config }) => {
      const result = await client.updateServer(id, config);
      return formatResult(result, `Updated server ${id}.`);
    }
  );

  // Delete server
  server.registerTool(
    "komodo_delete_server",
    {
      title: "Delete server",
      description: "Remove a server from Komodo. WARNING: This removes the server connection!",
      inputSchema: z.object({
        id: z.string().describe("Server ID to delete"),
      }),
      outputSchema: z.object({}),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const result = await client.deleteServer(id);
      return formatResult(result, `Deleted server ${id}.`);
    }
  );

  // Rename stack
  server.registerTool(
    "komodo_rename_stack",
    {
      title: "Rename stack",
      description: "Rename a stack",
      inputSchema: z.object({
        id: z.string().describe("Stack ID to rename"),
        name: z.string().describe("New name for the stack"),
      }),
      outputSchema: z.object({}),
    },
    async ({ id, name }) => {
      const result = await client.renameStack(id, name);
      return formatResult(result, `Renamed stack ${id} to ${name}.`);
    }
  );
}
