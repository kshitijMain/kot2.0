import { elevation, fontSize, fontWeight, spacing } from '@rp/design-tokens';
import { Text, useKeyboardHeight, useScreenInsets, useTheme, weight } from '@rp/ui-native';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { BrandLogo } from './brand.js';
import { useSessionState, useT } from './context.js';
import { LicenceBanner } from './licence.js';

/** Says so when the server cannot be reached; nothing while connected (NFR-A01). */
export function ConnectionBanner() {
  const { connection } = useSessionState();
  const t = useT();
  const { colors } = useTheme();
  if (connection === 'online' || connection === 'stopped') return null;
  const offline = connection === 'offline';
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="connection-banner"
      style={[
        styles.banner,
        { backgroundColor: offline ? colors.warningSubtle : colors.infoSubtle },
      ]}
    >
      <Text style={{ color: offline ? colors.warningText : colors.infoText }}>
        {t(offline ? 'connection.offline' : 'connection.connecting')}
      </Text>
    </View>
  );
}

/**
 * A full screen with the connection banner, the licence's banner (LIC-005), a title and scrolling
 * content; `footer` stays at the bottom while the content scrolls (e.g. the order's Send button).
 * Android draws the app under the status bar and the navigation bar, so the screen keeps clear of
 * both: nothing sits under the clock or the phone's back and home buttons. Alerts are Android
 * notifications, with `AlertBell` in a header for those missed (2026-10-25).
 */
export function Screen({
  title,
  actions,
  footer,
  brand = false,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  /** The Parossa logo above the title: pairing and sign-in (ADR-0022). */
  brand?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useScreenInsets();
  // Edge to edge, Android no longer shrinks the screen for the keyboard (P9-21).
  const keyboard = useKeyboardHeight();
  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingBottom: keyboard,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <ConnectionBanner />
      <LicenceBanner />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          brand && styles.branded,
          footer === undefined && { paddingBottom: spacing[5] + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {brand ? <BrandLogo /> : null}
        {title !== undefined && (
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {title}
            </Text>
            {actions}
          </View>
        )}
        {children}
      </ScrollView>
      {footer === undefined ? null : (
        <View
          testID="screen-footer"
          style={[
            styles.footer,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: spacing[3] + insets.bottom,
            },
          ]}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

/** A line of plain text in the theme's colours; `tone` for errors and hints. */
export function Note({
  children,
  tone = 'muted',
  testID,
}: {
  children: string;
  tone?: 'muted' | 'danger' | 'text';
  testID?: string;
}) {
  const { colors } = useTheme();
  const color =
    tone === 'danger' ? colors.dangerText : tone === 'text' ? colors.text : colors.textMuted;
  return (
    <Text
      testID={testID}
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={[styles.note, { color }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banner: { paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  content: { padding: spacing[5], gap: spacing[4] },
  branded: { paddingTop: spacing[8], gap: spacing[5] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  title: { flexShrink: 1, fontSize: fontSize['2xl'], fontWeight: weight(fontWeight.bold) },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
    borderTopWidth: 1,
    elevation: elevation[2].androidElevation,
  },
  note: { fontSize: fontSize.md },
});
