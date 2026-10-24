import Link from 'next/link';
import { t } from './server-i18n';

/**
 * QR-013: the privacy notice and terms, and what the page does not do. The page shows the
 * restaurant's brand; Parossa only as the quiet last line (NFR-U02, ADR-0022).
 */
export function Footer() {
  return (
    <footer className="qr-footer">
      <p>{t('qrSite.footer.noTracking')}</p>
      <nav aria-label={t('qrSite.footer.privacy')}>
        <Link href="/privacy">{t('qrSite.footer.privacy')}</Link>
        <Link href="/terms">{t('qrSite.footer.terms')}</Link>
      </nav>
      <p className="qr-footer__powered">{t('app.poweredBy')}</p>
    </footer>
  );
}
