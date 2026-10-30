import type { ItemAvailabilityRequest, MenuItem, MenuSnapshot } from '@rp/contracts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  TextField,
  useToast,
} from '@rp/ui-web';
import { useMemo, useState } from 'react';
import { useConsole } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { useLive } from '../app/use-live.js';
import { AvailabilityDialog } from '../manage/menu/ItemDialog.js';
import { availabilityRows, type AvailabilityRow } from './availability-view.js';

const affectsMenu = (type: string) =>
  type === 'MenuPublished' || type === 'ItemAvailabilityChanged';

/**
 * Menu availability (ADR-0023, MENU-006): for the kitchen on the KDS and for managers. Every dish
 * with a search and a category filter, each with one big switch, "Out of stock" or "Mark as
 * available", and the portions-left count kept from the menu editor. A change is audited and
 * reaches every device at once; marking a dish out of stock cancels its units the kitchen has
 * not started (the server decides, and tells each waiter).
 */
export function AvailabilityScreen() {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { data: menu, reload } = useLive(() => controller.api.getMenu(), affectsMenu);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<string | undefined>();
  const [counting, setCounting] = useState<MenuItem | undefined>();
  const [countError, setCountError] = useState<string | undefined>();

  const rows = useMemo(
    () =>
      menu.status === 'ready'
        ? availabilityRows(menu.value, { search, categoryId: category === '' ? null : category })
        : [],
    [menu, search, category],
  );

  const save = async (item: MenuItem, body: ItemAvailabilityRequest, done: string) => {
    setBusy(item.id);
    try {
      await controller.api.setItemAvailability({ params: { id: item.id }, body });
      toast.show({ title: done, tone: 'success' });
      setCounting(undefined);
    } catch (error) {
      if (counting !== undefined) setCountError(messageOf(error, t));
      else toast.show({ title: messageOf(error, t), tone: 'danger' });
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  const toggle = (row: AvailabilityRow) => {
    const available = !row.inStock;
    void save(
      row.item,
      // Back in stock with no count left would sell out again at once: the count stops.
      {
        available,
        stockCount: available && row.item.stockCount === 0 ? null : row.item.stockCount,
      },
      t(available ? 'stock.markedAvailable' : 'stock.markedOut', { name: row.item.name }),
    );
  };

  if (menu.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (menu.status === 'error') {
    return (
      <ErrorState
        title={messageOf(menu.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  return (
    <section className="stock" aria-labelledby="stock-title">
      <h2 id="stock-title" className="stock__title">
        {t('stock.title')}
      </h2>
      <p className="dashboard-section__hint">{t('stock.intro')}</p>
      <div className="stock__filters">
        <TextField
          label={t('stock.search')}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Select
          label={t('stock.category')}
          value={category}
          placeholder={t('stock.allCategories')}
          options={categoryOptions(menu.value)}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('stock.none')} />
      ) : (
        <ul className="stock__list" aria-label={t('stock.title')}>
          {rows.map((row) => (
            <li key={row.item.id} className="stock__row" data-out={row.inStock ? undefined : true}>
              <span className="stock__name">
                {row.item.name}
                {row.inStock ? null : <Badge tone="danger">{t('pos.menu.soldOut')}</Badge>}
                {row.item.stockCount !== null && row.inStock ? (
                  <span className="stock__left">
                    {t('pos.menu.left', { count: row.item.stockCount })}
                  </span>
                ) : null}
              </span>
              <span className="stock__category">{row.categoryName}</span>
              <Button
                variant={row.inStock ? 'danger' : 'primary'}
                size="lg"
                loading={busy === row.item.id}
                disabled={busy !== undefined && busy !== row.item.id}
                aria-label={t(row.inStock ? 'stock.markOutOf' : 'stock.markAvailableOf', {
                  name: row.item.name,
                })}
                onClick={() => {
                  toggle(row);
                }}
              >
                {t(row.inStock ? 'stock.markOut' : 'stock.markAvailable')}
              </Button>
              <Button
                variant="secondary"
                aria-label={t('stock.countOf', { name: row.item.name })}
                onClick={() => {
                  setCountError(undefined);
                  setCounting(row.item);
                }}
              >
                {t('stock.count')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {counting === undefined ? null : (
        <AvailabilityDialog
          item={counting}
          busy={busy === counting.id}
          error={countError}
          onClose={() => {
            setCounting(undefined);
          }}
          onSave={(body) => {
            void save(counting, body, t('menuEditor.availability.saved', { name: counting.name }));
          }}
        />
      )}
    </section>
  );
}

function categoryOptions(menu: MenuSnapshot) {
  return menu.categories.map((entry) => ({ value: entry.id, label: entry.name }));
}
