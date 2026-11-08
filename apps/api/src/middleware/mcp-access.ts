// Cloudflare Access user-assertion gate for the /mcp route.
//
// Cloudflare Access (Managed OAuth) puts a signed user assertion in
// `Cf-Access-Jwt-Assertion`. We verify it here with the team's JWKS, so the
// origin does not trust the tunnel alone. There is no Bearer path on /mcp.
//
// Fail closed: a missing or blank config var answers 503 before any token is
// read. The three config vars are all-or-nothing.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Context, MiddlewareHandler } from 'hono'

export const MCP_ACCESS_HEADER = 'Cf-Access-Jwt-Assertion'

export interface McpAccessConfig {
  teamDomain: string
  aud: string
  allowedEmails: ReadonlySet<string>
}

export type McpAccessState =
  | { enabled: true; config: McpAccessConfig }
  | { enabled: false; teamDomainSet: boolean; audSet: boolean; allowlistSet: boolean }

type Env = Record<string, string | undefined>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function readMcpAccessState(env: Env = process.env): McpAccessState {
  const teamDomain = nonEmpty(env.BREWDIAL_MCP_CF_TEAM_DOMAIN)
  const aud = nonEmpty(env.BREWDIAL_MCP_CF_AUD)
  const emails = (nonEmpty(env.BREWDIAL_MCP_ALLOWED_EMAILS) ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0)

  if (!teamDomain || !aud || emails.length === 0) {
    return {
      enabled: false,
      teamDomainSet: teamDomain !== undefined,
      audSet: aud !== undefined,
      allowlistSet: emails.length > 0,
    }
  }
  return { enabled: true, config: { teamDomain, aud, allowedEmails: new Set(emails) } }
}

/** One startup line. Never includes a configured value. */
export function formatMcpAccessLog(state: McpAccessState): string {
  if (state.enabled) return 'mcp.access enabled'
  return `mcp.access disabled reason=incomplete_config team_domain_set=${state.teamDomainSet} aud_set=${state.audSet} allowlist_set=${state.allowlistSet}`
}

export function logMcpAccessState(
  env: Env = process.env,
  log: (line: string) => void = console.log,
): void {
  log(formatMcpAccessLog(readMcpAccessState(env)))
}

// createRemoteJWKSet caches keys internally, so keep one per team domain.
const remoteJwks = new Map<string, JWTVerifyGetKey>()

function defaultJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = remoteJwks.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    remoteJwks.set(teamDomain, jwks)
  }
  return jwks
}

/** Resolves to the normalized email on success; throws on any failure. */
export async function verifyMcpAccessToken(
  token: string,
  config: McpAccessConfig,
  jwks: JWTVerifyGetKey = defaultJwks(config.teamDomain),
): Promise<string> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${config.teamDomain}`,
    audience: config.aud,
    algorithms: ['RS256'],
    requiredClaims: ['exp'],
  })
  if (typeof payload.email !== 'string') {
    throw new Error('mcp access: token has no email claim')
  }
  const email = payload.email.trim().toLowerCase()
  if (!config.allowedEmails.has(email)) {
    throw new Error('mcp access: email not allowlisted')
  }
  return email
}

function unauthorized(c: Context) {
  return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
}

export interface McpAccessOptions {
  /** Injected for tests. Defaults to the team's Access JWKS. */
  jwks?: JWTVerifyGetKey
  /** Injected for tests. Defaults to process.env, read on every request. */
  env?: Env
}

export function mcpAccess(options: McpAccessOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const state = readMcpAccessState(options.env ?? process.env)
    if (!state.enabled) {
      return c.json({ error: 'mcp auth not configured' }, 503)
    }

    const token = c.req.header(MCP_ACCESS_HEADER)
    if (!token) return unauthorized(c)

    try {
      await verifyMcpAccessToken(token, state.config, options.jwks)
    } catch {
      return unauthorized(c)
    }
    await next()
  }
}
