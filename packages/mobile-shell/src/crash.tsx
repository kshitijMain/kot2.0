import { fontSize, fontWeight, spacing } from '@rp/design-tokens';
import type { Translator } from '@rp/i18n';
import { Button, ErrorBoundary, Text, ThemeProvider, useTheme } from '@rp/ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from './context.js';
import { Note, Screen } from './Screen.js';

/**
 * A bug in one screen shows a message with a way back, never a blank app (NFR-U04). Goes inside
 * `ShellProvider`; a change of `resetKey` (the screen shown) clears it.
 */
export function ScreenBoundary({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey?: unknown;
}) {
  const t = useT();
  return (
    <ErrorBoundary
      resetKey={resetKey}
      fallback={(retry) => (
        <Screen title={t('states.crashTitle')}>
          <Note tone="text" testID="screen-crashed">
            {t('states.crashDescription')}
          </Note>
          <Button onPress={retry} fullWidth>
            {t('states.retry')}
          </Button>
        </Screen>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function StartupFailedView({ t, onRetry }: { t: Translator; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.startup, { backgroundColor: colors.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {t('mobile.startupFailed.title')}
      </Text>
      <Text style={{ color: colors.textMuted }}>{t('mobile.startupFailed.description')}</Text>
      <Button onPress={onRetry} fullWidth>
        {t('states.retry')}
      </Button>
    </View>
  );
}

/**
 * The app could not start (its secure storage or a native module failed): says so with a way to
 * try again, instead of a blank screen. Shown before there is a device session to say anything
 * else (NFR-U04).
 */
export function StartupFailed({
  translator,
  onRetry,
}: {
  translator: Translator;
  onRetry: () => void;
}) {
  return (
    <ThemeProvider>
      <StartupFailedView t={translator} onRetry={onRetry} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  startup: { flex: 1, justifyContent: 'center', padding: spacing[6], gap: spacing[4] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
});
