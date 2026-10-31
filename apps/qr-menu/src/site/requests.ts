'use client';

import type { QrServiceRequestType, QrServiceRequestView } from '@rp/contracts/relay';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchServiceRequest, raiseServiceRequest } from './relay';
import { browserId, newUuid, tableValue } from './storage';

const NO_IDS: readonly string[] = [];
const POLL_MS = 3_000;
const SETTLED = new Set(['DONE', 'REJECTED', 'EXPIRED']);

export interface ServiceRequests {
  /** The latest request of a kind from this browser at this table. */
  latest: (type: QrServiceRequestType) => QrServiceRequestView | undefined;
  /** Whether one of a kind is still open (sent, received or on its way). */
  open: (type: QrServiceRequestType) => boolean;
  ask: (type: QrServiceRequestType) => void;
  busy: QrServiceRequestType | undefined;
  failed: boolean;
}

/**
 * Call waiter, Request bill and "I have paid" from the QR page (QR-011, P9-03): the same service
 * requests as the tablet's, followed until the restaurant has dealt with them. Pressing again
 * while one is open finds the open one. Asked about every few seconds only while one is open.
 */
export function useServiceRequests(token: string, relayUrl: string): ServiceRequests {
  const stored = useMemo(
    () =>
      tableValue<readonly string[]>(
        token,
        'requests',
        (value) =>
          Array.isArray(value)
            ? value.filter((id): id is string => typeof id === 'string')
            : undefined,
        NO_IDS,
      ),
    [token],
  );
  const ids = useSyncExternalStore(stored.subscribe, stored.get, () => stored.empty);
  const [requests, setRequests] = useState<ReadonlyMap<string, QrServiceRequestView>>(new Map());
  const [busy, setBusy] = useState<QrServiceRequestType | undefined>();
  const [failed, setFailed] = useState(false);

  const unsettled = ids
    .filter((id) => {
      const request = requests.get(id);
      return request === undefined || !SETTLED.has(request.status);
    })
    .join(',');
  useEffect(() => {
    if (unsettled === '') return;
    let stopped = false;
    const poll = () => {
      for (const id of unsettled.split(',')) {
        fetchServiceRequest(relayUrl, token, id).then(
          (request) => {
            if (!stopped) setRequests((current) => new Map([...current, [id, request]]));
          },
          () => undefined,
        );
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [relayUrl, token, unsettled]);

  const ask = useCallback(
    (type: QrServiceRequestType) => {
      setBusy(type);
      setFailed(false);
      raiseServiceRequest(relayUrl, token, browserId(), type, newUuid()).then(
        ({ request }) => {
          setBusy(undefined);
          setRequests((current) => new Map([...current, [request.id, request]]));
          stored.set([request.id, ...stored.get().filter((id) => id !== request.id)].slice(0, 10));
        },
        () => {
          setBusy(undefined);
          setFailed(true);
        },
      );
    },
    [relayUrl, token, stored],
  );

  const latest = useCallback(
    (type: QrServiceRequestType) =>
      ids.map((id) => requests.get(id)).find((request) => request?.type === type),
    [ids, requests],
  );
  const open = useCallback(
    (type: QrServiceRequestType) => {
      const request = latest(type);
      return request !== undefined && !SETTLED.has(request.status);
    },
    [latest],
  );
  return { latest, open, ask, busy, failed };
}
