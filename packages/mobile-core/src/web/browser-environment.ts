import type { WebAlertEnvironment } from './web-alerts.js';

/** What the service worker posts when a notification is tapped while the page runs. */
export const OPEN_TABLE_MESSAGE = 'rp-open-table';
/** The query parameter the service worker opens the page with when no page was running. */
export const TABLE_PARAMETER = 'table';

/* Browser glue for the phone web app (P9-28). Every API here is optional in some browser, so each
   is looked up and its absence is not an error: the app then does without it. It runs only in a
   browser and is covered by the phone web e2e (apps/waiter-app/e2e), not by unit tests. */

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface NavigatorWithExtras {
  readonly serviceWorker?: ServiceWorkerContainer;
  readonly wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
  vibrate?(pattern: number[]): boolean;
}

function navigatorOf(): NavigatorWithExtras | undefined {
  return globalThis.navigator;
}

function notificationApi(): typeof Notification | undefined {
  return (globalThis as { Notification?: typeof Notification }).Notification;
}

/** The Trusted Types policy the phone page's CSP names for its one script URL (SEC-017). */
export const WORKER_POLICY = 'rp-phone-worker';

interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL(url: string): string },
  ): { createScriptURL(url: string): unknown };
}

/**
 * The service worker's URL as Trusted Types require (`require-trusted-types-for 'script'`): a
 * policy that lets through this one URL and nothing else. Browsers without Trusted Types take the
 * string.
 */
function workerScriptUrl(serviceWorkerUrl: string): unknown {
  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (trustedTypes === undefined) return serviceWorkerUrl;
  const policy = trustedTypes.createPolicy(WORKER_POLICY, {
    createScriptURL: (url) => {
      if (url !== serviceWorkerUrl) throw new TypeError(`Not the app's service worker: ${url}`);
      return url;
    },
  });
  return policy.createScriptURL(serviceWorkerUrl);
}

/** The service worker's notifications, or undefined where the browser cannot show any. */
function serviceWorkerNotifications(
  serviceWorkerUrl: string,
  scope: string,
): WebAlertEnvironment['notifications'] {
  const api = notificationApi();
  const container = navigatorOf()?.serviceWorker;
  if (api === undefined || container === undefined) return undefined;
  // Registered once; a page whose certificate the phone does not trust cannot register one.
  const registration = container
    .register(workerScriptUrl(serviceWorkerUrl) as string, { scope })
    .catch(() => undefined);
  const ready = async (): Promise<ServiceWorkerRegistration | undefined> => {
    if ((await registration) === undefined) return undefined;
    return container.ready;
  };
  return {
    state: () => api.permission,
    request: async () => await api.requestPermission(),
    show: async (id, title, body, tableSessionId) => {
      const worker = await ready();
      await worker?.showNotification(title, {
        body,
        tag: id,
        data: { tableSessionId },
        icon: `${scope}icon-192.png`,
        badge: `${scope}icon-192.png`,
        requireInteraction: true,
      });
    },
    close: async (id) => {
      const worker = await ready();
      for (const shown of (await worker?.getNotifications({ tag: id })) ?? []) shown.close();
    },
    onOpen: (listener) => {
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; tableSessionId?: unknown } | null;
        if (data?.type === OPEN_TABLE_MESSAGE && typeof data.tableSessionId === 'string') {
          listener(data.tableSessionId);
        }
      };
      container.addEventListener('message', onMessage);
      return () => {
        container.removeEventListener('message', onMessage);
      };
    },
  };
}

/** A two-note chime from WebAudio, unlocked by the person's first touch (browsers' rule). */
function chime(): (() => void) | undefined {
  const AudioContextClass = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (AudioContextClass === undefined) return undefined;
  let context: AudioContext | undefined;
  const unlock = () => {
    context ??= new AudioContextClass();
    void context.resume().catch(() => undefined);
  };
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    globalThis.addEventListener(type, unlock, { passive: true });
  }
  return () => {
    if (context?.state !== 'running') return;
    const start = context.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.18, 1320],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.17);
    }
  };
}

/** Screen Wake Lock, taken again whenever the page comes back (browsers drop it when hidden). */
function wakeLock(): WebAlertEnvironment['keepAwake'] {
  const api = navigatorOf()?.wakeLock;
  if (api === undefined) return undefined;
  let wanted = false;
  let held: WakeLockSentinelLike | undefined;
  // Read again after the await: signing out may have come in between.
  const stillWanted = () => wanted;
  const take = async () => {
    if (!wanted || held !== undefined || globalThis.document.visibilityState !== 'visible') return;
    try {
      const sentinel = await api.request('screen');
      if (stillWanted()) held = sentinel;
      else await sentinel.release();
      (sentinel as unknown as EventTarget).addEventListener('release', () => {
        if (held === sentinel) held = undefined;
      });
    } catch {
      // Low battery or a browser that refuses: the screen goes off as usual.
    }
  };
  globalThis.document.addEventListener('visibilitychange', () => {
    void take();
  });
  return async (on) => {
    wanted = on;
    if (on) {
      await take();
      return;
    }
    const sentinel = held;
    held = undefined;
    await sentinel?.release();
  };
}

/**
 * The real browser's alert environment: notifications through the service worker at
 * `serviceWorkerUrl` (scope `scope`, the app's path with a trailing slash), a chime, vibration,
 * Screen Wake Lock and the table a tapped notification opened the page with.
 */
export function browserAlertEnvironment(options: {
  readonly serviceWorkerUrl: string;
  readonly scope: string;
}): WebAlertEnvironment {
  const navigator = navigatorOf();
  const notifications = serviceWorkerNotifications(options.serviceWorkerUrl, options.scope);
  const ring = chime();
  const keepAwake = wakeLock();
  return {
    ...(notifications !== undefined && { notifications }),
    ...(ring !== undefined && { ring }),
    ...(typeof navigator?.vibrate === 'function' && {
      vibrate: (pattern: readonly number[]) => {
        navigator.vibrate?.([...pattern]);
      },
    }),
    ...(keepAwake !== undefined && { keepAwake }),
    visible: () => globalThis.document.visibilityState === 'visible',
    launchedTable: () => {
      const url = new URL(globalThis.location.href);
      const table = url.searchParams.get(TABLE_PARAMETER);
      if (table === null) return null;
      // Once: a reload does not open the table again.
      url.searchParams.delete(TABLE_PARAMETER);
      globalThis.history.replaceState(null, '', url.toString());
      return table;
    },
  };
}
