import { createContext, type ReactNode, use } from 'react';

/** The room the system bars take on each edge of the screen, in points. */
export interface ScreenInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const NONE: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const InsetsContext = createContext<ScreenInsets>(NONE);

/**
 * Android draws apps edge to edge, under the status bar and the navigation bar, so screens,
 * sheets and toasts keep clear of them with these insets. The app gives them from
 * `react-native-safe-area-context`; without a provider (tests, a kiosk without bars) they are 0.
 */
export function ScreenInsetsProvider({
  insets,
  children,
}: {
  insets: ScreenInsets;
  children: ReactNode;
}) {
  return <InsetsContext value={insets}>{children}</InsetsContext>;
}

export function useScreenInsets(): ScreenInsets {
  return use(InsetsContext);
}
