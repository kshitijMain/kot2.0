import type { Translator } from '@rp/i18n';
import { ErrorBoundary, ErrorState, LoadingState, ToastProvider } from '@rp/ui-web';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ConsoleProvider, useConsoleState } from './app/console-context.js';
import type { ConsoleController, ConsoleSnapshot } from './app/console-controller.js';
import { I18nProvider, useT } from './app/i18n.js';
import { homeFor, isStationMode, MODES } from './app/modes.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ModeHome } from './screens/ModeHome.js';
import { ModeLayout } from './screens/ModeLayout.js';
import { PairingScreen } from './screens/PairingScreen.js';

/** Where the console opens: pairing, login, the kitchen's station, or the person's home mode. */
export function landingPath(state: ConsoleSnapshot): string {
  if (state.phase !== 'paired') return '/pair';
  if (state.person !== undefined) return `/${homeFor(state.person)}`;
  if (isStationMode(state.device)) return '/kds';
  return '/login';
}

export function ConsoleRoutes() {
  const t = useT();
  const state = useConsoleState();
  if (state.phase === 'loading') {
    return (
      <main className="console-center">
        <LoadingState title={t('states.loading')} />
      </main>
    );
  }
  if (state.clientTooOld) {
    return (
      <main className="console-center">
        <ErrorState
          title={t('console.outdated.title')}
          description={t('console.outdated.description')}
          retryLabel={t('console.outdated.reload')}
          onRetry={() => {
            globalThis.location.reload();
          }}
        />
      </main>
    );
  }
  const unpaired = state.phase === 'unpaired';
  return (
    <Routes>
      <Route
        path="/pair"
        element={unpaired ? <PairingScreen /> : <Navigate to={landingPath(state)} replace />}
      />
      <Route
        path="/login"
        element={
          unpaired || state.person !== undefined ? (
            <Navigate to={landingPath(state)} replace />
          ) : (
            <LoginScreen />
          )
        }
      />
      <Route element={<ModeLayout />}>
        {MODES.map((mode) => (
          <Route key={mode} path={`/${mode}/*`} element={<ModeHome mode={mode} />} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to={landingPath(state)} replace />} />
    </Routes>
  );
}

/**
 * A bug in one screen shows a message with a way back, never a white page (NFR-U04); moving to
 * another screen clears it. The crash is reported like any other page error (NFR-O02).
 */
function ScreenBoundary({
  children,
  onError,
}: {
  children: ReactNode;
  onError: ((error: unknown) => void) | undefined;
}) {
  const t = useT();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      resetKey={pathname}
      {...(onError !== undefined && { onError })}
      fallback={(retry) => (
        <main className="console-center">
          <ErrorState
            title={t('states.crashTitle')}
            description={t('states.crashDescription')}
            retryLabel={t('states.retry')}
            onRetry={retry}
          />
        </main>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/** The console (C3): one app for POS, KDS and the manager dashboard (MGR-001, KDS-001). */
export function App({
  controller,
  translator,
  onError,
}: {
  controller: ConsoleController;
  translator: Translator;
  /** Reports a screen that crashed (NFR-O02). */
  onError?: (error: unknown) => void;
}) {
  return (
    <I18nProvider translator={translator}>
      <ConsoleProvider controller={controller}>
        <ToastProvider>
          <ScreenBoundary onError={onError}>
            <ConsoleRoutes />
          </ScreenBoundary>
        </ToastProvider>
      </ConsoleProvider>
    </I18nProvider>
  );
}
