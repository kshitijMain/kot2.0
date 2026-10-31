import {
  BROWSER_ID_HEADER,
  DINER_PHONE_HEADER,
  QrTableOrdersResponse,
  QrMenuResponse,
  QrOrderView,
  QrServiceRequestResponse,
  type QrServiceRequestType,
  QrServiceRequestView,
  QrSubmitOrderResponse,
  type QrSubmitOrderRequest,
  QrTableBillResponse,
  TABLE_TOKEN_HEADER,
} from '@rp/contracts/relay';
import { ApiError } from '@rp/contracts';

/**
 * The QR relay's functions as the site calls them (P5-02a): the table's token in a header,
 * answers checked against the contracts. Used on the server for the first menu and in the
 * browser after that.
 */

export class RelayCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

/**
 * A relay behind ngrok's free plan (a pilot, ADR-0024) answers a browser's request with ngrok's own
 * warning page, not the relay, unless the request carries this header (P9-16): the order's status,
 * My orders and the bill then never came. Sent only to such an address.
 */
export function throughNgrok(url: string): Record<string, string> {
  return /\.ngrok(-free)?\.(app|dev|io)$/.test(new URL(url).hostname)
    ? { 'ngrok-skip-browser-warning': '1' }
    : {};
}

async function call<T>(url: string, init: RequestInit, parse: (body: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...throughNgrok(url), ...(init.headers as Record<string, string> | undefined) },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new RelayCallError(0, 'NETWORK', 'The relay could not be reached');
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = ApiError.safeParse(body);
    throw error.success
      ? new RelayCallError(response.status, error.data.code, error.data.message, error.data.details)
      : new RelayCallError(
          response.status,
          'RELAY_ERROR',
          `The relay answered ${String(response.status)}`,
        );
  }
  return parse(body);
}

export function fetchMenu(
  relayUrl: string,
  token: string,
  known?: number,
): Promise<QrMenuResponse> {
  const query = known === undefined ? '' : `?known=${String(known)}`;
  return call(`${relayUrl}/qr-menu${query}`, { headers: { [TABLE_TOKEN_HEADER]: token } }, (body) =>
    QrMenuResponse.parse(body),
  );
}

export function submitOrder(
  relayUrl: string,
  token: string,
  browserId: string,
  order: QrSubmitOrderRequest,
): Promise<QrSubmitOrderResponse> {
  return call(
    `${relayUrl}/submit-order`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TABLE_TOKEN_HEADER]: token,
        [BROWSER_ID_HEADER]: browserId,
      },
      body: JSON.stringify(order),
    },
    (body) => QrSubmitOrderResponse.parse(body),
  );
}

export function fetchOrder(relayUrl: string, token: string, orderId: string): Promise<QrOrderView> {
  return call(
    `${relayUrl}/order-status?id=${encodeURIComponent(orderId)}`,
    { headers: { [TABLE_TOKEN_HEADER]: token } },
    (body) => QrOrderView.parse(body),
  );
}

export function raiseServiceRequest(
  relayUrl: string,
  token: string,
  browserId: string,
  type: QrServiceRequestType,
  idempotencyKey: string,
): Promise<QrServiceRequestResponse> {
  return call(
    `${relayUrl}/service-request`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TABLE_TOKEN_HEADER]: token,
        [BROWSER_ID_HEADER]: browserId,
      },
      body: JSON.stringify({ type, idempotencyKey }),
    },
    (body) => QrServiceRequestResponse.parse(body),
  );
}

export function fetchServiceRequest(
  relayUrl: string,
  token: string,
  requestId: string,
): Promise<QrServiceRequestView> {
  return call(
    `${relayUrl}/service-request?id=${encodeURIComponent(requestId)}`,
    { headers: { [TABLE_TOKEN_HEADER]: token } },
    (body) => QrServiceRequestView.parse(body),
  );
}

/** P9-03: the table's printed bill for this sitting, or none yet. */
export function fetchTableBill(relayUrl: string, token: string): Promise<QrTableBillResponse> {
  return call(`${relayUrl}/table-bill`, { headers: { [TABLE_TOKEN_HEADER]: token } }, (body) =>
    QrTableBillResponse.parse(body),
  );
}

/**
 * P9-08: the orders this mobile number placed at this table during this sitting, from any phone
 * or browser. The number goes in a header, never in the address.
 */
export function fetchTableOrders(
  relayUrl: string,
  token: string,
  phone: string,
): Promise<QrTableOrdersResponse> {
  return call(
    `${relayUrl}/table-orders`,
    { headers: { [TABLE_TOKEN_HEADER]: token, [DINER_PHONE_HEADER]: phone } },
    (body) => QrTableOrdersResponse.parse(body),
  );
}
