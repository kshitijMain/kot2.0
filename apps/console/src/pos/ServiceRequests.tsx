import type { ServiceRequestView } from '@rp/contracts';
import { SERVICE_REQUEST_ALERTS } from '@rp/domain';
import { alertAge } from '@rp/ordering';
import { Button } from '@rp/ui-web';
import { useState } from 'react';
import { useOpenBill } from '../billing/use-open-bill.js';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { grantOf } from '../app/modes.js';
import { useLive } from '../app/use-live.js';
import { useNow } from '../app/use-now.js';

type Action = 'acknowledge' | 'resolve';

/** Events after which the open requests are read again: their own, and a table moved or closed. */
export const affectsRequests = (eventType: string): boolean =>
  /^(ServiceRequest|TableMoved$|OrdersMoved$|TableClosed$|Bill)/.test(eventType);

/**
 * What the tables asked for (WTR-005, QR-011, P9-15), above the POS floor and on the manager
 * dashboard: Water, Waiter and Bill, oldest first, with the table and how long ago. "On my way"
 * acknowledges (the diner's page says so, NTF-004); "Done" closes it. A bill request opens the
 * bill for whoever prints it. Shown only while a request is open.
 */
export function ServiceRequests() {
  const t = useT();
  const controller = useConsole();
  const { person } = useConsoleState();
  const now = useNow(30_000);
  const { openBill, opening } = useOpenBill();
  const { data, reload } = useLive(
    async () => (await controller.api.listServiceRequests()).requests,
    affectsRequests,
  );
  const [pending, setPending] = useState<ReadonlyMap<string, Action>>(() => new Map());
  const [error, setError] = useState<string | undefined>();
  const canBill = person !== undefined && grantOf(person, 'BILL_PRINT_AND_PAYMENT') !== 'DENY';

  if (data.status !== 'ready' || data.value.length === 0) return null;

  const act = (request: ServiceRequestView, action: Action) => {
    setError(undefined);
    setPending((current) => new Map([...current, [request.id, action]]));
    const call = { params: { requestId: request.id } };
    const sent =
      action === 'acknowledge'
        ? controller.api.acknowledgeServiceRequest(call)
        : controller.api.resolveServiceRequest(call);
    void sent
      .catch((failure: unknown) => {
        const message = messageOf(failure, t);
        setError(
          action === 'acknowledge'
            ? t('alerts.acknowledgeFailed', { message })
            : t('mobile.requests.resolveFailed', { message }),
        );
      })
      .finally(() => {
        setPending((current) => new Map([...current].filter(([id]) => id !== request.id)));
        reload();
      });
  };

  return (
    <section className="approvals requests" aria-labelledby="requests-heading">
      <h2 id="requests-heading" className="pos-floor__heading">
        {t('mobile.requests.title', { count: data.value.length })}
      </h2>
      {error === undefined ? null : (
        <p role="alert" className="console-notice console-notice--danger">
          {error}
        </p>
      )}
      <ul className="approvals__list">
        {data.value.map((request) => {
          const title = t('alerts.atTable', {
            table: request.tableLabel,
            what: t(`alerts.type.${SERVICE_REQUEST_ALERTS[request.type]}`),
          });
          const facts = [alertAge(request.createdAt, now, t)];
          // A call at a table nobody has opened yet (P9-25): someone goes and seats them.
          if (request.tableSessionId === null) facts.push(t('pos.tableRequests.notOpened'));
          if (request.state === 'ACKNOWLEDGED') {
            facts.push(
              request.acknowledgedByName === null
                ? t('mobile.requests.onTheWaySomeone')
                : t('mobile.requests.onTheWay', { name: request.acknowledgedByName }),
            );
          }
          if (request.state === 'ESCALATED') facts.push(t('alerts.escalated'));
          const busy = pending.get(request.id);
          return (
            <li
              key={request.id}
              className="approvals__order"
              data-escalated={request.state === 'ESCALATED' || undefined}
            >
              <p className="approvals__title">{title}</p>
              <p className="approvals__facts">{facts.join(' · ')}</p>
              <div className="bill__actions">
                {request.type === 'BILL' && canBill && request.tableSessionId !== null ? (
                  <Button
                    loading={opening}
                    onClick={() => {
                      if (request.tableSessionId !== null) {
                        openBill({ tableSessionId: request.tableSessionId });
                      }
                    }}
                  >
                    {t('pos.tableRequests.openBill')}
                  </Button>
                ) : null}
                {request.state === 'ACKNOWLEDGED' ? null : (
                  <Button
                    variant={request.type === 'BILL' && canBill ? 'secondary' : 'primary'}
                    loading={busy === 'acknowledge'}
                    disabled={busy !== undefined}
                    aria-label={t('pos.tableRequests.onMyWayOf', { title })}
                    onClick={() => {
                      act(request, 'acknowledge');
                    }}
                  >
                    {t('pos.tableRequests.onMyWay')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  loading={busy === 'resolve'}
                  disabled={busy !== undefined}
                  aria-label={t('mobile.requests.resolveOf', { title })}
                  onClick={() => {
                    act(request, 'resolve');
                  }}
                >
                  {t('pos.tableRequests.done')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
