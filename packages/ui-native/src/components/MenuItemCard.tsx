import { elevation, fontSize, fontWeight, radius, spacing, touchTarget } from '@rp/design-tokens';
import { formatRupees, type Paise } from '@rp/domain';
import { type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import { useTheme, weight } from '../theme.js';
import { DishPhoto } from './DishPhoto.js';
import { Money } from './Money.js';
import { Text } from './Text.js';

export type FoodType = 'VEG' | 'NON_VEG' | 'EGG';

export interface MenuItemCardProps {
  name: string;
  price: Paise;
  foodType: FoodType;
  /** The food type in words, e.g. "Veg" (the mark alone is not enough, NFR-U05). */
  foodTypeLabel: string;
  /** A short note, e.g. "Choose options", "Combo" or "5 left". */
  note?: string;
  /** Why it cannot be ordered, e.g. "Sold out"; the card is then disabled. */
  unavailable?: string;
  onSelect?: () => void;
  /**
   * The dish's photo beside its name, or null for the placeholder (MENU-008). Left out, the card
   * has no photo area at all.
   */
  photo?: ImageSourcePropType | null;
  testID?: string;
}

/** The Indian veg / non-veg / egg mark colours, as in `@rp/ui-web`. */
const FOOD_TONE = { VEG: 'success', NON_VEG: 'danger', EGG: 'warning' } as const;

/**
 * One dish on an ordering screen (MENU-012): name, price, the veg/non-veg/egg mark and a note, as
 * a large touch target (NFR-U03), with the dish's photo (or the placeholder) when given. The native
 * twin of `@rp/ui-web` MenuItemCard.
 */
export function MenuItemCard({
  name,
  price,
  foodType,
  foodTypeLabel,
  note,
  unavailable,
  onSelect,
  photo,
  testID,
}: MenuItemCardProps) {
  const { colors } = useTheme();
  const spoken = [name, formatRupees(price), foodTypeLabel, unavailable ?? note].filter(
    (part): part is string => part !== undefined,
  );
  const off = unavailable !== undefined;
  const mark = colors[FOOD_TONE[foodType]];
  const detail = unavailable ?? note;
  const details = (
    <>
      <View style={styles.top}>
        <View testID={`food-${foodType}`} style={[styles.mark, { borderColor: mark }]}>
          {foodType === 'NON_VEG' ? (
            // A triangle, as on Indian food labels: the shape tells it apart, not only the colour.
            <View style={[styles.markTriangle, { borderBottomColor: mark }]} />
          ) : (
            <View style={[styles.markDot, { backgroundColor: mark }]} />
          )}
        </View>
        <Text numberOfLines={3} style={[styles.name, { color: colors.text }]}>
          {name}
        </Text>
      </View>
      <Money paise={price} strong />
      {detail === undefined ? null : (
        <Text style={{ color: off ? colors.dangerText : colors.textMuted, fontSize: fontSize.sm }}>
          {detail}
        </Text>
      )}
    </>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spoken.join(', ')}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: off ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        photo !== undefined && styles.withPhoto,
      ]}
    >
      {photo === undefined ? (
        details
      ) : (
        <>
          {/* The card's label names the dish, so the photo itself is decorative here. */}
          <DishPhoto
            source={photo ?? undefined}
            alt=""
            style={styles.photo}
            {...(testID !== undefined && { testID: `${testID}-photo` })}
          />
          <View style={styles.body}>{details}</View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: touchTarget.comfortable * 2,
    padding: spacing[4],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    elevation: elevation[1].androidElevation,
  },
  /**
   * With a photo: a short strip above the name (P9-21). Beside it, in the phone's two columns, the
   * name had a few letters' width and broke mid-word ("Pan eer …").
   */
  withPhoto: { padding: spacing[3] },
  photo: { width: '100%', aspectRatio: 2, borderRadius: radius.md },
  body: { gap: spacing[2] },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  mark: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markDot: { width: 7, height: 7, borderRadius: radius.full },
  markTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  name: { flex: 1, fontSize: fontSize.md, fontWeight: weight(fontWeight.semibold) },
});
