import { radius, spacing } from '@rp/design-tokens';
import { displayDateTime } from '@rp/domain';
import { type LiveData, messageOf, Note, useDeviceSession, useLive, useT } from '@rp/mobile-shell';
import type { BreakView } from '@rp/contracts';
import { Button, Text, toneColors, useTheme } from '@rp/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** The waiter's break (NTF-009), read once and set from wherever it shows. */
export interface BreakState {
  readonly data: LiveData<BreakView>;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly set: (onBreak: boolean) => void;
}

/** One break state for the home screen and its menu, so both say the same. */
export function useBreak(): BreakState {
  const session = useDeviceSession();
  const t = useT();
  const { data, reload } = useLive(
    () => session.api.getMyBreak(),
    () => false,
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const set = (next: boolean) => {
    setBusy(true);
    setFailure(undefined);
    session.api.setMyBreak({ body: { onBreak: next } }).then(
      () => {
        setBusy(false);
        reload();
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(messageOf(error, t));
      },
    );
  };
  return { data, busy, failure, set };
}

/**
 * "On break" (NTF-009): while the waiter is on break, their alerts go to the manager on duty; the
 * card says so and brings them back with one tap. `onlyOnBreak` shows it only during a break, as
 * on the home screen; the menu shows it always, to start one.
 */
export function BreakCard({
  state,
  onlyOnBreak = false,
}: {
  state: BreakState;
  onlyOnBreak?: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const { data, busy, failure, set } = state;

  if (data.status !== 'ready') return null;
  const { onBreak, since } = data.value;
  if (onlyOnBreak && !onBreak) return null;
  const tone = toneColors(colors, 'warning');
  return (
    <View
      testID="break-card"
      style={[
        styles.card,
        // A card only while on break: otherwise its padding indented it in the menu (P9-28).
        onBreak
          ? [styles.onBreak, { backgroundColor: tone.subtle, borderColor: tone.solid }]
          : undefined,
      ]}
      accessibilityRole={onBreak ? 'alert' : 'summary'}
    >
      {onBreak && since !== null ? (
        <Text style={{ color: tone.text }}>
          {t('mobile.break.onBreak', { time: displayDateTime(new Date(since)).time })}
        </Text>
      ) : (
        <Note>{t('mobile.break.hint')}</Note>
      )}
      <Button
        variant={onBreak ? 'primary' : 'secondary'}
        fullWidth
        disabled={busy}
        onPress={() => {
          set(!onBreak);
        }}
      >
        {onBreak ? t('mobile.break.end') : t('mobile.break.start')}
      </Button>
      {failure === undefined ? null : <Note>{failure}</Note>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[2] },
  onBreak: {
    padding: spacing[4],
    borderWidth: 1,
    borderRadius: radius.lg,
  },
});
