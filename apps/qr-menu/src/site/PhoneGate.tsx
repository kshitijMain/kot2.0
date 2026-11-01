'use client';

import type { QrPhoneAsk } from '@rp/contracts/relay';
import { indianMobile } from '@rp/domain';
import { Button, TextField } from '@rp/ui-web';
import { type SyntheticEvent, useState } from 'react';
import { useT } from './i18n';

/**
 * The welcome step (P9-02, P9-04): the restaurant and the table the code opened, and the diner's
 * mobile number before the first order, said to be printed on their bill and used for nothing
 * else (their consent for that, BILL-011). Skippable only where the restaurant makes it optional.
 */
export function PhoneGate({
  restaurant,
  table,
  ask,
  initial,
  onDone,
  onSkip,
}: {
  restaurant: string;
  table: string;
  ask: Exclude<QrPhoneAsk, 'OFF'>;
  initial: string;
  /** The number as +91 and ten digits. */
  onDone: (phone: string) => void;
  onSkip: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial.replace(/^\+91/, ''));
  const [error, setError] = useState<string | undefined>();
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const phone = indianMobile(value);
    if (phone === undefined) {
      setError(t('qrSite.cart.phoneInvalid'));
      return;
    }
    onDone(phone);
  };
  return (
    <main className="qr-welcome">
      <div className="qr-welcome__card">
        <p className="qr-welcome__hello">{t('qrSite.welcome.hello')}</p>
        <h1 className="qr-welcome__name">{restaurant}</h1>
        <p className="qr-welcome__table">{t('qrSite.welcome.table', { label: table })}</p>
        <form className="qr-welcome__form" onSubmit={submit} noValidate>
          <TextField
            label={ask === 'REQUIRED' ? t('qrSite.cart.phone') : t('qrSite.cart.phoneOptional')}
            hint={t('qrSite.cart.phoneHint')}
            error={error}
            value={value}
            type="tel"
            inputMode="numeric"
            maxLength={16}
            autoComplete="tel-national"
            placeholder="98765 43210"
            required={ask === 'REQUIRED'}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
          />
          <Button type="submit" size="lg" fullWidth variant="accent">
            {t('qrSite.welcome.start')}
          </Button>
          {ask === 'OPTIONAL' ? (
            <Button type="button" variant="ghost" fullWidth onClick={onSkip}>
              {t('qrSite.welcome.skip')}
            </Button>
          ) : null}
        </form>
      </div>
    </main>
  );
}
