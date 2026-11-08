/**
 * The configuration screen.
 *
 * Shown when `.env` is missing or invalid, *before* any service is constructed.
 * The exact zod problems are rendered so the fix is obvious - "something went
 * wrong" is not a deployment instruction.
 */
import { setLocalSandboxPreference } from '../../core/env'

export interface ConfigBannerProps {
  problems?: string[]
}

export default function ConfigBanner({ problems = [] }: ConfigBannerProps) {
  const handleStartSandbox = () => {
    setLocalSandboxPreference(true)
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Configuration problem</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The app refuses to start without a valid environment. Copy{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">.env.example</code> to{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">.env</code> and fill in both
          Supabase values.
        </p>

        {problems.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-md border border-destructive/30 bg-late-surface p-3 text-xs text-destructive">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <pre className="mt-4 overflow-x-auto rounded-md bg-foreground p-4 text-xs leading-relaxed text-background">
{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        </pre>
        <p className="mt-4 text-xs text-muted-foreground">
          Find both in Supabase Dashboard - Project Settings - API.
        </p>

        <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">
            Testing locally without Supabase credentials? Start the built-in Local Sandbox DB with pre-seeded events, rooms, and candidates:
          </p>
          <button
            type="button"
            onClick={handleStartSandbox}
            className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Launch Local Sandbox Mode (No Supabase Required)
          </button>
        </div>
      </div>
    </div>
  )
}
