import { PairingCode } from '@rp/contracts';
import { Button, Card, TextField } from '@rp/ui-web';
import { type SyntheticEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { BrandLogo } from '../app/brand.js';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { canCreateDeviceKey, formatPairingCode, messageOf } from '../app/messages.js';
import { onServerPc, ThisPcSetup } from './ThisPcSetup.js';

/**
 * Pairs this browser with a manager's one-time code (AUTH-007). The browser creates a device key
 * that never leaves it; the code proves a manager allowed it.
 */
export function PairingScreen() {
  const t = useT();
  const controller = useConsole();
  const { notice } = useConsoleState();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const secure = canCreateDeviceKey();
  const valid = PairingCode.safeParse(code).success;

  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    // Say what is wrong rather than leave the button grey (P9-08): a PIN is the usual mistake.
    if (!valid) {
      setError(
        /^\d{1,6}$/.test(code.replace('-', '')) ? t('pairing.notAPin') : t('pairing.codeFormat'),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await controller.pair(code);
      await navigate('/', { replace: true });
    } catch (caught) {
      setError(messageOf(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="console-center">
      <BrandLogo />
      {secure && onServerPc() ? <ThisPcSetup /> : null}
      <Card title={t('pairing.title')} headingLevel={2} variant="raised" className="console-panel">
        {notice === 'revoked' ? (
          <p className="console-notice" role="status">
            {t('pairing.revoked')}
          </p>
        ) : null}
        {secure ? null : (
          <p className="console-notice console-notice--danger" role="alert">
            {t('pairing.insecureContext')}
          </p>
        )}
        <form
          className="console-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <TextField
            label={t('pairing.codeLabel')}
            hint={t('pairing.intro')}
            value={code}
            onChange={(event) => {
              setCode(formatPairingCode(event.target.value));
              setError(undefined);
            }}
            error={error}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={!secure}
            required
          />
          <Button type="submit" size="lg" disabled={!secure || busy || code === ''}>
            {busy ? t('pairing.working') : t('pairing.submit')}
          </Button>
        </form>
        {onServerPc() ? null : (
          <p className="dashboard-section__hint">{t('pairing.firstScreen')}</p>
        )}
      </Card>
    </main>
  );
}
