// BrewDial MCP server configuration.
// Connects to the OCI backend's agent surface via HTTP Bearer auth.
// Required env vars: API_BASE_URL, AGENT_TOKEN.

export interface ApiConfig {
  baseUrl: string; // e.g. https://api.brewdial.robinco.dev
  agentToken: string;
}

export interface BrewDialMcpConfig {
  api: ApiConfig;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getMcpConfig(
  env: Record<string, string | undefined> = process.env
): BrewDialMcpConfig {
  const baseUrl = nonEmpty(env.API_BASE_URL);
  const agentToken = nonEmpty(env.AGENT_TOKEN);
  if (!baseUrl) {
    throw new Error('Missing API_BASE_URL for the BrewDial MCP server');
  }
  if (!agentToken) {
    throw new Error('Missing AGENT_TOKEN for the BrewDial MCP server');
  }
  return { api: { baseUrl: trimTrailingSlash(baseUrl), agentToken } };
}
