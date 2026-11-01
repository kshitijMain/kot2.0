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
 * that never leaves it; the code proves a manager allowed it. Where the server runs PIN-only the
 * browser connects by itself and no code is asked for (ADR-0025).
 */
export function PairingScreen() {
  const { pinOnly } = useConsoleState();
  // Nobody pairs a device where the server runs PIN-only (Business Owner, 2026-11-01).
  return pinOnly ? <ConnectAgain /> : <CodePairing />;
}

/**
 * Where the server runs PIN-only (ADR-0025) a browser connects by itself; this is what shows when
 * it could not, or after a manager removed it: why, and "Try again". No code to type.
 */
function ConnectAgain() {
  const t = useT();
  const controller = useConsole();
  const { notice } = useConsoleState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(notice !== 'revoked');

  async function retry(): Promise<void> {
    setBusy(true);
    const connected = await controller.connectByItself();
    setBusy(false);
    setFailed(!connected);
    if (connected) await navigate('/', { replace: true });
  }

  return (
    <main className="console-center">
      <BrandLogo />
      <Card title={t('connect.title')} headingLevel={2} variant="raised" className="console-panel">
        {notice === 'revoked' ? (
          <p className="console-notice" role="status">
            {t('connect.browserRemoved')}
          </p>
        ) : null}
        {failed ? (
          <p className="console-notice console-notice--danger" role="alert">
            {t('connect.browserFailed')}
          </p>
        ) : null}
        <p className="dashboard-section__hint">{t('connect.browserWifi')}</p>
        <Button
          size="lg"
          disabled={busy}
          onClick={() => {
            void retry();
          }}
        >
          {busy ? t('connect.working') : t('connect.retry')}
        </Button>
      </Card>
    </main>
  );
}

/**
 * Pairs this browser with a manager's one-time code (AUTH-007), where the server is not PIN-only.
 */
function CodePairing() {
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
