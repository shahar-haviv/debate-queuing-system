/**
 * Safety net shown only if the constants in `src/lib/supabase.js` are ever
 * blanked out. With the config defined in code this should never appear.
 */
export default function ConfigBanner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Configuration problem</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The Supabase URL or key is missing. Open{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">src/lib/supabase.js</code> and make sure
          both values are filled in:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-foreground p-4 text-xs leading-relaxed text-background">
{`SUPABASE_URL = 'https://<project-ref>.supabase.co'
SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...'`}
        </pre>
        <p className="mt-4 text-xs text-muted-foreground">
          Find both in Supabase Dashboard → Project Settings → API.
        </p>
      </div>
    </div>
  )
}
