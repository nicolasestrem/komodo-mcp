/**
 * MCP Server factory — assembles a fresh McpServer wired to a KomodoClient.
 *
 * The KomodoClient is injected (rather than constructed inside) so transports
 * can share one client across SSE/Streamable sessions while each session gets
 * its own MCP server instance.
 */

import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { KomodoClient } from "./komodo-client.js";
import { registerAll } from "./tools/registry.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export interface CreateServerOptions {
  client?: KomodoClient;
}

export function createServer(options: CreateServerOptions = {}): {
  server: McpServer;
  client: KomodoClient;
} {
  const client = options.client ?? KomodoClient.fromEnv();

  const server = new McpServer({
    name: "komodo",
    version: pkg.version,
  });

  registerAll(server, client);

  return { server, client };
}
