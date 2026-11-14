import type { ThemeName } from '@rp/design-tokens';
import { Button, ConnectionBanner, ThemeRoot } from '@rp/ui-web';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { ConsoleSnapshot } from '../app/console-controller.js';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { BrandLogo } from '../app/brand.js';
import { useT } from '../app/i18n.js';
import { modeOfPath, modesFor, type Person } from '../app/modes.js';
import { AlertPanels, AlertsButton } from '../alerts/AlertCentre.js';
import { AlertsProvider } from '../alerts/alerts-context.js';
import { KdsThemeProvider } from '../kds/kds-theme.js';
import { LicenceBanner } from '../licence/LicenceBanner.js';

function bannerStatus(
  connection: ConsoleSnapshot['connection'],
): 'online' | 'reconnecting' | 'offline' {
  if (connection === 'offline') return 'offline';
  if (connection === 'connecting') return 'reconnecting';
  return 'online';
}

/**
 * The frame of every mode: who is signed in, the modes they may open, sign-out, the connection
 * banner (NFR-P11), the licence's reminder or banner (LIC-005) and, on the POS and the dashboard,
 * the person's alerts (P2-06c, MGR-008). Nobody is signed out for being idle (ADR-0030).
 */
export function ModeLayout() {
  const t = useT();
  const state = useConsoleState();
  const controller = useConsole();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The kitchen display's theme comes with its tickets (`kds.theme`); light until then.
  const [kdsTheme, setKdsTheme] = useState<ThemeName>('kds');
  if (state.phase !== 'paired') return <Navigate to="/pair" replace />;
  const { person } = state;
  const status = bannerStatus(state.connection);
  const mode = modeOfPath(pathname);

  const frame = (
    <ThemeRoot className="console-shell" theme={mode === 'kds' ? kdsTheme : 'light'}>
      <header className="console-header">
        <span className="console-header__app">
          <BrandLogo size="sm" onDark={mode === 'kds' && kdsTheme === 'kds-dark'} />
        </span>
        {person === undefined ? null : <ModeLinks person={person} />}
        <AlertsButton />
        {/* A kitchen screen in station mode has nobody signed in: its own name says which. */}
        {person === undefined ? (
          <span className="console-header__device">{state.device?.name}</span>
        ) : null}
        {person === undefined ? null : (
          <>
            {/* The device's name is for support, not for staff: kept as the hover text (P9-26). */}
            <span
              className="console-header__person"
              title={`${t('modes.device')}: ${state.device?.name ?? ''}`}
            >
              <span className="console-header__name">{person.displayName}</span>
              {/* The role, unless the name says it already ("Kitchen", "Manager (Parosaa)"). */}
              {person.displayName
                .toLowerCase()
                .includes(t(`roles.${person.role}`).toLowerCase()) ? null : (
                <span className="console-header__role">{t(`roles.${person.role}`)}</span>
              )}
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                void controller.signOut().then(() => navigate('/login', { replace: true }));
              }}
            >
              {t('login.signOut')}
            </Button>
          </>
        )}
      </header>
      <ConnectionBanner
        status={status}
        message={status === 'offline' ? t('connection.offline') : t('connection.connecting')}
      />
      {person === undefined ? null : (
        <LicenceBanner paymentReminder={mode === 'pos' || mode === 'manage'} />
      )}
      <main className="console-main">
        <KdsThemeProvider onTheme={setKdsTheme}>
          <Outlet />
        </KdsThemeProvider>
      </main>
      <AlertPanels />
    </ThemeRoot>
  );
  // The kitchen display has its own flags (KDS-006); the POS and the dashboard show alerts.
  if (person === undefined || mode === 'kds') return frame;
  return (
    <AlertsProvider key={person.id} person={person}>
      {frame}
    </AlertsProvider>
  );
}

function ModeLinks({ person }: { person: Person }) {
  const t = useT();
  const modes = modesFor(person);
  if (modes.length < 2) return null;
  return (
    <nav aria-label={t('modes.navigation')} className="console-header__modes">
      {modes.map((mode) => (
        <NavLink key={mode} to={`/${mode}`} className="console-header__mode">
          {t(`modes.${mode}`)}
        </NavLink>
      ))}
    </nav>
  );
}
