import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  compact?: boolean;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.compact ? "px-1 py-2" : "vx-page__content px-5 py-4"}>
        <div className="vx-notice" data-tone="error" role="alert">
          <span className="vx-notice__icon">
            <AlertTriangle size={18} aria-hidden />
          </span>
          <h3>{this.props.title ?? "This part of the page could not be shown"}</h3>
          <p>Some of the data could not be displayed. Reloading the page usually fixes this.</p>
          <button
            type="button"
            className="vx-button vx-button--compact vx-notice__action"
            onClick={() => window.location.reload()}
          >
            <RotateCw size={14} aria-hidden /> Reload
          </button>
        </div>
      </div>
    );
  }
}
