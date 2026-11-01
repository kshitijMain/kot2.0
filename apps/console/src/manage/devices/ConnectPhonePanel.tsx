import { Card, ErrorState, LoadingState, QrCode } from '@rp/ui-web';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';

/**
 * Connect a phone (P9-27): the Connect QR the waiter app scans once to know where this PC is and
 * which certificate is its own, with the PC's address beside it for typing. Most phones find the
 * PC by themselves on the staff Wi-Fi (mDNS); the code is for when they cannot.
 */
export function ConnectPhonePanel() {
  const t = useT();
  const controller = useConsole();
  // Read again when devices change, as the addresses may have too.
  const { data, reload } = useLive(
    () => controller.api.getConnectInfo(),
    (type) => type === 'RestaurantChanged',
  );
  if (data.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (data.status === 'error') {
    return (
      <ErrorState
        title={t('devices.connect.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  const info = data.value;
  return (
    <Card className="connect-phone" aria-labelledby="connect-phone-title">
      <div className="connect-phone__text">
        <h3 id="connect-phone-title" className="connect-phone__title">
          {t('devices.connect.title')}
        </h3>
        <ol className="connect-phone__steps">
          <li>{t('devices.connect.step1')}</li>
          <li>{t('devices.connect.step2')}</li>
          <li>{t('devices.connect.step3')}</li>
        </ol>
        {info.urls.length === 0 ? (
          <p className="console-notice console-notice--warning">{t('devices.connect.noNetwork')}</p>
        ) : (
          <p className="connect-phone__address">
            {t('devices.connect.address')} <strong>{info.urls[0]}</strong>
          </p>
        )}
        <p className="connect-phone__note">
          {info.announced ? t('devices.connect.announced') : t('devices.connect.notAnnounced')}
        </p>
      </div>
      {info.urls.length === 0 ? null : (
        <QrCode
          value={info.qrPayload}
          label={t('devices.connect.qrLabel', { name: info.restaurantName })}
          size={176}
          className="connect-phone__qr"
        />
      )}
    </Card>
  );
}
