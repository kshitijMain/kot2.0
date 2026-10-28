import {
  MENU_FILE_CONTENT_TYPE,
  MENU_FILE_EMPTY_NAME,
  MENU_FILE_MAX_BYTES,
  MENU_FILE_WORKBOOK_CONTENT_TYPE,
  type MenuFileChoices,
  type MenuFileDish,
  type MenuFileImportResult,
  type MenuFileReview,
  type MenuImportIssue,
  type MenuImportReport,
} from '@rp/contracts';
import { calendarDateOf, formatRupees } from '@rp/domain';
import {
  Badge,
  Button,
  DishPhoto,
  ErrorState,
  Icon,
  LoadingState,
  Select,
  Table,
  useToast,
} from '@rp/ui-web';
import { type ReactNode, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useConsole } from '../../app/console-context.js';
import { saveBlob } from '../../app/download.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';

const MAX_MB = MENU_FILE_MAX_BYTES / 1024 / 1024;

/** The empty menu file, as a button: Set up step 7 and the menu file screen both offer it. */
export function EmptyMenuFileDownload({
  variant = 'secondary',
}: {
  variant?: 'primary' | 'secondary';
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      loading={busy}
      startIcon={<Icon name="receipt" />}
      onClick={() => {
        setBusy(true);
        controller.files.download('emptyMenuFile').then(
          (file) => {
            setBusy(false);
            saveBlob(MENU_FILE_EMPTY_NAME, file);
          },
          (failure: unknown) => {
            setBusy(false);
            toast.show({ title: messageOf(failure, t), tone: 'danger' });
          },
        );
      }}
    >
      {t('menuFile.download')}
    </Button>
  );
}

/** The menu with its photos as a menu file, to load at another restaurant or keep as a copy. */
export function ExportMenuFile() {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      title={t('menuFile.exportHint')}
      onClick={() => {
        setBusy(true);
        controller.files.download('exportMenuFile', { timeoutMs: 120_000 }).then(
          (file) => {
            setBusy(false);
            saveBlob(`menu-${calendarDateOf(new Date())}.zip`, file);
          },
          (failure: unknown) => {
            setBusy(false);
            toast.show({ title: messageOf(failure, t), tone: 'danger' });
          },
        );
      }}
    >
      {t('menuFile.export')}
    </Button>
  );
}

type Stage =
  | { readonly kind: 'CHOOSE' }
  | {
      readonly kind: 'REVIEW';
      readonly file: string;
      readonly review: MenuFileReview;
      readonly choices: MenuFileChoices;
      readonly report: MenuImportReport;
    }
  | { readonly kind: 'DONE'; readonly result: MenuFileImportResult };

/** The suggested names and photo matches, as the first choices. */
function choicesOf(review: MenuFileReview): MenuFileChoices {
  const chosen = (names: MenuFileReview['names']['taxGroups']) =>
    names.flatMap((entry) =>
      entry.suggestedId === null ? [] : [{ name: entry.name, id: entry.suggestedId }],
    );
  return {
    taxGroups: chosen(review.names.taxGroups),
    stations: chosen(review.names.stations),
    photos: review.photos.map((photo) => ({ file: photo.file, dish: photo.dish })),
  };
}

const thumbnailOf = (review: MenuFileReview, file: string) => {
  const photo = review.photos.find((entry) => entry.file === file);
  return photo === undefined || photo.thumbnailBase64 === ''
    ? undefined
    : `data:image/webp;base64,${photo.thumbnailBase64}`;
};

/**
 * The menu file (ONB-005, ONB-007): download it empty, fill it anywhere, load it here. The server
 * checks it and answers with every dish, every photo with its match, and the names of tax groups
 * and kitchen stations the file uses; the manager maps those to this PC's, corrects photo
 * matches, sees the check, and only then adds it, as a draft. Publishing is the menu's own step.
 */
export function MenuFileScreen() {
  const t = useT();
  const controller = useConsole();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const { data, reload } = useLive(
    async () => {
      const [taxGroups, stations] = await Promise.all([
        controller.api.listTaxGroups(),
        controller.api.listStations(),
      ]);
      return {
        taxGroups: taxGroups.taxGroups.filter((group) => group.archivedAt === null),
        stations: stations.stations.filter((station) => station.archivedAt === null),
      };
    },
    (type) => type === 'RestaurantChanged',
  );
  const [stage, setStage] = useState<Stage>({ kind: 'CHOOSE' });
  const [busy, setBusy] = useState<'LOAD' | 'CHECK' | 'IMPORT' | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = async (file: File) => {
    setError(undefined);
    if (file.size > MENU_FILE_MAX_BYTES) {
      setError(t('menuFile.tooLarge', { size: MAX_MB }));
      return;
    }
    setBusy('LOAD');
    try {
      const review = await controller.files.upload(
        'loadMenuFile',
        {
          content: file,
          contentType: /\.xlsx$/i.test(file.name)
            ? MENU_FILE_WORKBOOK_CONTENT_TYPE
            : MENU_FILE_CONTENT_TYPE,
        },
        { timeoutMs: 300_000 },
      );
      setStage({
        kind: 'REVIEW',
        file: file.name,
        review,
        choices: choicesOf(review),
        report: review.report,
      });
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(undefined);
    }
  };

  const choose = async (choices: MenuFileChoices) => {
    if (stage.kind !== 'REVIEW') return;
    setStage({ ...stage, choices });
    setBusy('CHECK');
    setError(undefined);
    try {
      const report = await controller.api.checkMenuFile({
        params: { fileId: stage.review.id },
        body: choices,
      });
      setStage((current) =>
        current.kind === 'REVIEW' ? { ...current, choices, report } : current,
      );
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(undefined);
    }
  };

  const add = async () => {
    if (stage.kind !== 'REVIEW') return;
    setBusy('IMPORT');
    setError(undefined);
    try {
      const result = await controller.api.importMenuFile({
        params: { fileId: stage.review.id },
        body: stage.choices,
        timeoutMs: 300_000,
      });
      if (result.report.committed) setStage({ kind: 'DONE', result });
      else setStage({ ...stage, report: result.report });
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(undefined);
    }
  };

  let body: ReactNode;
  if (stage.kind === 'DONE') {
    const { result } = stage;
    body = (
      <section className="device-group" aria-live="polite">
        <p className="console-notice console-notice--success" role="status">
          {t('menuFile.added', {
            items: result.report.summary?.items ?? 0,
            photos: result.photos,
          })}
        </p>
        <div className="menu-actions">
          <Button
            onClick={() => {
              void navigate('/manage/menu');
            }}
          >
            {t('menuFile.reviewMenu')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setStage({ kind: 'CHOOSE' });
            }}
          >
            {t('menuFile.another')}
          </Button>
        </div>
      </section>
    );
  } else if (stage.kind === 'REVIEW') {
    if (data.status === 'loading') body = <LoadingState title={t('states.loading')} />;
    else if (data.status === 'error') {
      body = (
        <ErrorState
          title={t('menuEditor.loadFailed')}
          description={messageOf(data.error, t)}
          onRetry={reload}
          retryLabel={t('states.retry')}
        />
      );
    } else {
      body = (
        <MenuFileReviewView
          stage={stage}
          taxGroups={data.value.taxGroups}
          stations={data.value.stations}
          busy={busy}
          onChoose={(choices) => {
            void choose(choices);
          }}
          onAdd={() => {
            void add();
          }}
          onAnother={() => {
            setStage({ kind: 'CHOOSE' });
          }}
        />
      );
    }
  } else {
    body = (
      <>
        <section className="device-group" aria-labelledby="menu-file-step-1">
          <h3 id="menu-file-step-1" className="device-group__heading">
            {t('menuFile.step1')}
          </h3>
          <p className="dashboard-section__hint">{t('menuFile.step1Text')}</p>
          <div className="menu-actions">
            <EmptyMenuFileDownload />
          </div>
        </section>
        <section className="device-group" aria-labelledby="menu-file-step-2">
          <h3 id="menu-file-step-2" className="device-group__heading">
            {t('menuFile.step2')}
          </h3>
          <p className="dashboard-section__hint">{t('menuFile.step2Text', { size: MAX_MB })}</p>
          <input
            ref={input}
            type="file"
            accept={`.zip,.xlsx,${MENU_FILE_CONTENT_TYPE},application/x-zip-compressed,${MENU_FILE_WORKBOOK_CONTENT_TYPE}`}
            className="menu-photo__input"
            aria-label={t('menuFile.load')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) void load(file);
            }}
          />
          <div className="menu-actions">
            <Button
              loading={busy === 'LOAD'}
              onClick={() => {
                input.current?.click();
              }}
            >
              {t('menuFile.load')}
            </Button>
          </div>
          {busy === 'LOAD' ? (
            <p className="dashboard-section__hint" role="status">
              {t('menuFile.loading')}
            </p>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <section className="dashboard-section" aria-labelledby="dashboard-menu-file">
      <div className="staff-header">
        <h2 id="dashboard-menu-file" className="dashboard-section__heading">
          {t('menuFile.title')}
        </h2>
        <Link to="/manage/menu" className="staff-pages__link">
          {t('menuFile.back')}
        </Link>
      </div>
      <p className="dashboard-section__hint">{t('menuFile.intro')}</p>
      {body}
      {error === undefined ? null : (
        <p role="alert" className="console-notice console-notice--danger">
          {error}
        </p>
      )}
    </section>
  );
}

function MenuFileReviewView({
  stage,
  taxGroups,
  stations,
  busy,
  onChoose,
  onAdd,
  onAnother,
}: {
  stage: Extract<Stage, { kind: 'REVIEW' }>;
  taxGroups: readonly { id: string; name: string }[];
  stations: readonly { id: string; name: string }[];
  busy: 'LOAD' | 'CHECK' | 'IMPORT' | undefined;
  onChoose: (choices: MenuFileChoices) => void;
  onAdd: () => void;
  onAnother: () => void;
}) {
  const t = useT();
  const { review, choices, report } = stage;

  const issueText = (issue: MenuImportIssue) =>
    issue.row === null
      ? t('menuFile.issueSheet', { sheet: issue.sheet, message: issue.message })
      : issue.column === null
        ? t('menuFile.issue', { sheet: issue.sheet, row: issue.row, message: issue.message })
        : t('menuFile.issueColumn', {
            sheet: issue.sheet,
            row: issue.row,
            column: issue.column,
            message: issue.message,
          });

  const nameSelect = (
    kind: 'taxGroups' | 'stations',
    name: string,
    options: readonly { id: string; name: string }[],
  ) => {
    const value = choices[kind].find((choice) => choice.name === name)?.id ?? '';
    return (
      <Select
        key={`${kind}-${name}`}
        label={t(kind === 'taxGroups' ? 'menuFile.taxGroup' : 'menuFile.station', { name })}
        placeholder={t('menuFile.pick')}
        value={value}
        options={options.map((option) => ({ value: option.id, label: option.name }))}
        onChange={(event) => {
          const id = event.target.value;
          const others = choices[kind].filter((choice) => choice.name !== name);
          onChoose({ ...choices, [kind]: id === '' ? others : [...others, { name, id }] });
        }}
      />
    );
  };

  /** The photo chosen for each dish: the first one, as the import uses. */
  const photoOfDish = new Map<string, string>();
  for (const choice of choices.photos) {
    const key = choice.dish?.toLowerCase();
    if (key !== undefined && !photoOfDish.has(key)) photoOfDish.set(key, choice.file);
  }
  const matched = choices.photos.filter((choice) => choice.dish !== null).length;

  const sizesText = (dish: MenuFileDish) =>
    dish.sizes.length === 0
      ? dish.price === null
        ? t('menuFile.noPrice')
        : formatRupees(dish.price)
      : dish.sizes
          .map((size) =>
            size.price === null ? size.name : `${size.name} ${formatRupees(size.price)}`,
          )
          .join(' · ');

  const names = [...review.names.taxGroups, ...review.names.stations];
  return (
    <>
      <section className="device-group" aria-labelledby="menu-file-review">
        <h3 id="menu-file-review" className="device-group__heading">
          {t('menuFile.review')}
        </h3>
        <p className="dashboard-section__hint">{t('menuFile.loaded', { file: stage.file })}</p>

        <h4 className="menu-file__subheading">{t('menuFile.names')}</h4>
        <p className="dashboard-section__hint">{t('menuFile.namesHint')}</p>
        {names.length === 0 ? (
          <p className="dashboard-section__hint">{t('menuFile.noNames')}</p>
        ) : (
          <div className="menu-file__names">
            {review.names.taxGroups.map((entry) => nameSelect('taxGroups', entry.name, taxGroups))}
            {review.names.stations.map((entry) => nameSelect('stations', entry.name, stations))}
          </div>
        )}

        <div aria-live="polite">
          {busy === 'CHECK' ? (
            <p className="dashboard-section__hint" role="status">
              {t('menuFile.checking')}
            </p>
          ) : report.ok ? (
            <p className="console-notice console-notice--success" role="status">
              {t('menuFile.ready', {
                items: report.summary?.items ?? 0,
                variants: report.summary?.variants ?? 0,
                groups: report.summary?.modifierGroups ?? 0,
                combos: report.summary?.combos ?? 0,
              })}
            </p>
          ) : (
            <div className="console-notice console-notice--danger" role="alert">
              <p className="menu-health__heading">
                {t('menuFile.problems', { count: report.issues.length })}
              </p>
              <ul className="menu-health__list">
                {report.issues.map((issue, index) => (
                  <li key={`${issue.sheet}-${String(issue.row)}-${String(index)}`}>
                    {issueText(issue)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="device-group" aria-labelledby="menu-file-dishes">
        <h3 id="menu-file-dishes" className="device-group__heading">
          {t('menuFile.dishes', { count: review.dishes.length })}
        </h3>
        <Table
          caption={t('menuFile.dishes', { count: review.dishes.length })}
          hideCaption
          className="menu-file__dishes"
          rowKey={(dish) => String(dish.row)}
          rows={review.dishes}
          columns={[
            {
              key: 'photo',
              header: t('menuFile.photoColumn'),
              width: '5rem',
              cell: (dish) => {
                const file = photoOfDish.get(dish.name.toLowerCase());
                return (
                  <DishPhoto
                    src={file === undefined ? undefined : thumbnailOf(review, file)}
                    alt={file ?? ''}
                    className="menu-file__thumbnail"
                  />
                );
              },
            },
            {
              key: 'dish',
              header: t('menuFile.dishColumn'),
              cell: (dish) => (
                <span className="menu-file__dish">
                  <span>{dish.name}</span>
                  {dish.shortCode === null ? null : (
                    <span className="menu-file__code">{dish.shortCode}</span>
                  )}
                  {dish.combo ? <Badge tone="info">{t('menuFile.combo')}</Badge> : null}
                </span>
              ),
            },
            {
              key: 'category',
              header: t('menuFile.categoryColumn'),
              cell: (dish) =>
                dish.subCategory === null
                  ? dish.category
                  : `${dish.category} › ${dish.subCategory}`,
            },
            { key: 'price', header: t('menuFile.priceColumn'), cell: sizesText },
            {
              key: 'addOns',
              header: t('menuFile.addOnsColumn'),
              cell: (dish) => dish.addOnGroups.join(', '),
            },
          ]}
        />
      </section>

      <section className="device-group" aria-labelledby="menu-file-photos">
        <h3 id="menu-file-photos" className="device-group__heading">
          {t('menuFile.photos', { matched, count: review.photos.length })}
        </h3>
        {review.photos.length === 0 ? (
          <p className="dashboard-section__hint">{t('menuFile.noPhotos')}</p>
        ) : (
          <>
            <p className="dashboard-section__hint">{t('menuFile.photosHint')}</p>
            <ul className="menu-file__photos">
              {review.photos.map((photo) => {
                const choice = choices.photos.find((entry) => entry.file === photo.file);
                const dish = choice?.dish ?? null;
                const taken = dish !== null && photoOfDish.get(dish.toLowerCase()) !== photo.file;
                const note =
                  dish === null
                    ? t('menuFile.unmatched')
                    : dish === photo.dish
                      ? photo.by === 'CODE'
                        ? t('menuFile.byCode')
                        : t('menuFile.byName')
                      : null;
                return (
                  <li key={photo.file} className="menu-file__photo">
                    <DishPhoto
                      src={thumbnailOf(review, photo.file)}
                      alt={photo.file}
                      className="menu-file__thumbnail"
                    />
                    <div className="menu-file__photo-body">
                      <Select
                        label={t('menuFile.photoFor', { file: photo.file })}
                        value={dish ?? ''}
                        options={[
                          { value: '', label: t('menuFile.leaveOut') },
                          ...review.dishes.map((entry) => ({
                            value: entry.name,
                            label: entry.name,
                          })),
                        ]}
                        hint={note ?? undefined}
                        error={taken ? t('menuFile.taken', { dish }) : undefined}
                        onChange={(event) => {
                          const value = event.target.value;
                          onChoose({
                            ...choices,
                            photos: choices.photos.map((entry) =>
                              entry.file === photo.file
                                ? { file: photo.file, dish: value === '' ? null : value }
                                : entry,
                            ),
                          });
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="device-group">
        <p className="dashboard-section__hint">{t('menuFile.confirmNote')}</p>
        <div className="menu-actions">
          <Button
            loading={busy === 'IMPORT'}
            disabled={!report.ok || busy !== undefined}
            onClick={onAdd}
          >
            {t('menuFile.confirm')}
          </Button>
          <Button variant="secondary" disabled={busy !== undefined} onClick={onAnother}>
            {t('menuFile.another')}
          </Button>
        </div>
      </section>
    </>
  );
}
