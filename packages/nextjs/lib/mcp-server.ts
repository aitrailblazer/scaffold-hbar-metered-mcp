import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_DEFS, executeTool, getMeterConfig } from "~~/lib/metering";

/**
 * The MCP server definition behind app/api/mcp/route.ts.
 * Same tools, same handlers as the HTTP transport. Usable over stdio or
 * any other MCP transport in addition to the JSON route.
 */
export function buildMcpServer() {
  const server = new McpServer({ name: "scaffold-hbar-metered-mcp", version: "0.1.0" });
  for (const def of TOOL_DEFS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, async args => {
      const config = getMeterConfig();
      const result = await executeTool(def.name, args, config);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    });
  }
  return server;
}
