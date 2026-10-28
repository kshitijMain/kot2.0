import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * What to show instead of the children after one of them crashed while rendering; `retry`
   * renders them again. Text comes from the app's translator (NFR-L02).
   */
  fallback: (retry: () => void) => ReactNode;
  /** Told about each crash, e.g. to report it to the vendor (NFR-O02). */
  onError?: (error: unknown) => void;
  /** A change of this value (the screen's address) clears the crash, so moving on recovers. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  failed: boolean;
  resetKey: unknown;
}

/**
 * Keeps a bug in one screen from blanking the whole app (NFR-U04): React unmounts everything
 * when a render throws and nothing catches it. Shows `fallback` instead, with a way back.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError?.(error);
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
