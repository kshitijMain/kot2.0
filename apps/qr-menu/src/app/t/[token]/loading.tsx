import { DishSkeletons } from '../../../site/Skeletons';
import { t } from '../../../site/server-i18n';

/**
 * While the server asks the relay for the menu (P9-11, NFR-U04): the page's own shape at once,
 * header, search, chips and dishes, so a slow 4G connection shows the menu coming, not a white
 * screen, and nothing moves when it arrives (QR-012).
 */
export default function Loading() {
  return (
    <div className="qr-page" role="status" aria-busy="true">
      <span className="qr-visually-hidden">{t('qrSite.loading')}</span>
      {/* Neutral, not the accent: the restaurant's colour is not known until the menu arrives, and
          a band in another colour first would flash. */}
      <div className="qr-skeleton qr-skeleton__header" aria-hidden="true">
        <span className="qr-skeleton__line" />
        <span className="qr-skeleton__line" />
      </div>
      <div className="qr-skeleton" aria-hidden="true">
        <span className="qr-skeleton__block qr-skeleton__search" />
        <div className="qr-skeleton__chips">
          <span className="qr-skeleton__block qr-skeleton__chip" />
          <span className="qr-skeleton__block qr-skeleton__chip" />
          <span className="qr-skeleton__block qr-skeleton__chip" />
        </div>
        <span className="qr-skeleton__line qr-skeleton__title" />
      </div>
      <DishSkeletons count={5} />
    </div>
  );
}
