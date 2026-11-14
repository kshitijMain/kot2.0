import type { StaffTile } from '@rp/contracts';
import { spacing } from '@rp/design-tokens';
import { Button, PinPad } from '@rp/ui-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { onBackPress } from './back.js';
import { useAlerts } from './alerts.js';
import { ApkOffer } from './ApkOffer.js';
import { useDeviceSession, useSessionState, useT } from './context.js';
import { messageOf } from './messages.js';
import { Note, Screen } from './Screen.js';
import { useLive } from './use-live.js';

const NEVER = () => false;

/**
 * Staff tap their name and enter their PIN (AUTH-001, AUTH-002, AUTH-004). A waiter phone is
 * usually one waiter's: it opens on the PIN pad of the person it alerts (who last signed in on
 * it), with "Not you?" for the list. Back on the PIN pad goes back to the list.
 */
export function LoginScreen({ roles }: { roles?: readonly StaffTile['role'][] }) {
  const session = useDeviceSession();
  const { notice } = useSessionState();
  const { holder } = useAlerts();
  const t = useT();
  const { data, reload } = useLive(() => session.staffTiles(), NEVER);
  const [chosen, setChosen] = useState<StaffTile | null>(null);
  /** "Not you?" pressed: the list, not the phone's usual person. */
  const [listed, setListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = (tile: StaffTile) => roles === undefined || roles.includes(tile.role);
  const usual =
    listed || holder === null || data.status !== 'ready'
      ? undefined
      : data.value.find((tile) => tile.staffId === holder.staffId && allowed(tile));
  const person = chosen ?? usual ?? null;

  const backToList = () => {
    setChosen(null);
    setListed(true);
    setError(null);
  };
  const choosing = person !== null;
  useEffect(() => {
    if (!choosing) return undefined;
    return onBackPress(() => {
      setChosen(null);
      setListed(true);
      setError(null);
      return true;
    });
  }, [choosing]);

  const signIn = (pin: string) => {
    if (person === null) return;
    setBusy(true);
    setError(null);
    session.signIn(person.staffId, pin).then(
      () => {
        setBusy(false);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(messageOf(failure, t));
      },
    );
  };

  const noticeText =
    notice === 'signedOutInactive'
      ? t('login.signedOutInactive')
      : notice === 'signedOut'
        ? t('login.signedOut')
        : null;

  if (person !== null) {
    return (
      <Screen title={t('login.pinFor', { name: person.displayName })} brand>
        {chosen === null && noticeText !== null ? <Note tone="danger">{noticeText}</Note> : null}
        <PinPad
          label={t('login.pinFor', { name: person.displayName })}
          onComplete={signIn}
          error={error}
          busy={busy}
        />
        <Button variant="secondary" testID="login-not-you" onPress={backToList}>
          {t('login.notYou')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={t('mobile.staffTitle')} brand>
      {/* A new version of the app on the restaurant PC, installed before anyone signs in (P7-04e2). */}
      <ApkOffer />
      {noticeText !== null && <Note tone="danger">{noticeText}</Note>}
      {data.status === 'loading' && <Note>{t('states.loading')}</Note>}
      {data.status === 'error' && (
        <>
          <Note tone="danger">{messageOf(data.error, t)}</Note>
          <Button variant="secondary" onPress={reload}>
            {t('states.retry')}
          </Button>
        </>
      )}
      {data.status === 'ready' && (
        <View style={styles.tiles}>
          {(() => {
            const staff = data.value.filter(allowed);
            if (staff.length === 0) return <Note>{t('login.noStaff')}</Note>;
            return staff.map((tile) => (
              <Button
                key={tile.staffId}
                testID={`staff-${tile.staffId}`}
                variant="secondary"
                size="lg"
                fullWidth
                accessibilityLabel={`${tile.displayName}, ${t(`roles.${tile.role}`)}`}
                onPress={() => {
                  session.dismissNotice();
                  setChosen(tile);
                }}
              >
                {tile.displayName}
              </Button>
            ));
          })()}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { gap: spacing[2] },
});
