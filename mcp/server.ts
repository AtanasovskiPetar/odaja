// Odaja MCP server: lets Claude Code, Claude Desktop or any MCP client use
// Odaja's tools. It forwards to the running Odaja app, which does the work on
// the open project, so the app must be running.
//
//   claude mcp add odaja -- bun /path/to/odaja/mcp/server.ts
//
// It finds the running app by itself; ODAJA_URL overrides that.
import { runMcpServer } from "./run";

await runMcpServer();
