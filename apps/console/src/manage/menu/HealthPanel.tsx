import type { ItemView } from '@rp/contracts';
import { type HealthProblem, type MenuHealth } from '@rp/domain';
import { Button, Icon, useToast } from '@rp/ui-web';
import { useState } from 'react';
import { Link } from 'react-router';
import { useT } from '../../app/i18n.js';
import { ItemDialog } from './ItemDialog.js';
import type { MenuData } from './MenuEditor.js';

/** How many names a line lists before "and N more". */
const NAMES_SHOWN = 6;

/**
 * The menu check (ONB-004 step 7, MENU-002): what blocks publishing (a dish without a price, a
 * kitchen station or a tax group), each with a way to fix it, and what is worth a look (dishes
 * without a photo, which show a placeholder; empty categories; two dishes with one name).
 */
export function HealthPanel({
  data,
  health,
  reload,
}: {
  data: MenuData;
  health: MenuHealth;
  reload: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [fixing, setFixing] = useState<ItemView | undefined>();
  const names = (list: readonly string[]) =>
    list.length <= NAMES_SHOWN
      ? list.join(', ')
      : `${list.slice(0, NAMES_SHOWN).join(', ')} +${String(list.length - NAMES_SHOWN)}`;
  const noPhoto = health.warnings.filter((problem) => problem.kind === 'NO_PHOTO');
  const otherWarnings = health.warnings.filter((problem) => problem.kind !== 'NO_PHOTO');
  const sentence = (problem: HealthProblem) =>
    t(`menuEditor.health.${problem.kind as 'NO_PRICE'}`, { name: problem.name });

  return (
    <section className="menu-health" aria-labelledby="menu-health-title">
      <h3 id="menu-health-title" className="menu-health__title">
        {t('menuEditor.health.title')}
      </h3>
      {health.blocking.length === 0 && health.warnings.length === 0 ? (
        <p className="console-notice console-notice--success">
          <Icon name="check" /> {t('menuEditor.health.ok')}
        </p>
      ) : null}
      {health.blocking.length === 0 ? null : (
        <div className="console-notice console-notice--danger" role="alert">
          <p className="menu-health__heading">{t('menuEditor.health.blocking')}</p>
          <ul className="menu-health__list">
            {health.blocking.map((problem) => {
              const item = data.draft.items.find((entry) => entry.id === problem.dishIds[0]);
              return (
                <li key={`${problem.kind}-${problem.dishIds.join()}`} className="menu-health__row">
                  <span>{sentence(problem)}</span>
                  {item === undefined ? null : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFixing(item);
                      }}
                    >
                      {t('menuEditor.health.fix', { name: item.name })}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {health.warnings.length === 0 ? null : (
        <div className="console-notice console-notice--warning">
          <p className="menu-health__heading">{t('menuEditor.health.warnings')}</p>
          <ul className="menu-health__list">
            {noPhoto.length === 0 ? null : (
              <li className="menu-health__row">
                <span>
                  {t('menuEditor.health.noPhoto', {
                    count: noPhoto.length,
                    names: names(noPhoto.map((problem) => problem.name)),
                  })}
                </span>
                <Link to="/manage/menu/photos" className="console-link">
                  {t('menuEditor.health.addPhotos')}
                </Link>
              </li>
            )}
            {otherWarnings.map((problem) => (
              <li
                key={`${problem.kind}-${problem.categoryId ?? problem.dishIds.join()}`}
                className="menu-health__row"
              >
                <span>{sentence(problem)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fixing === undefined ? null : (
        <ItemDialog
          data={data}
          item={fixing}
          defaultCategoryId=""
          onSaved={(name) => {
            toast.show({ title: t('menuEditor.items.saved', { name }), tone: 'success' });
            setFixing(undefined);
            reload();
          }}
          onClose={() => {
            setFixing(undefined);
          }}
        />
      )}
    </section>
  );
}
