import type { KdsTheme } from '@rp/contracts';
import type { ThemeName } from '@rp/design-tokens';
import { createContext, type ReactNode, useContext, useEffect } from 'react';

/** The design theme for the `kds.theme` setting (KDS-011, ADR-0022). */
export function kdsThemeName(theme: KdsTheme): ThemeName {
  return theme === 'DARK' ? 'kds-dark' : 'kds';
}

const KdsThemeContext = createContext<(theme: ThemeName) => void>(() => undefined);

/**
 * Lets the kitchen display set the theme of the whole frame, header included: the setting arrives
 * with the tickets, and the frame around the screen is drawn by the mode layout.
 */
export function KdsThemeProvider({
  onTheme,
  children,
}: {
  onTheme: (theme: ThemeName) => void;
  children: ReactNode;
}) {
  return <KdsThemeContext.Provider value={onTheme}>{children}</KdsThemeContext.Provider>;
}

/** Applies the kitchen screen's theme setting once it is known, and again when it changes. */
export function useKdsTheme(theme: KdsTheme | undefined): void {
  const setTheme = useContext(KdsThemeContext);
  useEffect(() => {
    if (theme !== undefined) setTheme(kdsThemeName(theme));
  }, [setTheme, theme]);
}
