'use client';

import type { QrServiceRequestType } from '@rp/contracts/relay';
import { Button } from '@rp/ui-web';
import { useT } from './i18n';
import type { ServiceRequests } from './requests';
import { RequestNote } from './RequestNote';

/**
 * Buttons that ask the staff for something (QR-011): Call waiter, Request bill, "I have paid", with
 * where each stands as the restaurant answers ("Waiter notified", "Waiter is on the way").
 */
export function HelpButtons({
  types,
  requests,
  readOnly,
  variant = 'secondary',
}: {
  types: readonly QrServiceRequestType[];
  requests: ServiceRequests;
  readOnly: boolean;
  variant?: 'secondary' | 'primary' | 'accent';
}) {
  const t = useT();
  const latest = types.flatMap((type) => {
    const request = requests.latest(type);
    return request === undefined ? [] : [request];
  });
  // A request still open needs no second press: its card says where it stands (P9-23).
  const shown = types.filter((type) => !requests.open(type));
  return (
    <div className="qr-help">
      {shown.length === 0 ? null : (
        <div className="qr-help__buttons">
          {shown.map((type) => (
            <Button
              key={type}
              variant={variant}
              loading={requests.busy === type}
              disabled={readOnly || requests.busy !== undefined}
              onClick={() => {
                requests.ask(type);
              }}
            >
              {t(`qrSite.help.${type}`)}
            </Button>
          ))}
        </div>
      )}
      {latest.map((request) => (
        <RequestNote key={request.id} request={request} />
      ))}
      {requests.failed ? (
        <p role="alert" className="qr-notice qr-notice--danger">
          {t('qrSite.help.failed')}
        </p>
      ) : null}
    </div>
  );
}
