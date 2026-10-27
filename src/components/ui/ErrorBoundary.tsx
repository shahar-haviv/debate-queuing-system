import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createLogger, exportEntries } from '../../core/logger'

const log = createLogger('crash')

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  copied: boolean
}

/**
 * Catches render-time crashes, logs them with the component stack, and shows
 * something actionable instead of a blank white screen.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, copied: false }
    this.handleCopy = this.handleCopy.bind(this)
    this.handleReload = this.handleReload.bind(this)
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('unhandled render error', { error, componentStack: info?.componentStack })
  }

  async handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `${this.state.error?.stack ?? this.state.error?.message ?? 'unknown error'}\n\n--- log ---\n${exportEntries()}`,
      )
      this.setState({ copied: true })
    } catch {
      this.setState({ copied: false })
    }
  }

  handleReload(): void {
    window.location.reload()
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-lg border border-destructive/30 bg-card p-8 shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-2xl">
            !
          </div>
          <h1 className="mt-4 text-center text-lg font-bold tracking-tight text-foreground">
            Something broke
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            The screen failed to render. The details were written to the debug log.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
            {String(error?.message ?? error)}
          </pre>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={this.handleCopy}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              {copied ? 'Copied' : 'Copy diagnostics'}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
