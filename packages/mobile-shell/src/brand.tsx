import { Image, StyleSheet } from 'react-native';
import logo from '../assets/wordmark.png';
import { useT } from './context.js';

/**
 * The Parosaa wordmark (brand/parosaa, ADR-0028) for the pairing and sign-in screens, bundled with the
 * app. Customer screens on the table tablet show the restaurant's own brand instead (NFR-U02).
 */
export function BrandLogo() {
  const t = useT();
  return (
    <Image
      source={logo}
      accessibilityRole="image"
      accessibilityLabel={t('app.name')}
      resizeMode="contain"
      style={styles.logo}
    />
  );
}

const styles = StyleSheet.create({
  // The file's own proportions (1200 × 339).
  logo: { height: 36, aspectRatio: 1200 / 339, alignSelf: 'center' },
});
