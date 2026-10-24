import { fontSize, fontWeight, radius, spacing, touchTarget } from '@rp/design-tokens';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme, weight } from '../theme.js';
import { Text } from './Text.js';

export interface SegmentOption {
  readonly id: string;
  readonly label: string;
}

export interface SegmentedControlProps {
  /** What the choice is about, for screen readers, e.g. "Which tables to show". */
  label: string;
  options: readonly SegmentOption[];
  value: string;
  onChange: (id: string) => void;
}

/** Two or three views of the same screen side by side, e.g. "My tables" and "All tables". */
export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.group, { backgroundColor: colors.surfaceSunken }]}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option.id);
            }}
            style={[styles.option, { backgroundColor: selected ? colors.primary : 'transparent' }]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: selected ? colors.onPrimary : colors.textMuted,
                  fontWeight: weight(selected ? fontWeight.semibold : fontWeight.medium),
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: spacing[1], padding: spacing[1], borderRadius: radius.full },
  option: {
    flex: 1,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
  },
  label: { fontSize: fontSize.md },
});
