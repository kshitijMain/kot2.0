import type { MenuDraftResponse, StationView, TaxGroupView } from '@rp/contracts';
import { menuHealth } from '@rp/domain';
import { Button, ErrorState, Icon, LoadingState, Tabs } from '@rp/ui-web';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';
import { CategoriesTab } from './CategoriesTab.js';
import { GroupsTab } from './GroupsTab.js';
import { HealthPanel } from './HealthPanel.js';
import { ItemsTab } from './ItemsTab.js';
import { healthInputOf } from './menu-view.js';
import { ExportMenuFile } from './MenuFileScreen.js';
import { PublishDialog } from './PublishDialog.js';

/** What every tab of the editor reads, and how it asks for a fresh copy after a change. */
export interface MenuData {
  readonly draft: MenuDraftResponse;
  readonly taxGroups: readonly TaxGroupView[];
  readonly stations: readonly StationView[];
}

export interface MenuTabProps {
  readonly data: MenuData;
  readonly reload: () => void;
}

/**
 * The menu editor (P4-02d, MGR-005): dishes, categories and add-on groups as a draft, published
 * in one press so every device switches to the new version together (MENU-013). Availability and
 * stock apply at once (MENU-006). Nothing is deleted; entries are archived (MENU-010). A menu
 * check above the dishes says what blocks publishing and what is worth a look; publishing is a
 * step that says what changes and which devices have the new menu. Menus are typed in here or
 * loaded from the Excel template; the AI menu reading is not offered (2026-10-25).
 */
export function MenuEditor() {
  const t = useT();
  const controller = useConsole();
  const navigate = useNavigate();
  const { data, reload } = useLive(
    async (): Promise<MenuData> => {
      const [draft, taxGroups, stations] = await Promise.all([
        controller.api.getMenuDraft(),
        controller.api.listTaxGroups(),
        controller.api.listStations(),
      ]);
      return { draft, taxGroups: taxGroups.taxGroups, stations: stations.stations };
    },
    (type) =>
      type === 'MenuPublished' ||
      type === 'ItemAvailabilityChanged' ||
      type === 'RestaurantChanged',
  );
  const [tab, setTab] = useState('items');
  const [publishing, setPublishing] = useState(false);
  const health = useMemo(
    () =>
      data.status === 'ready'
        ? menuHealth(healthInputOf(data.value.draft, data.value.taxGroups, data.value.stations))
        : undefined,
    [data],
  );

  let content: ReactNode;
  if (data.status === 'loading') {
    content = <LoadingState title={t('states.loading')} />;
  } else if (data.status === 'error') {
    content = (
      <ErrorState
        title={t('menuEditor.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  } else {
    const props = { data: data.value, reload };
    content = (
      <>
        {health === undefined ? null : (
          <HealthPanel data={data.value} health={health} reload={reload} />
        )}
        <Tabs
          label={t('menuEditor.tabs.label')}
          value={tab}
          onValueChange={setTab}
          items={[
            { id: 'items', label: t('menuEditor.tabs.items'), content: <ItemsTab {...props} /> },
            {
              id: 'categories',
              label: t('menuEditor.tabs.categories'),
              content: <CategoriesTab {...props} />,
            },
            { id: 'groups', label: t('menuEditor.tabs.groups'), content: <GroupsTab {...props} /> },
          ]}
        />
      </>
    );
  }

  return (
    <section className="dashboard-section" aria-labelledby="dashboard-menu">
      <div className="staff-header">
        <h2 id="dashboard-menu" className="dashboard-section__heading">
          {t('menuEditor.title')}
        </h2>
        <Button
          disabled={data.status !== 'ready'}
          onClick={() => {
            setPublishing(true);
          }}
        >
          {t('menuEditor.publish')}
        </Button>
      </div>
      <p className="dashboard-section__hint">{t('menuEditor.intro')}</p>
      <div className="menu-actions">
        {/* ONB-005: the whole menu, photos included, from a menu file. */}
        <Button
          variant="secondary"
          startIcon={<Icon name="receipt" />}
          onClick={() => {
            void navigate('/manage/menu/import');
          }}
        >
          {t('menuEditor.fromExcel')}
        </Button>
        {/* ONB-007: many dish photos at once (P6-04c). */}
        <Button
          variant="secondary"
          startIcon={<Icon name="plus" />}
          onClick={() => {
            void navigate('/manage/menu/photos');
          }}
        >
          {t('menuEditor.bulkPhotos')}
        </Button>
        <ExportMenuFile />
      </div>
      {content}
      {publishing && data.status === 'ready' && health !== undefined ? (
        <PublishDialog
          data={data.value}
          health={health}
          onClose={() => {
            setPublishing(false);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
