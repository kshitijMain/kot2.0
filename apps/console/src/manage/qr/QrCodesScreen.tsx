import type { TableQrCodesResponse, TableQrView, TableTentSize } from '@rp/contracts';
import { displayDateTime } from '@rp/domain';
import { affectsFloor } from '@rp/ordering';
import {
  Button,
  ChoiceGroup,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  QrCode,
  TextField,
  useToast,
} from '@rp/ui-web';
import { type ReactNode, useState } from 'react';
import { useConsole } from '../../app/console-context.js';
import { downloadFile } from '../../app/download.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';
import { UpiNotice } from '../UpiNotice.js';

type Open =
  | { readonly kind: 'SHOW'; readonly table: TableQrView }
  | { readonly kind: 'NEW'; readonly table: TableQrView };

const SIZES: readonly TableTentSize[] = ['A6', 'A5'];

/**
 * Table QR codes (P5-04, QR-001, ONB-004 step 10): every table's code, made in one step for the
 * tables without one, a new code for a table whose printed one must stop working, and the table
 * tents to print as a PDF (A6 cards or A5 tents that fold). Follows floor changes on any screen.
 *
 * P9-07: the address the codes open is shown, with what to do when it changes (a new ngrok or
 * domain address: print again, nothing to remake); each table shows its code, copies its link and
 * prints its own tent.
 */
export function QrCodesScreen() {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { data, reload } = useLive<TableQrCodesResponse>(
    () => controller.api.listTableQrCodes(),
    affectsFloor,
  );
  const [open, setOpen] = useState<Open | undefined>();
  const [size, setSize] = useState<TableTentSize>('A6');
  // 'ISSUE', 'PRINT' (every tent) or a table's id (its own tent).
  const [busy, setBusy] = useState<string | undefined>();

  const issue = () => {
    setBusy('ISSUE');
    controller.api.issueTableQrCodes().then(
      () => {
        toast.show({ title: t('qrCodes.issued'), tone: 'success' });
        setBusy(undefined);
        reload();
      },
      (failure: unknown) => {
        toast.show({
          title: t('qrCodes.failed', { message: messageOf(failure, t) }),
          tone: 'danger',
        });
        setBusy(undefined);
      },
    );
  };

  const print = (table?: TableQrView) => {
    setBusy(table?.tableId ?? 'PRINT');
    controller.api
      .printTableTents({
        body: table === undefined ? { size } : { size, tableIds: [table.tableId] },
      })
      .then(
        (file) => {
          downloadFile(file);
          toast.show({ title: t('qrCodes.printed', { file: file.filename }), tone: 'success' });
          setBusy(undefined);
        },
        (failure: unknown) => {
          toast.show({
            title: t('qrCodes.failed', { message: messageOf(failure, t) }),
            tone: 'danger',
          });
          setBusy(undefined);
        },
      );
  };

  /** The table's link to the clipboard; where the browser has none, the code and link show. */
  const copy = (table: TableQrView) => {
    const url = table.url;
    if (url === null) return;
    const { clipboard } = navigator as { clipboard?: Clipboard };
    if (clipboard === undefined) {
      setOpen({ kind: 'SHOW', table });
      return;
    }
    clipboard.writeText(url).then(
      () => {
        toast.show({ title: t('qrCodes.copied', { label: table.label }), tone: 'success' });
      },
      () => {
        setOpen({ kind: 'SHOW', table });
      },
    );
  };

  let content: ReactNode;
  if (data.status === 'loading') {
    content = <LoadingState title={t('states.loading')} />;
  } else if (data.status === 'error') {
    content = (
      <ErrorState
        title={t('qrCodes.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  } else if (data.value.tables.length === 0) {
    content = <EmptyState title={t('qrCodes.noTables')} />;
  } else {
    const { siteUrl, tables } = data.value;
    const missing = tables.filter((table) => !table.hasCode).length;
    const withCode = tables.length - missing;
    content = (
      <>
        {siteUrl === null ? (
          <p role="status" className="console-notice console-notice--warning">
            {t('qrCodes.noSite')}
          </p>
        ) : (
          <p className="console-notice">{t('qrCodes.site', { url: siteUrl })}</p>
        )}
        {missing === 0 ? null : (
          <div className="staff-header">
            <p className="dashboard-section__hint">{t('qrCodes.missing', { count: missing })}</p>
            <Button loading={busy === 'ISSUE'} disabled={busy !== undefined} onClick={issue}>
              {t('qrCodes.issue', { count: missing })}
            </Button>
          </div>
        )}
        <ul className="staff-list" aria-label={t('qrCodes.title')}>
          {tables.map((table) => (
            <li key={table.tableId} className="staff-row">
              {table.url === null ? null : (
                <QrCode
                  value={table.url}
                  label={t('qrCodes.codeOf', { label: table.label })}
                  size={72}
                  className="qr-row__thumb"
                />
              )}
              <div className="staff-row__who">
                <h3 className="staff-row__name">{t('qrCodes.table', { label: table.label })}</h3>
                <p className="staff-row__role">{table.sectionName}</p>
                <p className="staff-row__states">
                  {table.issuedAt === null
                    ? t('qrCodes.noCode')
                    : t('qrCodes.madeAt', displayDateTime(new Date(table.issuedAt)))}
                </p>
                {table.url === null ? null : <p className="qr-row__url">{table.url}</p>}
              </div>
              <div className="staff-row__actions">
                <Button
                  variant="secondary"
                  disabled={table.url === null}
                  aria-label={t('qrCodes.showOf', { label: table.label })}
                  onClick={() => {
                    setOpen({ kind: 'SHOW', table });
                  }}
                >
                  {t('qrCodes.show')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={table.url === null}
                  aria-label={t('qrCodes.copyOf', { label: table.label })}
                  onClick={() => {
                    copy(table);
                  }}
                >
                  {t('qrCodes.copy')}
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === table.tableId}
                  disabled={busy !== undefined || table.url === null}
                  aria-label={t('qrCodes.printOf', { label: table.label })}
                  onClick={() => {
                    print(table);
                  }}
                >
                  {t('qrCodes.printOne')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!table.hasCode}
                  aria-label={t('qrCodes.newOf', { label: table.label })}
                  onClick={() => {
                    setOpen({ kind: 'NEW', table });
                  }}
                >
                  {t('qrCodes.new')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="console-form">
          <ChoiceGroup
            legend={t('qrCodes.size')}
            mode="single"
            options={SIZES.map((option) => ({ id: option, label: t(`qrCodes.sizes.${option}`) }))}
            value={[size]}
            onChange={(value) => {
              const chosen = SIZES.find((option) => option === value[0]);
              if (chosen !== undefined) setSize(chosen);
            }}
          />
          <div>
            <Button
              loading={busy === 'PRINT'}
              disabled={busy !== undefined || withCode === 0 || siteUrl === null}
              onClick={() => {
                print();
              }}
            >
              {t('qrCodes.print')}
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <section className="dashboard-section" aria-labelledby="dashboard-qr-codes">
      <h2 id="dashboard-qr-codes" className="dashboard-section__heading">
        {t('qrCodes.title')}
      </h2>
      <p className="dashboard-section__hint">{t('qrCodes.intro')}</p>
      <UpiNotice />
      {content}
      {open?.kind === 'SHOW' && open.table.url !== null ? (
        <Dialog
          open
          onClose={() => {
            setOpen(undefined);
          }}
          title={t('qrCodes.table', { label: open.table.label })}
        >
          <QrCode value={open.table.url} label={t('qrCodes.codeOf', { label: open.table.label })} />
          <p className="dashboard-section__hint">{open.table.url}</p>
        </Dialog>
      ) : null}
      {open?.kind === 'NEW' ? (
        <NewCodeDialog
          table={open.table}
          onClose={() => {
            setOpen(undefined);
          }}
          onDone={() => {
            setOpen(undefined);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

/** QR-001: a new code for a table; the printed one stops working. Asks why (audited). */
function NewCodeDialog({
  table,
  onClose,
  onDone,
}: {
  table: TableQrView;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('qrCodes.newOf', { label: table.label })}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('qrCodes.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => {
              setBusy(true);
              setError(undefined);
              controller.api
                .regenerateTableQrCode({
                  params: { tableId: table.tableId },
                  body: { reason: reason.trim() },
                })
                .then(
                  () => {
                    toast.show({
                      title: t('qrCodes.regenerated', { label: table.label }),
                      tone: 'success',
                    });
                    onDone();
                  },
                  (failure: unknown) => {
                    setBusy(false);
                    setError(messageOf(failure, t));
                  },
                );
            }}
          >
            {t('qrCodes.newConfirm')}
          </Button>
        </>
      }
    >
      <p role="alert" className="console-notice console-notice--warning">
        {t('qrCodes.newWarning', { label: table.label })}
      </p>
      <TextField
        label={t('qrCodes.reason')}
        value={reason}
        maxLength={200}
        error={error}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
    </Dialog>
  );
}
