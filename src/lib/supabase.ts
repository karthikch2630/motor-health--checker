import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isMissing = (v: string | undefined) => !v || v.includes('your-project') || v.startsWith('your-')

/** Required env vars that are missing or still set to .env.example placeholders. */
export const missingEnvVars: string[] = [
  ...(isMissing(url) ? ['VITE_SUPABASE_URL'] : []),
  ...(isMissing(anonKey) ? ['VITE_SUPABASE_ANON_KEY'] : []),
]

export const isSupabaseConfigured = missingEnvVars.length === 0

/** Supabase client, or null when the environment is not configured. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null
