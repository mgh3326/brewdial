// MCP over Streamable HTTP, served by the API at `/mcp` (root, not under /api).
//
// Stateless: a new MCP server and transport for each request, so blue/green
// instances hold no session state. Tool calls run in-process through `dispatch`
// (the root app's fetch), so they pass the same routes, validation and
// agentAuth as the REST API, with no network hop.

import { Hono } from 'hono'
import * as Sentry from '@sentry/node'
import type { JWTVerifyGetKey } from 'jose'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createBrewdialMcpServer } from '@brewdial/mcp/server'
import { mcpAccess } from '../middleware/mcp-access.js'

type ApiConfig = Parameters<typeof createBrewdialMcpServer>[0]

export interface McpRouteOptions {
  /** Runs one request through the root app in-process. */
  dispatch: (request: Request) => Promise<Response>
  /** Injected for tests. Defaults to the team's Access JWKS. */
  jwks?: JWTVerifyGetKey
}

// The host name is never used for routing: tool calls stay in this process.
const IN_PROCESS_BASE_URL = 'http://brewdial.internal'

export function createMcpRoute(options: McpRouteOptions): Hono {
  const route = new Hono()

  // Path-scoped on purpose: the access gate runs only for /mcp, not for every
  // request that reaches this mount.
  route.all('/mcp', mcpAccess({ jwks: options.jwks }), async (c) => {
    const api: ApiConfig = {
      baseUrl: IN_PROCESS_BASE_URL,
      agentToken: process.env.AGENT_TOKEN ?? '',
      fetchImpl: (input, init) => options.dispatch(new Request(input, init)),
    }
    const server = createBrewdialMcpServer(api, {
      onToolError: (error, toolName) => {
        Sentry.captureException(error, { tags: { mcp_tool: toolName } })
      },
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      // Keep the SDK's DNS-rebinding guard off: a proxied request arrives with
      // a public Host header, and the Access assertion is the gate here.
      enableDnsRebindingProtection: false,
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

  return route
}
