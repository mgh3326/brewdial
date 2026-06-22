import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const hasSupabaseConfig = Boolean(url && key);

if (!hasSupabaseConfig) {
  console.warn('[brewdial] Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY');
}

// v1 is anonymous (no Toss Login yet), so we don't persist a Supabase session.
// The publishable key is public and protected by Row Level Security.
//
// Fall back to a syntactically-valid placeholder when env is missing so
// createClient() never throws at module load (which would black-screen the
// whole WebView). Calls then fail gracefully and are surfaced in the UI.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);
