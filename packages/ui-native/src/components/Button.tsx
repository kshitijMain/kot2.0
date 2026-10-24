import { elevation, fontSize, fontWeight, radius, spacing, touchTarget } from '@rp/design-tokens';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { useTheme, weight } from '../theme.js';
import { Text } from './Text.js';

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'accent'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  /** The button's words, from the i18n catalogue. */
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /** `md` meets the 48 dp touch minimum (NFR-U03); `lg` is for primary actions. */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner, marks the button busy and blocks repeat presses (e.g. double submission). */
  loading?: boolean;
  disabled?: boolean;
  /** For a button that is one of a set of choices (e.g. a menu category): whether it is chosen. */
  selected?: boolean;
  startIcon?: ReactNode;
  /** A longer accessible name when the words alone are not enough. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The native twin of `@rp/ui-web` Button: same variants, sizes and loading behaviour. */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  selected,
  startIcon,
  accessibilityLabel,
  testID,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: {
      background: colors.primary,
      pressed: colors.primaryActive,
      text: colors.onPrimary,
      border: colors.primary,
    },
    accent: {
      background: colors.accent,
      pressed: colors.accent,
      text: colors.onAccent,
      border: colors.accent,
    },
    danger: {
      background: colors.danger,
      pressed: colors.dangerText,
      text: colors.onDanger,
      border: colors.danger,
    },
    secondary: {
      background: colors.surface,
      pressed: colors.surfaceSunken,
      text: colors.text,
      border: colors.borderStrong,
    },
    ghost: {
      background: 'transparent',
      pressed: colors.surfaceSunken,
      text: colors.primary,
      border: 'transparent',
    },
  }[variant];
  const raised = variant !== 'ghost' && !inactive;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled: inactive,
        busy: loading,
        ...(selected !== undefined && { selected }),
      }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'lg' ? touchTarget.comfortable : touchTarget.min,
          backgroundColor: pressed ? palette.pressed : palette.background,
          borderColor: palette.border,
          opacity: inactive ? 0.5 : 1,
          elevation: raised && !pressed ? elevation[1].androidElevation : 0,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        fullWidth && styles.full,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.text} /> : startIcon}
      <Text
        style={[
          styles.label,
          { color: palette.text, fontSize: size === 'lg' ? fontSize.lg : fontSize.md },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  full: { alignSelf: 'stretch' },
  label: { fontWeight: weight(fontWeight.semibold) },
});
