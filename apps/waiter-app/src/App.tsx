import { SIGN_IN_ROLES } from '@rp/domain';
import type { Translator } from '@rp/i18n';
import type { ApkUpdater, DeviceSession, OtaUpdater } from '@rp/mobile-core';
import type { AlertTableOpener, NotificationPermission } from '@rp/mobile-native';
import {
  LoginScreen,
  PairingScreen,
  ScreenBoundary,
  ShellProvider,
  UpdateRequiredScreen,
  useAppUpdateWhenFree,
  useSessionState,
} from '@rp/mobile-shell';
import { ScreenInsetsProvider, ToastProvider } from '@rp/ui-native';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NotificationsProvider } from './notifications';
import { SignedIn } from './SignedIn';

/** Who may sign in on a waiter phone: waiters (2026-10-25); the server says the same. */
const WAITER_APP_ROLES = SIGN_IN_ROLES.WAITER_PHONE ?? ['WAITER'];

/** The status and navigation bars' room, for screens drawn edge to edge. */
function SystemBars({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <ScreenInsetsProvider insets={insets}>{children}</ScreenInsetsProvider>;
}

function Screens({
  notifications,
  opener,
}: {
  notifications: NotificationPermission | undefined;
  opener: AlertTableOpener | undefined;
}) {
  const { phase, person, clientTooOld } = useSessionState();
  // An over-the-air update restarts the app only while nobody is signed in on it (P7-04e1).
  useAppUpdateWhenFree(person !== undefined);
  if (phase === 'loading') return null;
  if (clientTooOld) return <UpdateRequiredScreen />;
  if (phase === 'unpaired') return <PairingScreen />;
  if (person === undefined) return <LoginScreen roles={WAITER_APP_ROLES} />;
  // Notifications are asked for as someone signs in (P2-06b).
  return (
    <NotificationsProvider permission={notifications}>
      <SignedIn {...(opener !== undefined && { opener })} />
    </NotificationsProvider>
  );
}

/**
 * The waiter app: pair, sign in with a PIN, then "My tables" and each table's orders (WTR-001 to
 * WTR-003, WTR-012), with the waiter's alerts as Android notifications, inside and outside the app,
 * through `notifications` (WTR-005, WTR-006); `opener` opens the table of a tapped one. `updater`
 * brings over-the-air updates (P7-04e1), `apkUpdater` new APKs from the PC (P7-04e2).
 */
export function App({
  session,
  translator,
  notifications,
  opener,
  updater,
  apkUpdater,
}: {
  session: DeviceSession;
  translator: Translator;
  notifications?: NotificationPermission;
  opener?: AlertTableOpener;
  updater?: OtaUpdater;
  apkUpdater?: ApkUpdater;
}) {
  return (
    <SafeAreaProvider>
      <SystemBars>
        <ShellProvider
          session={session}
          translator={translator}
          {...(updater !== undefined && { updater })}
          {...(apkUpdater !== undefined && { apkUpdater })}
        >
          <ToastProvider>
            <StatusBar style="dark" />
            <ScreenBoundary>
              <Screens notifications={notifications} opener={opener} />
            </ScreenBoundary>
          </ToastProvider>
        </ShellProvider>
      </SystemBars>
    </SafeAreaProvider>
  );
}
