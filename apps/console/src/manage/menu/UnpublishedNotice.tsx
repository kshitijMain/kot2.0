import type { MenuPublishStatus } from '@rp/contracts';
import { Button } from '@rp/ui-web';
import { useEffect, useId } from 'react';
import { Link, useLocation } from 'react-router';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { useLive } from '../../app/use-live.js';

/** Names shown in the notice before "and more": a long list is the publish dialog's job. */
const NAMES_SHOWN = 4;

/**
 * "Unpublished changes" (ADR-0031): the menu has changes the waiters' phones, tablets and the QR
 * menu do not have yet. The Business Owner had moved a dish to the Bar and not published, and
 * nothing said so. In the menu editor it publishes; elsewhere on the dashboard it leads there.
 */
export function UnpublishedNotice({
  status,
  onPublish,
}: {
  status: MenuPublishStatus;
  /** In the menu editor: opens the publish step. Elsewhere a link to the editor is shown. */
  onPublish?: () => void;
}) {
  const t = useT();
  const heading = useId();
  if (!status.unpublished) return null;
  const names = status.changedItems.slice(0, NAMES_SHOWN).join(', ');
  return (
    <section
      className="console-notice console-notice--warning unpublished"
      aria-labelledby={heading}
    >
      <h3 id={heading} className="unpublished__title">
        {t('menuEditor.unpublished.title')}
      </h3>
      <p className="unpublished__body">
        {t('menuEditor.unpublished.body', {
          count: status.changedItems.length,
          names: status.changedItems.length > NAMES_SHOWN ? `${names}…` : names,
          version: status.publishedVersion ?? 0,
        })}
      </p>
      {onPublish === undefined ? (
        <Link className="console-link" to="/manage/menu">
          {t('menuEditor.unpublished.open')}
        </Link>
      ) : (
        <Button onClick={onPublish}>{t('menuEditor.unpublished.publish')}</Button>
      )}
    </section>
  );
}

/** The notice on every dashboard page but the menu's own, read again on each page and publish. */
export function DashboardUnpublishedNotice() {
  const controller = useConsole();
  const { pathname } = useLocation();
  const { data, reload } = useLive(
    () => controller.api.getMenuPublishStatus(),
    (type) => type === 'MenuPublished',
  );
  useEffect(() => {
    reload();
  }, [pathname, reload]);
  if (pathname.startsWith('/manage/menu') || data.status !== 'ready') return null;
  return <UnpublishedNotice status={data.value} />;
}
