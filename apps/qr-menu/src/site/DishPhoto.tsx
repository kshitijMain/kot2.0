import type { QrPhoto } from '@rp/contracts/relay';
import { DishPhoto as Photo } from '@rp/ui-web';

/**
 * A dish's photo (MENU-008, QR-012), straight from the relay's public bucket: the browser picks
 * the smallest size the screen needs, and loads it only when it scrolls near. Without a photo the
 * shared placeholder shows (`@rp/ui-web` DishPhoto), as on the tablet. The dish's name is beside
 * it, so the image itself says nothing to a screen reader.
 */
export function DishPhoto({
  photo,
  base,
  sizes,
  className,
  placeholder = true,
}: {
  photo: QrPhoto | undefined;
  base: string | null;
  /** The `sizes` attribute: how wide it is shown. */
  sizes: string;
  className: string;
  /** Show the placeholder when there is no photo (the dish list); the dish sheet shows nothing. */
  placeholder?: boolean;
}) {
  const smallest = photo?.sizes[0];
  if (photo === undefined || smallest === undefined || base === null) {
    return placeholder ? <Photo alt="" className={className} /> : null;
  }
  const url = (path: string) => `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return (
    <Photo
      className={className}
      src={url(smallest.path)}
      srcSet={photo.sizes.map((size) => `${url(size.path)} ${String(size.width)}w`).join(', ')}
      sizes={sizes}
      width={smallest.width}
      height={smallest.height}
      alt=""
    />
  );
}
