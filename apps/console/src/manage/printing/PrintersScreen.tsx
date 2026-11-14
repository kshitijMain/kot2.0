import type { PrintQueuePrinter, PrinterView } from '@rp/contracts';
import { alertAge } from '@rp/ordering';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  TextField,
  useToast,
} from '@rp/ui-web';
import { useState } from 'react';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';
import { useNow } from '../../app/use-now.js';

/** What changes the queue: a ticket made or printed, a printer down or back. */
export const affectsPrintQueue = (type: string) =>
  /^(KotCreated|KotPrintStatusChanged|PrinterStatusChanged|TableMoved|OrdersMoved)$/.test(type);

/** The print queue, kept live, for the page and the count beside Printers. */
export function usePrintQueue(enabled = true) {
  const controller = useConsole();
  return useLive(
    async () => (enabled ? (await controller.api.getPrintQueue()).printers : []),
    affectsPrintQueue,
  );
}

/** Tickets waiting on printers that are down: the count beside Printers (ADR-0031). */
export function stuckJobs(printers: readonly PrintQueuePrinter[]): number {
  return printers
    .filter((printer) => !printer.online)
    .reduce((sum, printer) => sum + printer.queued, 0);
}

/**
 * The dashboard's Printers page (ADR-0031, item H): each printer, whether it is printing, why
 * not, and the tickets waiting for it, oldest first, with Retry now and Print on another printer.
 * The queue also checks a printer that is down on every pass and prints the moment it is back.
 */
export function PrintersScreen() {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const now = useNow(30_000);
  const { data, reload } = usePrintQueue();
  const { data: all } = useLive(
    async () => (await controller.api.listPrinters()).printers,
    affectsPrintQueue,
  );
  const [busy, setBusy] = useState<string | undefined>();
  const [moving, setMoving] = useState<PrintQueuePrinter | undefined>();

  const retry = async (printer: PrintQueuePrinter) => {
    setBusy(printer.printerId);
    try {
      const after = await controller.api.retryPrinter({ params: { id: printer.printerId } });
      toast.show(
        after.online
          ? { title: t('printersPage.retried.online', { name: printer.name }), tone: 'success' }
          : {
              title: t('printersPage.retried.offline', { name: printer.name }),
              description: after.lastError ?? undefined,
              tone: 'warning',
            },
      );
    } catch (error) {
      toast.show({ title: messageOf(error, t), tone: 'danger' });
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  if (data.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (data.status === 'error') {
    return (
      <ErrorState
        title={t('printersPage.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  const others = (printer: PrintQueuePrinter): PrinterView[] =>
    all.status === 'ready'
      ? all.value.filter(
          (entry) =>
            entry.archivedAt === null &&
            entry.id !== printer.printerId &&
            entry.redirectToId === null,
        )
      : [];
  const nameOf = (id: string | null) =>
    data.value.find((entry) => entry.printerId === id)?.name ?? '';
  const quiet = data.value.every((printer) => printer.online && printer.queued === 0);

  return (
    <section className="dashboard-section" aria-labelledby="dashboard-printers">
      <h2 id="dashboard-printers" className="dashboard-section__heading">
        {t('printersPage.title')}
      </h2>
      <p className="dashboard-section__hint">{t('printersPage.intro')}</p>
      {quiet ? <p className="console-notice">{t('printersPage.nothingWaits')}</p> : null}
      {data.value.length === 0 ? (
        <EmptyState title={t('printersPage.none')} />
      ) : (
        <div className="printers">
          {data.value.map((printer) => (
            <article
              key={printer.printerId}
              className="printer-card"
              data-down={!printer.online || undefined}
            >
              <div className="printer-card__head">
                <h3 className="printer-card__name">{printer.name}</h3>
                <Badge tone={printer.online ? 'success' : 'danger'} variant="solid">
                  {t(printer.online ? 'printersPage.online' : 'printersPage.offline')}
                </Badge>
              </div>
              {printer.offlineSince === null ? null : (
                <p className="dashboard-section__hint">
                  {t('printersPage.since', { age: alertAge(printer.offlineSince, now, t) })}
                </p>
              )}
              {printer.lastError === null || printer.online ? null : (
                <p className="console-notice console-notice--warning">{printer.lastError}</p>
              )}
              {printer.redirectToId === null ? null : (
                <p className="console-notice">
                  {t('printersPage.redirected', { name: nameOf(printer.redirectToId) })}
                </p>
              )}
              {printer.jobs.length === 0 ? (
                <p className="dashboard-section__hint">{t('printersPage.noJobs')}</p>
              ) : (
                <ul
                  className="printer-card__jobs"
                  aria-label={t('printersPage.waiting', { count: printer.queued })}
                >
                  {printer.jobs.map((job) => (
                    <li key={job.id} className="printer-card__job">
                      <span className="printer-card__label">{job.label}</span>
                      <span className="dashboard-section__hint">
                        {[
                          job.stationName,
                          alertAge(job.createdAt, now, t),
                          t('printersPage.attempts', { count: job.attempts }),
                        ].join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="bill__actions">
                <Button
                  loading={busy === printer.printerId}
                  disabled={busy !== undefined}
                  onClick={() => {
                    void retry(printer);
                  }}
                >
                  {t('printersPage.retry')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== undefined}
                  onClick={() => {
                    setMoving(printer);
                  }}
                >
                  {t(
                    printer.redirectToId === null
                      ? 'printersPage.elsewhere'
                      : 'printersPage.change',
                  )}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {moving === undefined ? null : (
        <ElsewhereDialog
          printer={moving}
          others={others(moving)}
          onClose={() => {
            setMoving(undefined);
          }}
          onDone={() => {
            setMoving(undefined);
            reload();
          }}
        />
      )}
    </section>
  );
}

function ElsewhereDialog({
  printer,
  others,
  onClose,
  onDone,
}: {
  printer: PrintQueuePrinter;
  others: readonly PrinterView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const [to, setTo] = useState(printer.redirectToId ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const send = async () => {
    if (reason.trim() === '') {
      setError(t('printersPage.reasonNeeded'));
      return;
    }
    setBusy(true);
    try {
      await controller.api.redirectPrinter({
        params: { id: printer.printerId },
        body: { toPrinterId: to === '' ? null : to, reason: reason.trim() },
      });
      toast.show({
        title:
          to === ''
            ? t('printersPage.sentBack', { name: printer.name })
            : t('printersPage.sentTo', {
                name: others.find((entry) => entry.id === to)?.name ?? '',
              }),
        tone: 'success',
      });
      onDone();
    } catch (failure) {
      setError(messageOf(failure, t));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('printersPage.elsewhereTitle', { name: printer.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('restaurantPage.cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              void send();
            }}
          >
            {t('printersPage.send')}
          </Button>
        </>
      }
    >
      <div className="console-form">
        <Select
          label={t('printersPage.to')}
          value={to}
          options={[
            { value: '', label: t('printersPage.backHere', { name: printer.name }) },
            ...others.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(event) => {
            setTo(event.target.value);
          }}
        />
        <TextField
          label={t('printersPage.reason')}
          value={reason}
          maxLength={200}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        {error === undefined ? null : (
          <p role="alert" className="console-notice console-notice--danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
