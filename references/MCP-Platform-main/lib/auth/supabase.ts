/**
 * Supabase Client Configuration
 * For server-side API key authentication
 */

import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_KEY environment variable');
}

/**
 * Supabase Client with Service Role Key
 * Use for server-side operations that bypass RLS
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Supabase Client for User Context (with RLS)
 * Use when executing queries as a specific user
 */
export function getSupabaseUser(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}
