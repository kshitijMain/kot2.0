import { Link } from 'react-router';
import { useConsole } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { useLive } from '../app/use-live.js';

/**
 * While the restaurant has no UPI ID, diners cannot pay from the QR menu (P9-03): say so where the
 * manager looks, with the way to the setting (P9-16). Nothing once it is set, or for someone who
 * cannot change settings.
 */
export function UpiNotice() {
  const t = useT();
  const controller = useConsole();
  const { data } = useLive(
    async () =>
      (await controller.api.listSettings()).settings.find(
        (setting) => setting.key === 'payments.upiId',
      ),
    (type) => type === 'SettingsChanged',
  );
  if (data.status !== 'ready' || data.value === undefined) return null;
  if (data.value.value !== null || !data.value.editable) return null;
  return (
    <p className="console-notice console-notice--warning">
      {t('dashboard.upi.missing')}{' '}
      <Link to="/manage/settings?find=UPI">{t('dashboard.upi.add')}</Link>
    </p>
  );
}
