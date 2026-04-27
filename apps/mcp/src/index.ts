#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { getMcpConfig } from './config.js';
import { handleGetRecentContext, handleGetRecipeContext } from './tools.js';

const TOOLS: Tool[] = [
  {
    name: 'brew.get_recent_context',
    description: 'Get recent BrewDial context including recipes, feedback, and guidance',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of recent recipes to include (1-20, default: 5)'
        }
      }
    }
  },
  {
    name: 'brew.get_recipe_context',
    description: 'Get detailed context for a specific recipe by code',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Recipe code in format COF-NNNN (e.g., COF-0001)'
        }
      },
      required: ['code']
    }
  }
];

async function main(): Promise<void> {
  const config = getMcpConfig();

  const server = new Server(
    {
      name: 'brewdial-mcp',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'brew.get_recent_context': {
        const result = await handleGetRecentContext(config.couch, args as Record<string, unknown> | undefined);
        return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
      }
      case 'brew.get_recipe_context': {
        const result = await handleGetRecipeContext(config.couch, args as Record<string, unknown> | undefined);
        return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
      }
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('BrewDial MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
