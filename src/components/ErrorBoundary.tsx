import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Home, RefreshCw } from "lucide-react";
import { logger } from "@/shared/diagnostics/logger";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

/**
 * Error boundary — animated empty state with primary/secondary action hierarchy (§7).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    logger.captureException(error, {
      componentStack: errorInfo.componentStack?.slice(0, 2000),
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.fallbackTitle ?? "Something went wrong";
    const message =
      this.state.error?.message ??
      "An unexpected error occurred in the workbench.";
    const stack = this.state.error?.stack;

    return (
      <div
        className="flex h-full min-h-[240px] flex-col items-center justify-center bg-[var(--bg-canvas)] px-6"
        role="alert"
        aria-live="assertive"
      >
        <div className="lens-empty-enter flex w-full max-w-[480px] flex-col items-center text-center">
          <div
            className="lens-empty-icon flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--error-muted)] text-[var(--error)]"
            aria-hidden
          >
            <AlertTriangle className="h-7 w-7" strokeWidth={1.5} />
          </div>

          <h1 className="mt-4 type-title-sm leading-6 text-[var(--text-primary)]">
            {title}
          </h1>

          <p className="mt-3 max-w-[400px] type-body-md text-[var(--text-secondary)]">
            {message}
          </p>

          <p className="mt-4 type-caption leading-[18px] text-[var(--text-tertiary)]">
            Recorded in application diagnostics. You can try again or reload the
            window.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={this.handleReset}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Try again
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={this.handleReload}
            >
              <Home className="h-3.5 w-3.5" strokeWidth={1.75} />
              Reload window
            </button>
          </div>

          {stack && (
            <div className="mt-6 w-full max-w-[400px] text-left">
              <button
                type="button"
                className="btn-link inline-flex items-center gap-1"
                onClick={() =>
                  this.setState((s) => ({ showDetails: !s.showDetails }))
                }
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-[var(--duration-fast)] ${
                    this.state.showDetails ? "rotate-180" : ""
                  }`}
                />
                {this.state.showDetails ? "Hide details" : "Show details"}
              </button>
              <div
                className="overflow-hidden transition-[max-height,opacity] duration-[var(--duration-base)] ease-[var(--ease-standard)]"
                style={{
                  maxHeight: this.state.showDetails ? 240 : 0,
                  opacity: this.state.showDetails ? 1 : 0,
                }}
              >
                <pre className="mt-3 max-h-60 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 type-code leading-4 text-[var(--text-tertiary)]">
                  {stack}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}
