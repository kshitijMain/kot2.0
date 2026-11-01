import { SIGN_IN_ROLES } from '@rp/domain';
import type { Translator } from '@rp/i18n';
import type { ApkUpdater, DeviceSession, OtaUpdater } from '@rp/mobile-core';
import type { AlertTableOpener, NotificationPermission } from '@rp/mobile-native';
import {
  ConnectScreen,
  LoginScreen,
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
import type { RestaurantPc } from './session';
import { SignedIn } from './SignedIn';

/** Who may sign in on a waiter phone: waiters (2026-10-25); the server says the same. */
const WAITER_APP_ROLES = SIGN_IN_ROLES.WAITER_PHONE ?? ['WAITER'];

/** The status and navigation bars' room, for screens drawn edge to edge. */
function SystemBars({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <ScreenInsetsProvider insets={insets}>{children}</ScreenInsetsProvider>;
}

/** No address built in: the person types the restaurant PC's. */
const NO_RESTAURANT: RestaurantPc = { servers: [] };

function Screens({
  restaurant,
  notifications,
  opener,
}: {
  restaurant: RestaurantPc;
  notifications: NotificationPermission | undefined;
  opener: AlertTableOpener | undefined;
}) {
  const { phase, person, clientTooOld } = useSessionState();
  // An over-the-air update restarts the app only while nobody is signed in on it (P7-04e1).
  useAppUpdateWhenFree(person !== undefined);
  if (phase === 'loading') return null;
  if (clientTooOld) return <UpdateRequiredScreen />;
  // Nobody pairs the phone: it connects to the restaurant PC by itself (ADR-0025, 2026-11-01).
  if (phase === 'unpaired') {
    return (
      <ConnectScreen
        servers={restaurant.servers}
        {...(restaurant.caSha256 !== undefined && { caSha256: restaurant.caSha256 })}
      />
    );
  }
  if (person === undefined) return <LoginScreen roles={WAITER_APP_ROLES} />;
  // Notifications are asked for as someone signs in (P2-06b).
  return (
    <NotificationsProvider permission={notifications}>
      <SignedIn {...(opener !== undefined && { opener })} />
    </NotificationsProvider>
  );
}

/**
 * The waiter app: connect to the restaurant PC by itself, sign in with a PIN, then "My tables" and each table's orders (WTR-001 to
 * WTR-003, WTR-012), with the waiter's alerts as Android notifications, inside and outside the app,
 * through `notifications` (WTR-005, WTR-006); `opener` opens the table of a tapped one. `updater`
 * brings over-the-air updates (P7-04e1), `apkUpdater` new APKs from the PC (P7-04e2).
 */
export function App({
  session,
  translator,
  restaurant = NO_RESTAURANT,
  notifications,
  opener,
  updater,
  apkUpdater,
}: {
  session: DeviceSession;
  translator: Translator;
  /** The restaurant PC the app connects to by itself (ADR-0025). */
  restaurant?: RestaurantPc;
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
              <Screens restaurant={restaurant} notifications={notifications} opener={opener} />
            </ScreenBoundary>
          </ToastProvider>
        </ShellProvider>
      </SystemBars>
    </SafeAreaProvider>
  );
}
