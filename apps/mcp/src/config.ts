// BrewDial MCP now writes to the SAME Supabase database the App-in-Toss mini-app
// reads. It uses the SERVICE ROLE key (server-side only) so it can create
// agent-attributed recipes and manage status/lineage (RLS is bypassed).

export interface SupabaseConfig {
  url: string; // e.g. https://xxxx.supabase.co  (no /rest/v1 suffix)
  serviceRoleKey: string;
}

export interface BrewDialMcpConfig {
  supabase: SupabaseConfig;
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
  const url = nonEmpty(env.SUPABASE_URL) ?? nonEmpty(env.VITE_SUPABASE_URL);
  const serviceRoleKey = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) for the BrewDial MCP server');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for the BrewDial MCP server');
  }
  return { supabase: { url: trimTrailingSlash(url), serviceRoleKey } };
}
