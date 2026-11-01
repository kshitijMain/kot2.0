'use client';

import type { QrServiceRequestView } from '@rp/contracts/relay';
import { Icon } from '@rp/ui-web';
import { useEffect, useState } from 'react';
import { useT } from './i18n';

/** How long a request that did not go through stays said: the diner has read it by then. */
const REFUSED_SHOWN_MS = 20_000;

/**
 * Where a diner's request stands, as a sentence in a small card (P9-23): "A waiter is on the
 * way.", "You asked for the bill. It appears here as soon as it is printed." A request the staff
 * have dealt with says nothing more; one that did not reach them says what to do, for a while.
 */
export function RequestNote({ request }: { request: QrServiceRequestView | undefined }) {
  const t = useT();
  const refused = request?.status === 'REJECTED' || request?.status === 'EXPIRED';
  const requestId = request?.id;
  const [expiredId, setExpiredId] = useState<string | undefined>();
  useEffect(() => {
    if (!refused || requestId === undefined) return undefined;
    const timer = setTimeout(() => {
      setExpiredId(requestId);
    }, REFUSED_SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [refused, requestId]);
  if (request === undefined || request.status === 'DONE') return null;
  if (request.status === 'REJECTED' || request.status === 'EXPIRED') {
    // A refusal is not left up for good (P9-23): "This table is not open yet" stayed after the
    // table was opened.
    if (expiredId === request.id) return null;
    return (
      <p role="status" className="qr-request" data-tone="danger">
        <Icon name="warning" />
        <span>
          {t(`qrSite.help.status.${request.status}`, { reason: request.rejectionReason ?? '' })}
        </span>
      </p>
    );
  }
  return (
    <p
      role="status"
      className="qr-request"
      data-tone={request.status === 'ACKNOWLEDGED' ? 'success' : 'info'}
    >
      <Icon name={request.status === 'ACKNOWLEDGED' ? 'check' : 'bell'} />
      <span>{t(`qrSite.help.said.${request.type}.${request.status}`)}</span>
    </p>
  );
}
