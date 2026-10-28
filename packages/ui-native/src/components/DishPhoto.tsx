import { radius } from '@rp/design-tokens';
import { useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme.js';

export interface DishPhotoProps {
  /** The photo; without one (or when it fails to load) the placeholder shows. */
  source?: ImageSourcePropType | undefined;
  /** What the photo shows, e.g. "Paneer Tikka". The placeholder is decorative. */
  alt: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A dish's photo, or a calm placeholder (a plate on the sunken surface) when the restaurant has
 * none, so every menu looks the same with or without photos (MENU-008). The native twin of
 * `@rp/ui-web` DishPhoto.
 */
export function DishPhoto({ source, alt, style, testID }: DishPhotoProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const shown = source !== undefined && !failed;
  return (
    <View testID={testID} style={[styles.frame, { backgroundColor: colors.surfaceSunken }, style]}>
      {shown ? (
        <Image
          source={source}
          accessibilityLabel={alt}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <View
          testID={testID === undefined ? undefined : `${testID}-placeholder`}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[styles.plate, { borderColor: colors.borderStrong }]}
        >
          <View style={[styles.inner, { borderColor: colors.borderStrong }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plate: {
    width: '36%',
    aspectRatio: 1,
    borderWidth: 2,
    borderRadius: radius.full,
    opacity: 0.35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { width: '56%', aspectRatio: 1, borderWidth: 2, borderRadius: radius.full },
});
