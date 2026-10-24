import { useT } from './i18n.js';

/**
 * The Parossa logo (brand/parossa, ADR-0022), served with the console so it shows offline. Its
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
      src={onDark ? '/parossa-logo-on-dark.svg' : '/parossa-logo.svg'}
      alt={t('app.name')}
      className="console-brand"
      data-size={size}
      // The file's own proportions (955 × 272), so the space is kept while it loads.
      width={size === 'sm' ? 112 : 140}
      height={size === 'sm' ? 32 : 40}
    />
  );
}
