import { businessDateOf } from '@rp/domain';
import { ErrorState, LoadingState } from '@rp/ui-web';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';
import { RangeFilter } from './RangeFilter.js';
import { type ReportRange, rangeFromSearch } from './report-view.js';

/**
 * A page over a range of business dates, today by default: the Reports' range row above what
 * `children` shows for it (bill history, cancelled KOTs; ADR-0030). The range lives in the address.
 */
export function RangedPage({ children }: { children: (range: ReportRange) => ReactNode }) {
  const t = useT();
  const controller = useConsole();
  const [search, setSearch] = useSearchParams();
  const { data: restaurant, reload } = useLive(
    () => controller.api.getRestaurant(),
    (type) => type === 'RestaurantChanged',
  );
  if (restaurant.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (restaurant.status === 'error') {
    return (
      <ErrorState
        title={t('reportsPage.loadFailed')}
        description={messageOf(restaurant.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  const today = businessDateOf(new Date(), {
    cutoff: restaurant.value.businessDayCutoff,
    timeZone: restaurant.value.timeZone,
  });
  const range = rangeFromSearch(search, today);
  return (
    <>
      <RangeFilter
        key={`${range.from}|${range.to}`}
        range={range}
        today={today}
        onChange={(next) => {
          setSearch({ from: next.from, to: next.to });
        }}
      />
      {children(range)}
    </>
  );
}
