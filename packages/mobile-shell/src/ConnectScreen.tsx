import { parseConnectQr, parsePairingQr } from '@rp/contracts';
import type { PairingTarget } from '@rp/mobile-core';
import { ServerMismatchError, ServerUnreachableError } from '@rp/mobile-core';
import { Button, TextField } from '@rp/ui-native';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useDeviceSession, useSessionState, useT } from './context.js';
import { messageOf } from './messages.js';
import { Note, Screen } from './Screen.js';

/** No address built in: one array for every render, so the screen connects once. */
const NO_SERVERS: readonly string[] = [];

const QrScanner = lazy(() =>
  import('./QrScanner.js').then((module) => ({ default: module.QrScanner })),
);

/**
 * The waiter app connects to the restaurant PC by itself (ADR-0025, P9-27): nobody pairs a phone
 * or compares a fingerprint. As soon as it opens it looks for the PC: the address that worked
 * last, the PC announcing itself on the Wi-Fi (mDNS), then the addresses the app was built with.
 * When none answers it says what to check, with "Scan the code on the PC" (the Connect QR code in
 * Manage → Devices: the PC's addresses and certificate), "Try again" and the PC's address for the
 * day nothing else works. On a Wi-Fi without internet it says to keep Wi-Fi on and turn on mobile
 * data. A phone a manager removed connects again only when someone presses Connect.
 */
export function ConnectScreen({
  servers = NO_SERVERS,
  caSha256,
}: {
  /** The restaurant PC's addresses the app was built with (pilot builds); usually none. */
  servers?: readonly string[];
  /** The fingerprint of the PC's certificate the app was built with; else trusted on first use. */
  caSha256?: string;
}) {
  const session = useDeviceSession();
  const { notice, wifiWithoutInternet } = useSessionState();
  const t = useT();
  const removed = notice === 'revoked';
  const [address, setAddress] = useState(servers[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  // Working from the start when it connects by itself, so the screen never flashes the form.
  const [working, setWorking] = useState(!removed);
  const [scanning, setScanning] = useState(false);
  /** The Connect QR code scanned: its addresses and the PC's certificate, kept for Try again. */
  const [scanned, setScanned] = useState<PairingTarget | undefined>(undefined);

  const builtIn = (to: readonly string[]): PairingTarget => ({
    servers: to,
    ...(caSha256 !== undefined && { caSha256 }),
  });

  const connect = (to: readonly string[], from: PairingTarget | undefined = scanned) => {
    setWorking(true);
    setError(null);
    session
      .connectByItself({ builtIn: builtIn(to), ...(from !== undefined && { scanned: from }) })
      .then(
        () => {
          setWorking(false);
        },
        (failure: unknown) => {
          setWorking(false);
          setError(problemOf(failure, t));
        },
      );
  };

  // Once, as the screen opens: the remembered address, mDNS, then the built-in addresses.
  useEffect(() => {
    if (removed) return;
    let live = true;
    session
      .connectByItself({
        builtIn: { servers, ...(caSha256 !== undefined && { caSha256 }) },
      })
      .then(
        () => {
          if (live) setWorking(false);
        },
        (failure: unknown) => {
          if (!live) return;
          setWorking(false);
          setError(problemOf(failure, t));
        },
      );
    return () => {
      live = false;
    };
  }, [session, servers, caSha256, removed, t]);

  const onScanned = (data: string) => {
    setScanning(false);
    const target = connectTargetOf(data);
    if (target === undefined) {
      setError(t('connect.notConnectCode'));
      return;
    }
    setScanned(target);
    connect(servers, target);
  };

  if (scanning) {
    return (
      <Screen title={t('connect.scanTitle')}>
        <Suspense fallback={<Note>{t('pairing.cameraStarting')}</Note>}>
          <QrScanner
            hint={t('connect.scanHint')}
            cancelLabel={t('connect.scanCancel')}
            onScanned={onScanned}
            onCancel={() => {
              setScanning(false);
            }}
          />
        </Suspense>
      </Screen>
    );
  }

  const typed = address.trim();
  // In a browser (P9-28) the page came from the PC: nothing to scan or type, only Try again.
  const inBrowser = Platform.OS === 'web';
  return (
    <Screen title={t('connect.title')} brand>
      {removed ? <Note tone="danger">{t('connect.removed')}</Note> : null}
      {wifiWithoutInternet ? (
        <Note tone="text" testID="connect-no-internet">
          {t('connect.wifiNoInternet')}
        </Note>
      ) : null}
      {working ? (
        <Note tone="text" testID="connect-working">
          {t('connect.working')}
        </Note>
      ) : null}
      {error === null ? null : (
        <>
          <Note tone="danger" testID="connect-error">
            {error}
          </Note>
          <Note>{t('connect.wifi')}</Note>
        </>
      )}
      {working ? null : (
        <>
          {inBrowser ? null : (
            <>
              <Button
                testID="connect-scan"
                variant={error === null && !removed ? 'secondary' : 'primary'}
                size="lg"
                fullWidth
                onPress={() => {
                  setError(null);
                  setScanning(true);
                }}
              >
                {t('connect.scan')}
              </Button>
              <TextField
                label={t('connect.address')}
                hint={t('connect.addressHint')}
                value={address}
                onChangeText={setAddress}
                testID="connect-address"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </>
          )}
          <Button
            testID="connect-retry"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => {
              // The address typed first, then the ones the app was built with.
              connect(typed === '' ? servers : [...new Set([typed, ...servers])]);
            }}
          >
            {error === null ? t('connect.connectAgain') : t('connect.retry')}
          </Button>
        </>
      )}
    </Screen>
  );
}

/**
 * Where a scanned code says the PC is: the Connect QR code (P9-27), or a pairing QR code a
 * manager showed instead, whose addresses and certificate serve just as well.
 */
export function connectTargetOf(data: string): PairingTarget | undefined {
  const connectCode = parseConnectQr(data);
  if (connectCode !== undefined) {
    return {
      servers: connectCode.urls,
      ...(connectCode.ca !== undefined && { caSha256: connectCode.ca }),
    };
  }
  const pairingCode = parsePairingQr(data);
  if (pairingCode?.urls === undefined || pairingCode.urls.length === 0) return undefined;
  return {
    servers: pairingCode.urls,
    ...(pairingCode.ca !== undefined && { caSha256: pairingCode.ca }),
  };
}

function problemOf(failure: unknown, t: ReturnType<typeof useT>): string {
  if (failure instanceof ServerUnreachableError) return t('connect.failed');
  if (failure instanceof ServerMismatchError) return t('connect.mismatch');
  return messageOf(failure, t);
}
