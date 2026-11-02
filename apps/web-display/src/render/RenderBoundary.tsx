import { Component, Suspense, useEffect, useEffectEvent, type ReactNode } from "react";

interface FailureProps {
  /** A new value clears a previous failure so new content gets a fresh attempt. */
  resetKey: string;
  onFailed: () => void;
  children: ReactNode;
}

interface FailureState {
  failedKey: string | null;
}

export class FailureBoundary extends Component<FailureProps, FailureState> {
  override state: FailureState = { failedKey: null };

  static getDerivedStateFromError(): Partial<FailureState> {
    return { failedKey: "" };
  }

  override componentDidCatch(): void {
    this.setState({ failedKey: this.props.resetKey });
    this.props.onFailed();
  }

  override render(): ReactNode {
    const { failedKey } = this.state;
    return failedKey === "" || failedKey === this.props.resetKey ? null : this.props.children;
  }
}

function ReportReady({ readyKey, onReady }: { readyKey: string; onReady: () => void }) {
  const report = useEffectEvent(onReady);
  useEffect(() => report(), [readyKey]);
  return null;
}

/**
 * Reports `onReady` once every child inside the boundary has resolved and been
 * committed, or `onFailed` if loading or rendering throws. Children that suspend
 * keep the marker unmounted, so readiness cannot be reported early.
 */
export function RenderBoundary({
  resetKey,
  onReady,
  onFailed,
  children,
}: {
  resetKey: string;
  onReady: () => void;
  onFailed: () => void;
  children: ReactNode;
}) {
  return (
    <FailureBoundary resetKey={resetKey} onFailed={onFailed}>
      <Suspense fallback={null}>
        {children}
        <ReportReady readyKey={resetKey} onReady={onReady} />
      </Suspense>
    </FailureBoundary>
  );
}
