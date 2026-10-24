import { fontSize, spacing } from '@rp/design-tokens';
import { useT } from '@rp/mobile-shell';
import { Text, useTheme } from '@rp/ui-native';
import { StyleSheet } from 'react-native';

/**
 * The one place Parossa shows on a diner's screen (NFR-U02, ADR-0022): a quiet line under the
 * restaurant's own brand.
 */
export function PoweredBy() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Text testID="powered-by" style={[styles.line, { color: colors.textMuted }]}>
      {t('app.poweredBy')}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: { paddingVertical: spacing[1], fontSize: fontSize.xs, textAlign: 'center' },
});
