'use client';

import type { MenuSnapshot } from '@rp/contracts';
import type { QrPhoneAsk } from '@rp/contracts/relay';
import { displayPhone, formatRupees, type PriceMode } from '@rp/domain';
import { type CartLine, estimateCart } from '@rp/ordering';
import { Button, IconButton, Icon, QuantityStepper, Sheet, TextField } from '@rp/ui-web';
import { useT } from './i18n';
import { QrEmpty } from './States';

/**
 * The order before it is sent (QR-004, QR-005): each line with its options and note, how many,
 * an optional note and name, and the estimated total; the restaurant prices the order itself.
 */
export function CartSheet({
  lines,
  menu,
  priceMode,
  note,
  name,
  phone,
  phoneAsk,
  readOnly,
  sending,
  message,
  onQuantity,
  onRemove,
  onNote,
  onName,
  onChangePhone,
  onSend,
  onClose,
}: {
  lines: readonly CartLine[];
  menu: MenuSnapshot;
  priceMode: PriceMode;
  note: string;
  name: string;
  /** P9-02: the diner's mobile number, as typed. */
  phone: string;
  phoneAsk: QrPhoneAsk;
  readOnly: boolean;
  sending: boolean;
  message: string | undefined;
  onQuantity: (clientLineId: string, quantity: number) => void;
  onRemove: (clientLineId: string) => void;
  onNote: (note: string) => void;
  onName: (name: string) => void;
  /** Back to the welcome step to give another number. */
  onChangePhone: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const estimate = estimateCart(lines, menu, priceMode);
  const foodOf = new Map(menu.items.map((item) => [item.id, item.foodType]));
  return (
    <Sheet
      open
      className="qr-sheet"
      onClose={onClose}
      title={t('qrSite.cart.title')}
      dismissible={!sending}
      footer={
        lines.length === 0 ? null : (
          <Button
            fullWidth
            variant="accent"
            size="lg"
            loading={sending}
            disabled={readOnly}
            onClick={onSend}
          >
            {sending
              ? t('qrSite.cart.sending')
              : t('qrSite.cart.sendTotal', { total: formatRupees(estimate.total) })}
          </Button>
        )
      }
    >
      {lines.length === 0 ? (
        <QrEmpty
          icon="handPlatter"
          title={t('qrSite.cart.emptyTitle')}
          body={t('qrSite.cart.empty')}
          action={t('qrSite.browse')}
          onAction={onClose}
        />
      ) : (
        <ul className="qr-cart" aria-label={t('qrSite.cart.title')}>
          {lines.map((line) => (
            <li key={line.clientLineId} className="qr-cart__line">
              <div className="qr-cart__what">
                <p className="qr-cart__name">
                  {foodOf.has(line.itemId) ? (
                    <span
                      className="rp-food-mark"
                      data-food={foodOf.get(line.itemId)}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{line.name}</span>
                </p>
                {line.summary === '' ? null : <p className="qr-muted">{line.summary}</p>}
                {line.instructions === '' ? null : (
                  <p className="qr-muted">“{line.instructions}”</p>
                )}
                {line.error === undefined ? null : (
                  <p role="alert" className="qr-cart__error">
                    {line.error}
                  </p>
                )}
              </div>
              <div className="qr-cart__how">
                <QuantityStepper
                  value={line.quantity}
                  min={1}
                  max={99}
                  onChange={(value) => {
                    onQuantity(line.clientLineId, value);
                  }}
                  label={t('qrSite.cart.quantityOf', { name: line.name })}
                  decreaseLabel={t('qrSite.item.fewer')}
                  increaseLabel={t('qrSite.item.more')}
                />
                <span className="qr-cart__price">
                  {formatRupees(line.unitPrice * line.quantity)}
                </span>
                <IconButton
                  label={t('qrSite.cart.remove', { name: line.name })}
                  icon={<Icon name="close" />}
                  variant="ghost"
                  onClick={() => {
                    onRemove(line.clientLineId);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="qr-form">
        <TextField
          label={t('qrSite.cart.note')}
          value={note}
          maxLength={500}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
        {phoneAsk === 'OFF' ? null : (
          <p className="qr-cart__phone">
            <span>
              {phone === ''
                ? t('qrSite.cart.noPhone')
                : t('qrSite.cart.phoneOnBill', { phone: displayPhone(phone) })}
            </span>
            <Button variant="ghost" onClick={onChangePhone}>
              {phone === '' ? t('qrSite.cart.addPhone') : t('qrSite.welcome.change')}
            </Button>
          </p>
        )}
        <TextField
          label={t('qrSite.cart.name')}
          value={name}
          maxLength={60}
          autoComplete="given-name"
          onChange={(event) => {
            onName(event.target.value);
          }}
        />
      </div>
      {lines.length === 0 ? null : (
        <dl className="qr-totals">
          <div>
            <dt>{t('qrSite.cart.subtotal')}</dt>
            <dd>{formatRupees(estimate.subtotal)}</dd>
          </div>
          <div>
            <dt>
              {priceMode === 'TAX_INCLUSIVE' ? t('qrSite.cart.taxIncluded') : t('qrSite.cart.tax')}
            </dt>
            <dd>{formatRupees(estimate.tax)}</dd>
          </div>
          <div className="qr-totals__total">
            <dt>{t('qrSite.cart.total')}</dt>
            <dd>{formatRupees(estimate.total)}</dd>
          </div>
          <p className="qr-muted">{t('qrSite.cart.estimate')}</p>
        </dl>
      )}
      {readOnly ? (
        <p role="status" className="qr-notice qr-notice--warning">
          {t('qrSite.cart.closed')}
        </p>
      ) : null}
      {message === undefined ? null : (
        <p role="alert" className="qr-notice qr-notice--danger">
          {message}
        </p>
      )}
    </Sheet>
  );
}
