import { useT } from './i18n.js';

/**
 * The Parosaa wordmark (brand/parosaa, ADR-0028), served with the console so it shows offline. Its
 * text alternative is the product's name.
 */
export function BrandLogo({
  size = 'md',
  onDark = false,
}: {
  size?: 'sm' | 'md';
  /** On a dark theme (the dark kitchen screen): the logo drawn for dark backgrounds. */
  onDark?: boolean;
}) {
  const t = useT();
  return (
    <img
      src={onDark ? '/wordmark-on-dark.svg' : '/wordmark.svg'}
      alt={t('app.name')}
      className="console-brand"
      data-size={size}
      // The file's own proportions (959 × 271), so the space is kept while it loads.
      width={size === 'sm' ? 113 : 142}
      height={size === 'sm' ? 32 : 40}
    />
  );
}
