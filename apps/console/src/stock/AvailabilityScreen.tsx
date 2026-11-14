import type { ItemAvailabilityRequest, MenuItem } from '@rp/contracts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  TextField,
  useToast,
} from '@rp/ui-web';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConsole } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { useLive } from '../app/use-live.js';
import {
  AVAILABILITY_FILTERS,
  type AvailabilityFilter,
  type AvailabilityRow,
  availabilityRows,
  backInStock,
} from './availability-view.js';

const affectsMenu = (type: string) =>
  type === 'MenuPublished' || type === 'ItemAvailabilityChanged';

/** How long the cook may keep pressing + or − before the count is saved, in ms. */
export const COUNT_SAVE_DELAY_MS = 600;
/** How long Undo stays offered after a change, in ms. */
const UNDO_MS = 6000;

/**
 * Menu availability (ADR-0023, MENU-006), a full page since ADR-0031 for the kitchen display and
 * the dashboard: one line saying what it does, a search, category chips and a filter (all,
 * available, out of stock), then a grid of large cards, one per dish, with a two-state switch and
 * the portions left as − 12 + with Clear. A change applies at once with a short note and Undo, no
 * dialog; a whole category can be put back on. Every change is audited and reaches every device
 * at once; marking a dish out of stock cancels its units the kitchen has not started (the server
 * decides, and tells each waiter).
 */
export function AvailabilityScreen({ onBack }: { onBack?: () => void } = {}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { data: menu, reload } = useLive(() => controller.api.getMenu(), affectsMenu);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<AvailabilityFilter>('ALL');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** Counts being pressed, saved a moment after the last press. */
  const [counts, setCounts] = useState<Readonly<Record<string, number | null>>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const rows = useMemo(
    () =>
      menu.status === 'ready'
        ? availabilityRows(menu.value, { search, categoryId: category, status })
        : [],
    [menu, search, category, status],
  );

  const mark = (id: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /** Saves one dish; resolves true when the server took it. */
  const save = async (item: MenuItem, body: ItemAvailabilityRequest): Promise<boolean> => {
    mark(item.id, true);
    try {
      await controller.api.setItemAvailability({ params: { id: item.id }, body });
      return true;
    } catch (error) {
      toast.show({ title: messageOf(error, t), tone: 'danger' });
      return false;
    } finally {
      mark(item.id, false);
      reload();
    }
  };

  /** Applies a change and offers to undo it for a few seconds. */
  const change = async (item: MenuItem, body: ItemAvailabilityRequest, done: string) => {
    const before = { available: item.available, stockCount: item.stockCount };
    if (!(await save(item, body))) return;
    toast.show({
      title: done,
      tone: 'success',
      duration: UNDO_MS,
      action: {
        label: t('stock.undo'),
        onAction: () => {
          void save(item, before);
        },
      },
    });
  };

  const toggle = (row: AvailabilityRow) => {
    if (row.inStock) {
      void change(
        row.item,
        { available: false, stockCount: row.item.stockCount },
        t('stock.markedOut', { name: row.item.name }),
      );
    } else {
      void change(
        row.item,
        backInStock(row.item),
        t('stock.markedAvailable', { name: row.item.name }),
      );
    }
  };

  /** + and − change the count on the card at once and save it once the presses stop. */
  const count = (item: MenuItem, next: number | null) => {
    setCounts((current) => ({ ...current, [item.id]: next }));
    const pending = timers.current.get(item.id);
    if (pending !== undefined) clearTimeout(pending);
    timers.current.set(
      item.id,
      setTimeout(() => {
        timers.current.delete(item.id);
        void change(
          item,
          // A dish counted again is back on; at 0 it sells out by itself.
          { available: next === null ? item.available : true, stockCount: next },
          next === null
            ? t('stock.countCleared', { name: item.name })
            : t('stock.portionsSaved', { name: item.name, count: next }),
        ).then(() => {
          setCounts(({ [item.id]: _saved, ...rest }) => rest);
        });
      }, COUNT_SAVE_DELAY_MS),
    );
  };

  const allAvailable = async (categoryId: string, categoryName: string) => {
    const out =
      menu.status === 'ready'
        ? availabilityRows(menu.value, { search: '', categoryId, status: 'OUT' })
        : [];
    let done = 0;
    for (const row of out) {
      if (await save(row.item, backInStock(row.item))) done += 1;
    }
    toast.show({
      title: t('stock.allMarked', { count: done, category: categoryName }),
      tone: 'success',
    });
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
  const chosen = menu.value.categories.find((entry) => entry.id === category);
  return (
    <section className="stock" aria-labelledby="stock-title">
      <header className="stock__header">
        <h2 id="stock-title" className="stock__title">
          {t('stock.title')}
        </h2>
        {onBack === undefined ? null : (
          <Button variant="secondary" size="lg" onClick={onBack}>
            {t('stock.backToTickets')}
          </Button>
        )}
      </header>
      <p className="stock__intro">{t('stock.intro')}</p>
      <div className="stock__filters">
        <TextField
          label={t('stock.search')}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <div role="group" aria-label={t('stock.show')} className="stock__chips">
          {AVAILABILITY_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className="stock__chip"
              aria-pressed={status === filter}
              onClick={() => {
                setStatus(filter);
              }}
            >
              {t(`stock.filter.${filter}`)}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label={t('stock.categories')} className="stock__chips">
        <button
          type="button"
          className="stock__chip"
          aria-pressed={category === null}
          onClick={() => {
            setCategory(null);
          }}
        >
          {t('stock.allCategories')}
        </button>
        {menu.value.categories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="stock__chip"
            aria-pressed={category === entry.id}
            onClick={() => {
              setCategory(entry.id);
            }}
          >
            {entry.name}
          </button>
        ))}
      </div>
      {chosen === undefined ? null : (
        <div className="stock__bulk">
          <Button
            variant="secondary"
            size="lg"
            disabled={busy.size > 0}
            onClick={() => {
              void allAvailable(chosen.id, chosen.name);
            }}
          >
            {t('stock.allAvailable', { category: chosen.name })}
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t('stock.none')} />
      ) : (
        <ul className="stock__grid" aria-label={t('stock.title')}>
          {rows.map((row) => {
            const { item } = row;
            const shown = item.id in counts ? (counts[item.id] ?? null) : item.stockCount;
            return (
              <li key={item.id} className="stock-card" data-out={row.inStock ? undefined : true}>
                <div className="stock-card__head">
                  <h3 className="stock-card__name">{item.name}</h3>
                  {row.inStock ? null : <Badge tone="neutral">{t('stock.outBadge')}</Badge>}
                </div>
                <p className="stock-card__category">{row.categoryName}</p>
                <button
                  type="button"
                  role="switch"
                  className="stock-switch"
                  aria-checked={row.inStock}
                  aria-label={t('stock.availableOf', { name: item.name })}
                  disabled={busy.has(item.id)}
                  onClick={() => {
                    toggle(row);
                  }}
                >
                  <span className="stock-switch__track" aria-hidden>
                    <span className="stock-switch__knob" />
                  </span>
                  <span className="stock-switch__label">
                    {t(row.inStock ? 'stock.available' : 'stock.out')}
                  </span>
                </button>
                <div
                  role="group"
                  aria-label={t('stock.portionsOf', { name: item.name })}
                  className="stock-card__portions"
                >
                  <span className="stock-card__portions-label">{t('stock.portions')}</span>
                  <Button
                    variant="secondary"
                    aria-label={t('stock.fewer', { name: item.name })}
                    disabled={shown === null || shown === 0}
                    onClick={() => {
                      count(item, Math.max(0, (shown ?? 0) - 1));
                    }}
                  >
                    −
                  </Button>
                  <span className="stock-card__count" aria-live="polite">
                    {shown === null ? t('stock.notCounted') : String(shown)}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={t('stock.more', { name: item.name })}
                    onClick={() => {
                      count(item, (shown ?? 0) + 1);
                    }}
                  >
                    +
                  </Button>
                  {shown === null ? null : (
                    <Button
                      variant="ghost"
                      aria-label={t('stock.clearOf', { name: item.name })}
                      onClick={() => {
                        count(item, null);
                      }}
                    >
                      {t('stock.clear')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
