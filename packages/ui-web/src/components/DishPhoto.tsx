import { useState } from 'react';
import { cx } from '../internal/cx.js';

export interface DishPhotoProps {
  /** The photo's address; without one (or when it fails to load) the placeholder shows. */
  src?: string | undefined;
  /** What the photo shows, e.g. "Paneer Tikka". The placeholder is decorative: the name is beside it. */
  alt: string;
  className?: string;
  /** Sizes for the browser to choose from (`srcset`) and how wide it shows (`sizes`). */
  srcSet?: string;
  sizes?: string;
  width?: number;
  height?: number;
}

/**
 * A dish's photo, or a calm placeholder (a plate on the sunken surface) when the restaurant has
 * none, so every menu looks the same with or without photos (MENU-008). Photos come only from the
 * restaurant. The native twin is `@rp/ui-native` DishPhoto.
 */
export function DishPhoto({ src, alt, className, srcSet, sizes, width, height }: DishPhotoProps) {
  const [failed, setFailed] = useState<string | undefined>();
  const shown = src !== undefined && src !== failed;
  return (
    <span className={cx('rp-dish-photo', className)} data-placeholder={shown ? undefined : ''}>
      {shown ? (
        <img
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          width={width}
          height={height}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(src);
          }}
        />
      ) : (
        <span className="rp-dish-photo__plate" aria-hidden="true" />
      )}
    </span>
  );
}
