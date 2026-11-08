#!/usr/bin/env node
import './instrument.js'; // must be first — initialises Sentry before any other module
import * as Sentry from '@sentry/node';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getMcpConfig } from './config.js';
import { createBrewdialMcpServer } from './server.js';

async function main(): Promise<void> {
  const config = getMcpConfig();

  const server = createBrewdialMcpServer(config.api, {
    onToolError: (error, toolName) => {
      Sentry.captureException(error, { tags: { mcp_tool: toolName } });
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('BrewDial MCP server running on stdio (agent API)');
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  Sentry.captureException(error);
  // Give the SDK a moment to deliver the event before the process exits.
  await Sentry.close(2000);
  process.exit(1);
});
