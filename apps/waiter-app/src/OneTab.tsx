import type { Translator } from '@rp/i18n';
import type { ReactNode } from 'react';

/**
 * One app per phone: on Android there is nothing to guard (the browser build's twin,
 * OneTab.web.tsx, keeps the app to one tab, P9-28).
 */
export function OneTab({
  children,
}: {
  translator: Translator;
  onElsewhere: () => void;
  children: ReactNode;
}) {
  return children;
}
