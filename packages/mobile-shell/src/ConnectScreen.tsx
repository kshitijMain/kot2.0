import { ServerMismatchError, ServerUnreachableError } from '@rp/mobile-core';
import { Button, TextField } from '@rp/ui-native';
import { useEffect, useState } from 'react';
import { useDeviceSession, useSessionState, useT } from './context.js';
import { messageOf } from './messages.js';
import { Note, Screen } from './Screen.js';

/**
 * The waiter app connects to the restaurant PC by itself (ADR-0025, Business Owner 2026-11-01):
 * nobody pairs a phone, scans a code or compares a fingerprint. It tries the addresses the app
 * was built with as soon as it opens; when none answers it says what to check, with "Try again"
 * and the PC's address for the day the PC moves. A phone a manager removed connects again only
 * when someone presses Connect.
 */
export function ConnectScreen({
  servers,
  caSha256,
}: {
  /** The restaurant PC's addresses the app was built with, e.g. `https://192.168.1.20:8080`. */
  servers: readonly string[];
  /** The fingerprint of the PC's certificate the app was built with; else trusted on first use. */
  caSha256?: string;
}) {
  const session = useDeviceSession();
  const { notice } = useSessionState();
  const t = useT();
  const removed = notice === 'revoked';
  const [address, setAddress] = useState(servers[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  // Working from the start when it connects by itself, so the screen never flashes the form.
  const [working, setWorking] = useState(!removed && servers.length > 0);

  const connect = (to: readonly string[]) => {
    setWorking(true);
    setError(null);
    session.connectByItself({ servers: to, ...(caSha256 !== undefined && { caSha256 }) }).then(
      () => {
        setWorking(false);
      },
      (failure: unknown) => {
        setWorking(false);
        setError(problemOf(failure, t));
      },
    );
  };

  // Once, as the screen opens: the addresses the app was built with.
  useEffect(() => {
    if (removed || servers.length === 0) return;
    let live = true;
    session.connectByItself({ servers, ...(caSha256 !== undefined && { caSha256 }) }).then(
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

  const typed = address.trim();
  return (
    <Screen title={t('connect.title')} brand>
      {removed ? <Note tone="danger">{t('connect.removed')}</Note> : null}
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
          <Button
            testID="connect-retry"
            size="lg"
            fullWidth
            disabled={typed === ''}
            onPress={() => {
              // The address typed first, then the ones the app was built with.
              connect([...new Set([typed, ...servers])]);
            }}
          >
            {error === null ? t('connect.connectAgain') : t('connect.retry')}
          </Button>
        </>
      )}
    </Screen>
  );
}

function problemOf(failure: unknown, t: ReturnType<typeof useT>): string {
  if (failure instanceof ServerUnreachableError) return t('connect.failed');
  if (failure instanceof ServerMismatchError) return t('connect.mismatch');
  return messageOf(failure, t);
}
