import type { AlertView } from '@rp/contracts';
import { fontSize, fontWeight, radius, spacing, touchTarget } from '@rp/design-tokens';
import type { AlertCenterSnapshot } from '@rp/mobile-core';
import { alertAge, describeAlert } from '@rp/ordering';
import { Button, Glyph, Sheet, Text, useTheme, weight } from '@rp/ui-native';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useDeviceSession, useT } from './context.js';
import { useNow } from './use-now.js';

/** How often the alerts' ages ("4 min ago") are brought up to date. */
const AGE_TICK_MS = 30_000;

/** The alerts of the person this phone alerts (P2-06a, WTR-006); re-renders when they change. */
export function useAlerts(): AlertCenterSnapshot {
  const session = useDeviceSession();
  return useSyncExternalStore(session.alerts.subscribe, session.alerts.getSnapshot);
}

/**
 * The bell in a screen's header (WTR-006): how many of the holder's alerts are open, and a tap
 * lists them. The alerts themselves ring as Android notifications, which come and go; this is
 * where a missed one can be read again. Nobody acknowledges them here (Business Owner,
 * 2026-10-25): each goes when its cause is dealt with. A tap on one with a table opens it.
 * Nothing shows on a device that follows no one's alerts (the table tablet).
 */
export function AlertBell({ onOpenTable }: { onOpenTable?: (tableSessionId: string) => void }) {
  const { holder, alerts } = useAlerts();
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  if (holder === null) return null;
  const count = alerts.length;
  return (
    <>
      <Button
        variant={count > 0 ? 'primary' : 'ghost'}
        startIcon={
          <Glyph
            name="bell"
            color={count > 0 ? colors.onPrimary : colors.text}
            size={fontSize.md}
          />
        }
        accessibilityLabel={t('alerts.bellLabel', { count })}
        testID="alert-bell"
        onPress={() => {
          setOpen(true);
        }}
      >
        {String(count)}
      </Button>
      {open ? (
        <AlertsSheet
          onClose={close}
          {...(onOpenTable !== undefined && {
            onOpenTable: (sessionId: string) => {
              close();
              onOpenTable(sessionId);
            },
          })}
        />
      ) : null}
    </>
  );
}

/** Every open alert, newest first, with its age and whether the managers were told. */
function AlertsSheet({
  onClose,
  onOpenTable,
}: {
  onClose: () => void;
  onOpenTable?: (tableSessionId: string) => void;
}) {
  const { alerts } = useAlerts();
  const t = useT();
  const { colors } = useTheme();
  const now = useNow(AGE_TICK_MS);
  return (
    <Sheet open onClose={onClose} title={t('alerts.title')}>
      {alerts.length === 0 ? (
        <Text testID="alerts-none" style={[styles.note, { color: colors.textMuted }]}>
          {t('alerts.none')}
        </Text>
      ) : null}
      {[...alerts].reverse().map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          now={now}
          {...(onOpenTable !== undefined && { onOpenTable })}
        />
      ))}
    </Sheet>
  );
}

function AlertRow({
  alert,
  now,
  onOpenTable,
}: {
  alert: AlertView;
  now: number;
  onOpenTable?: (tableSessionId: string) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const { title, detail } = describeAlert(alert, t);
  const facts = [
    alertAge(alert.createdAt, now, t),
    alert.repeatCount > 0 ? t('alerts.reminded', { count: alert.repeatCount }) : null,
    alert.escalatedAt === null ? null : t('alerts.escalated'),
  ].filter((fact) => fact !== null);
  const sessionId = alert.tableSessionId;
  const opens = sessionId !== null && onOpenTable !== undefined;
  return (
    <Pressable
      testID={`alert-${alert.id}`}
      disabled={!opens}
      accessibilityRole={opens ? 'button' : 'text'}
      accessibilityLabel={[title, detail, ...facts].filter((part) => part !== null).join('. ')}
      {...(opens && { accessibilityHint: t('alerts.openTable') })}
      onPress={() => {
        if (sessionId !== null) onOpenTable?.(sessionId);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {detail === null ? null : (
          <Text style={[styles.facts, { color: colors.text }]}>{detail}</Text>
        )}
        <Text style={[styles.facts, { color: colors.textMuted }]}>{facts.join(' · ')}</Text>
      </View>
      {opens ? (
        <Text style={[styles.open, { color: colors.primary }]}>{t('alerts.open')}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.md, fontWeight: weight(fontWeight.bold) },
  facts: { fontSize: fontSize.sm },
  note: { fontSize: fontSize.md },
  open: { fontSize: fontSize.md, fontWeight: weight(fontWeight.semibold) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: touchTarget.min,
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  rowText: { flex: 1, gap: spacing[1] },
});
