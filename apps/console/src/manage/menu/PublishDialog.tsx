import { ApiRequestError } from '@rp/api-client';
import type { DeviceView } from '@rp/contracts';
import { formatRupees, type MenuChanges, menuChanges, type MenuHealth } from '@rp/domain';
import { Button, Dialog, LoadingState } from '@rp/ui-web';
import { useEffect, useState } from 'react';
import { useConsole, useConsoleState } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import type { MenuData } from './MenuEditor.js';
import { draftDishes, publishedDishes } from './menu-view.js';

/** Devices that hold a menu: phones, tablets, kitchen screens and other tills. */
const MENU_DEVICES: ReadonlySet<DeviceView['type']> = new Set([
  'POS',
  'KDS',
  'WAITER_PHONE',
  'TABLE_TABLET',
]);

type Step =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'REVIEW'; readonly changes: MenuChanges; readonly first: boolean }
  | {
      readonly kind: 'DONE';
      readonly version: number;
      readonly published: boolean;
      readonly devices: { readonly now: string[]; readonly later: string[] } | string;
    };

/**
 * Publishing the menu (MENU-013) as a clear step: what changes on the devices (dishes added, taken
 * off, renamed, new prices and photos), whether the menu check allows it (missing prices, stations
 * or tax groups block it), then the new version and which devices have it: those connected now
 * get it at once, the others as soon as they reconnect.
 */
export function PublishDialog({
  data,
  health,
  onClose,
}: {
  data: MenuData;
  health: MenuHealth;
  onClose: () => void;
}) {
  const t = useT();
  const controller = useConsole();
  const { device } = useConsoleState();
  const [step, setStep] = useState<Step>({ kind: 'LOADING' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    controller.api.getMenu().then(
      (menu) => {
        if (live) {
          setStep({
            kind: 'REVIEW',
            changes: menuChanges(publishedDishes(menu), draftDishes(data.draft)),
            first: false,
          });
        }
      },
      (failure: unknown) => {
        if (!live) return;
        if (failure instanceof ApiRequestError && failure.code === 'MENU_NOT_PUBLISHED') {
          setStep({
            kind: 'REVIEW',
            changes: menuChanges(null, draftDishes(data.draft)),
            first: true,
          });
        } else {
          setError(messageOf(failure, t));
          setStep({
            kind: 'REVIEW',
            changes: menuChanges(null, draftDishes(data.draft)),
            first: false,
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [controller, data.draft, t]);

  const publish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await controller.api.publishMenu();
      let devices: { now: string[]; later: string[] } | string;
      try {
        const list = (await controller.api.listDevices()).devices.filter(
          (entry) =>
            MENU_DEVICES.has(entry.type) && entry.revokedAt === null && entry.id !== device?.id,
        );
        devices = {
          now: list.filter((entry) => entry.connected).map((entry) => entry.name),
          later: list.filter((entry) => !entry.connected).map((entry) => entry.name),
        };
      } catch (failure) {
        devices = messageOf(failure, t);
      }
      setStep({ kind: 'DONE', version: result.version, published: result.published, devices });
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const prices = (list: readonly { size: string; price: number }[]) =>
    list
      .map((entry) =>
        entry.size === ''
          ? formatRupees(entry.price)
          : `${entry.size} ${formatRupees(entry.price)}`,
      )
      .join(', ');

  let body;
  let footer;
  if (step.kind === 'LOADING') {
    body = <LoadingState title={t('states.loading')} />;
  } else if (step.kind === 'REVIEW') {
    const { changes } = step;
    body = (
      <>
        <h3 className="menu-publish__heading">{t('menuEditor.publishing.changes')}</h3>
        {step.first ? <p>{t('menuEditor.publishing.first')}</p> : null}
        {changes.none ? (
          <p>{t('menuEditor.publishing.none')}</p>
        ) : (
          <ul className="menu-publish__list">
            {changes.added.length === 0 ? null : (
              <li>
                {t('menuEditor.publishing.added', {
                  count: changes.added.length,
                  names: changes.added.join(', '),
                })}
              </li>
            )}
            {changes.removed.length === 0 ? null : (
              <li>
                {t('menuEditor.publishing.removed', {
                  count: changes.removed.length,
                  names: changes.removed.join(', '),
                })}
              </li>
            )}
            {changes.renamed.map((entry) => (
              <li key={`${entry.from}-${entry.to}`}>
                {t('menuEditor.publishing.renamed', { from: entry.from, to: entry.to })}
              </li>
            ))}
            {changes.prices.map((entry) => (
              <li key={entry.id}>
                {t('menuEditor.publishing.price', {
                  name: entry.name,
                  before: prices(entry.before),
                  after: prices(entry.after),
                })}
              </li>
            ))}
            {changes.photos.length === 0 ? null : (
              <li>
                {t('menuEditor.publishing.photos', {
                  count: changes.photos.length,
                  names: changes.photos.join(', '),
                })}
              </li>
            )}
          </ul>
        )}
        {health.publishable ? (
          health.warnings.length === 0 ? null : (
            <p className="console-notice console-notice--warning">
              {t('menuEditor.publishing.warnings', { count: health.warnings.length })}
            </p>
          )
        ) : (
          <p className="console-notice console-notice--danger" role="alert">
            {t('menuEditor.publishing.blocked')}
          </p>
        )}
      </>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('menuEditor.cancel')}
        </Button>
        <Button
          loading={busy}
          disabled={!health.publishable}
          onClick={() => {
            void publish();
          }}
        >
          {t('menuEditor.publishing.confirm')}
        </Button>
      </>
    );
  } else {
    const { devices } = step;
    body = (
      <>
        <p className="console-notice console-notice--success" role="status">
          {step.published
            ? t('menuEditor.publishing.done', { version: step.version })
            : t('menuEditor.publishing.unchanged', { version: step.version })}
        </p>
        {typeof devices === 'string' ? (
          <p>{t('menuEditor.publishing.devicesUnknown', { message: devices })}</p>
        ) : devices.now.length === 0 && devices.later.length === 0 ? (
          <p>{t('menuEditor.publishing.noDevices')}</p>
        ) : (
          <ul className="menu-publish__list">
            {devices.now.length === 0 ? null : (
              <li>{t('menuEditor.publishing.connected', { names: devices.now.join(', ') })}</li>
            )}
            {devices.later.length === 0 ? null : (
              <li>{t('menuEditor.publishing.later', { names: devices.later.join(', ') })}</li>
            )}
          </ul>
        )}
      </>
    );
    footer = <Button onClick={onClose}>{t('menuEditor.publishing.close')}</Button>;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t('menuEditor.publishing.title')}
      footer={footer}
    >
      <div className="menu-publish">
        {body}
        {error === undefined ? null : (
          <p role="alert" className="console-notice console-notice--danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
