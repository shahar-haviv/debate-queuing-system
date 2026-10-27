/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Legacy alias, still accepted by the parser. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_APP_ENV?: 'development' | 'preview' | 'production'
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
