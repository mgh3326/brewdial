#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { getMcpConfig } from './config.js';
import { handleCreateRecipe, handleGetRecentContext, handleGetRecipeContext } from './tools.js';

const TOOLS: Tool[] = [
  {
    name: 'brew.create_recipe',
    description:
      'Persist a newly generated coffee recipe to BrewDial. Use this immediately after generating a recipe for the user, then include the returned COF-NNNN code in the Discord reply.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['v60', 'espresso', 'aeropress', 'kalita', 'other'],
          description: 'Brew method'
        },
        title: { type: 'string', description: 'Human-readable recipe title' },
        beanId: { type: 'string', description: 'Optional stable bean identifier' },
        beanSnapshot: {
          type: 'object',
          description: 'Bean metadata snapshot',
          properties: {
            name: { type: 'string' },
            roaster: { type: 'string' },
            roastDate: { type: 'string' },
            roastLevel: { type: 'string' },
            origin: { type: 'string' },
            process: { type: 'string' },
            notes: { type: 'string' }
          }
        },
        params: {
          type: 'object',
          description: 'Brew parameters',
          properties: {
            doseG: { type: 'number' },
            waterG: { type: 'number' },
            ratio: { type: 'string' },
            tempC: { type: 'number' },
            grind: { type: 'string' },
            grinder: { type: 'string' },
            brewer: { type: 'string' },
            targetTimeSec: { type: 'number' }
          }
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              atSec: { type: 'number' },
              waterG: { type: 'number' },
              note: { type: 'string' }
            },
            required: ['note']
          }
        },
        intent: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        adjustmentFromPrevious: { type: 'string' }
      },
      required: ['method', 'title']
    }
  },
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
      case 'brew.create_recipe': {
        const result = await handleCreateRecipe(config.couch, args as Record<string, unknown> | undefined);
        return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
      }
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
