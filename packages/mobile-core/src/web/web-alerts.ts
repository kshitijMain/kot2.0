import type { AlertView } from '@rp/contracts';
import type { AlertHolder, AlertNotifier } from '../alert-center.js';

/** Whether the browser may show notifications; `unsupported` where it has none at all. */
export type WebNotificationState = 'granted' | 'denied' | 'default' | 'unsupported';

/** What a browser offers for alerts (P9-28); `browserAlertEnvironment` builds the real one. */
export interface WebAlertEnvironment {
  /**
   * System notifications through the service worker. Absent where the browser has none: an
   * iPhone shows them only for a page added to the Home Screen (iOS 16.4 and later).
   */
  readonly notifications?: {
    state(): WebNotificationState;
    /** Asks the person; browsers only ask in answer to a tap. */
    request(): Promise<WebNotificationState>;
    show(id: string, title: string, body: string, tableSessionId: string | null): Promise<void>;
    close(id: string): Promise<void>;
    /** Calls `listener` with the table of each notification tapped while the page runs. */
    onOpen(listener: (tableSessionId: string) => void): () => void;
  };
  /** A short tone; quiet until the person has touched the page once (browsers' rule). */
  ring?(): void;
  /** Android's Chrome vibrates; an iPhone's browsers never do. */
  vibrate?(pattern: readonly number[]): void;
  /** Whether the page is on screen. */
  visible(): boolean;
  /**
   * Keeps the screen on while someone is signed in (Screen Wake Lock): a page whose screen went
   * off stops hearing the PC, so alerts would wait until it is opened again.
   */
  keepAwake?(on: boolean): Promise<void>;
  /** The table whose notification opened this page, once; null otherwise. */
  launchedTable?(): string | null;
}

/** The words of an alert's notification: what the banner says (NFR-L02). */
export interface WebAlertText {
  alert(alert: AlertView): { title: string; text: string };
}

/** Two short pulses, like the pager's. */
const VIBRATION: readonly number[] = [200, 100, 200];

/**
 * The phone web app's alerts besides its screen (P9-28, WTR-005 as far as a browser can): each
 * alert rings and vibrates, and shows as a system notification when the page is not on screen
 * and notifications are allowed; tapping one opens its table. It also serves the app's
 * notification hint: browsers ask only in answer to a tap, so asking waits for "Turn on".
 */
export class WebAlertNotifier implements AlertNotifier {
  private listening = false;
  private readonly shown = new Set<string>();
  private launched: string | null | undefined;

  constructor(
    private readonly text: WebAlertText,
    private readonly environment: WebAlertEnvironment,
  ) {}

  async start(_holder: AlertHolder): Promise<void> {
    this.listening = true;
    await this.environment.keepAwake?.(true).catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.listening = false;
    await this.environment.keepAwake?.(false).catch(() => undefined);
    const shown = [...this.shown];
    this.shown.clear();
    await Promise.all(shown.map((id) => this.close(id)));
  }

  async announce(alert: AlertView): Promise<void> {
    if (!this.listening) return;
    this.environment.ring?.();
    this.environment.vibrate?.(VIBRATION);
    const notifications = this.environment.notifications;
    if (notifications?.state() !== 'granted' || this.environment.visible()) return;
    const { title, text } = this.text.alert(alert);
    await notifications.show(alert.id, title, text, alert.tableSessionId);
    this.shown.add(alert.id);
  }

  async dismiss(alertId: string): Promise<void> {
    if (!this.shown.delete(alertId)) return;
    await this.close(alertId);
  }

  /** Whether notifications can show; throws where the browser has none, so no hint shows. */
  enabled(): Promise<boolean> {
    const state = this.environment.notifications?.state() ?? 'unsupported';
    if (state === 'unsupported') {
      return Promise.reject(new Error('This browser shows no notifications'));
    }
    return Promise.resolve(state === 'granted');
  }

  /** At sign-in: never asks (no tap to answer), only says whether they can show. */
  request(): Promise<boolean> {
    return this.enabled();
  }

  /** "Turn on": the tap lets the browser ask. A person who said no turns them on in its settings. */
  async openSettings(): Promise<void> {
    await this.environment.notifications?.request();
  }

  onOpenTable(listener: (tableSessionId: string) => void): () => void {
    return this.environment.notifications?.onOpen(listener) ?? (() => undefined);
  }

  takeOpenedTable(): Promise<string | null> {
    if (this.launched === undefined) {
      this.launched = this.environment.launchedTable?.() ?? null;
      return Promise.resolve(this.launched);
    }
    return Promise.resolve(null);
  }

  private async close(alertId: string): Promise<void> {
    await this.environment.notifications?.close(alertId).catch(() => undefined);
  }
}
