import { Image, StyleSheet } from 'react-native';
import logo from '../assets/parossa-logo.png';
import { useT } from './context.js';

/**
 * The Parossa logo (brand/parossa, ADR-0022) for the pairing and sign-in screens, bundled with the
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
  // The file's own proportions (1910 × 544).
  logo: { height: 36, aspectRatio: 1910 / 544, alignSelf: 'center' },
});
