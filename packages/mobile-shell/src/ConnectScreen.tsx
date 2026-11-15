import { parseConnectQr, parsePairingQr } from '@rp/contracts';
import type { PairingTarget } from '@rp/mobile-core';
import {
  ServerCertificateNameError,
  ServerMismatchError,
  ServerUnreachableError,
} from '@rp/mobile-core';
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
 *
 * It says exactly what failed (round 3 of testing): which address could not be reached or did not
 * answer, or that the PC's certificate changed or does not cover the address. A paired phone whose
 * PC now has another certificate comes back here, and only scanning the PC's code fixes it.
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
  const { notice, wifiWithoutInternet, certificateChanged } = useSessionState();
  const t = useT();
  const removed = notice === 'revoked';
  const [address, setAddress] = useState(servers[0] ?? '');
  const [error, setError] = useState<string | null>(
    certificateChanged ? t('connect.certificateChanged') : null,
  );
  // Working from the start when it connects by itself, so the screen never flashes the form.
  const [working, setWorking] = useState(!removed && !certificateChanged);
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
          setError(problemOf(failure, t, from !== undefined));
        },
      );
  };

  // Once, as the screen opens: the remembered address, mDNS, then the built-in addresses.
  useEffect(() => {
    // A changed certificate: nothing to try by itself, only the PC's code scanned (round 3).
    if (removed || certificateChanged) return;
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
          setError(problemOf(failure, t, false));
        },
      );
    return () => {
      live = false;
    };
    // Once, as the screen opens: a certificate that changes later does not start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- certificateChanged is read once.
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
          {certificateChanged ? null : <Note>{t('connect.wifi')}</Note>}
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
              {certificateChanged ? null : (
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
              )}
            </>
          )}
          {certificateChanged && !inBrowser ? null : (
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
          )}
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

/**
 * What failed, in plain words (round 3 of testing). A certificate that does not match the code a
 * person scanned may be another computer pretending: the phone is not used. One that does not
 * match what the phone knew means the PC was set up again: scanning the PC's code fixes it.
 */
export function problemOf(failure: unknown, t: ReturnType<typeof useT>, scanned: boolean): string {
  if (failure instanceof ServerUnreachableError) {
    if (failure.failures.length === 0) return t('connect.failed');
    const where = (reason: string) =>
      [
        ...new Set(
          failure.failures
            .filter((entry) => entry.reason === reason)
            .map((entry) => addressOf(entry.url)),
        ),
      ].join(', ');
    return [
      where('UNREACHABLE') === ''
        ? null
        : t('connect.unreachable', { address: where('UNREACHABLE') }),
      where('TIMEOUT') === '' ? null : t('connect.noAnswer', { address: where('TIMEOUT') }),
    ]
      .filter((line) => line !== null)
      .join('\n');
  }
  if (failure instanceof ServerCertificateNameError) {
    return t('connect.certificateName', { address: addressOf(failure.serverUrl) });
  }
  if (failure instanceof ServerMismatchError) {
    return t(scanned ? 'connect.mismatch' : 'connect.certificateChanged');
  }
  return messageOf(failure, t);
}

/** `https://192.168.1.4:8080/` → `192.168.1.4:8080`: the address as the PC shows it. */
export function addressOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}
