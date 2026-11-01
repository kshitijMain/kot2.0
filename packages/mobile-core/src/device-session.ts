import type {
  ApiClient,
  ConnectionStatus,
  DeviceKey,
  RealtimeConnection,
  RealtimeConnectionOptions,
  ResumePoint,
  TypedApi,
} from '@rp/api-client';
import type { DeviceSummary, DomainEvent, LoginResponse, StaffTile } from '@rp/contracts';
import { AlertCenter, type AlertNotifier } from './alert-center.js';
import { createMobileClient, CREDENTIALS_KEY, loadCredentials } from './client.js';
import {
  DISCOVERY_TIMEOUT_MS,
  discoveredUrls,
  type LanDiscovery,
  type WifiRoute,
} from './lan-discovery.js';
import { MenuCache } from './menu-cache.js';
import { OrderOutbox } from './order-outbox.js';
import { InvalidServerAddressError, normalizeServerUrl } from './server-url.js';
import {
  findServer,
  type FoundServer,
  type PairingTarget,
  type ServerAuthority,
  ServerMismatchError,
  type ServerTrust,
  ServerUnreachableError,
  UnverifiedServerError,
} from './server-trust.js';
import { type KeyValueStore, readJson } from './storage.js';

/** Where the device key lives: the Android Keystore in the apps, a fake in tests. */
export interface DeviceKeyStore {
  load(): Promise<DeviceKey | undefined>;
  create(): Promise<DeviceKey>;
  remove(): Promise<void>;
}

/** A message for the next screen, e.g. why the person is back on the login screen. */
export type SessionNotice = 'signedOutInactive' | 'signedOut' | 'revoked';

export interface DeviceSessionSnapshot {
  /** `loading` while the stored device is checked; `unpaired` shows the pairing screen. */
  readonly phase: 'loading' | 'unpaired' | 'paired';
  readonly serverUrl: string | undefined;
  readonly device: DeviceSummary | undefined;
  readonly person: LoginResponse['staff'] | undefined;
  readonly session: LoginResponse['session'] | undefined;
  readonly connection: ConnectionStatus;
  readonly notice: SessionNotice | undefined;
  /**
   * The server no longer serves this build of the app (UPD-006, 426 `CLIENT_TOO_OLD`): nothing
   * works until it is updated, so the app says so instead of failing screen by screen.
   */
  readonly clientTooOld: boolean;
  /**
   * The phone is on a Wi-Fi without internet (P9-27): the app talks to the PC over it while the
   * rest of the phone needs mobile data, so the connect screen says to keep both on.
   */
  readonly wifiWithoutInternet: boolean;
}

export interface DeviceSessionOptions {
  /** The Keystore-backed store: device token and the person's tokens. */
  readonly secureStore: KeyValueStore;
  /** AsyncStorage: the server address and the live-update resume point (not secret). */
  readonly plainStore: KeyValueStore;
  readonly keys: DeviceKeyStore;
  /**
   * The LAN CA pinning of the device's HTTP clients (ADR-0011): the Android module in the apps.
   * Without it (tests, development tools) nothing is pinned.
   */
  readonly trust?: ServerTrust;
  /**
   * Follow the alerts of the person the phone alerts (P2-06a, WTR-006): the waiter app. Other
   * apps leave it off and never read alerts.
   */
  readonly followAlerts?: boolean;
  /** Where followed alerts go besides the screen: Android notifications (P2-06b). */
  readonly alertNotifier?: AlertNotifier;
  /** Which app this is, sent with its version on every request (UPD-006). */
  readonly appKind?: 'waiter-app' | 'table-tablet';
  readonly appVersion?: string;
  readonly fetch?: typeof fetch;
  /** Socket.io's `io`; tests pass a fake. */
  readonly connect?: RealtimeConnectionOptions['connect'];
  /** Where background failures (saving to storage) are reported. */
  readonly onError?: (error: unknown) => void;
  /** The time, for how long the person has been idle; tests pass a fake. */
  readonly now?: () => number;
  /**
   * Finding the restaurant PC on the Wi-Fi by mDNS (P9-27): the Android module in the apps. Without
   * it the device only knows the addresses it remembers, scans or was built with.
   */
  readonly discovery?: LanDiscovery;
  /** The app's route over a Wi-Fi without internet (P9-27): the Android module in the apps. */
  readonly wifi?: WifiRoute;
  /** How long the PC may stay unreachable before the device looks for it elsewhere; 15 s. */
  readonly relocateAfterMs?: number;
  /** How long mDNS discovery listens for the PC; 4 s. */
  readonly discoveryTimeoutMs?: number;
}

/**
 * Where the device may find the restaurant PC besides the address it remembers and mDNS (P9-27):
 * the Connect QR code a person scanned, then the addresses the app was built with.
 */
export interface ConnectTargets {
  /** From the Connect QR code (`ConnectQrPayload`): its addresses and the PC's CA fingerprint. */
  readonly scanned?: PairingTarget;
  /** Built into the app (`extra.restaurantServers`, pilot builds), or typed: the last fallback. */
  readonly builtIn?: PairingTarget;
}

const SERVER_KEY = 'rp.server.v1';
const RESUME_KEY = 'rp.resume.v1';
/** The fingerprint of the CA pinned for the PC, so a PC at a new address can be recognised. */
const SERVER_CA_KEY = 'rp.server-ca.v1';
const RELOCATE_AFTER_MS = 15_000;

const INITIAL: DeviceSessionSnapshot = {
  phase: 'loading',
  serverUrl: undefined,
  device: undefined,
  person: undefined,
  session: undefined,
  connection: 'stopped',
  notice: undefined,
  clientTooOld: false,
  wifiWithoutInternet: false,
};

/**
 * The phone's or tablet's link to the local server, outside React so it can be tested on its own
 * (AUTH-005, AUTH-007, AUTH-008): pairing with a Keystore key, signing staff in and out, the live
 * connection with resume, and what happens when the server ends the session or unpairs the device.
 * It also keeps the menu on the device current (MENU-013, MENU-006), sends unsent orders when
 * the connection comes back (WTR-012) and, on a waiter phone, follows the alerts of the person it
 * alerts (P2-06a). Screens read `getSnapshot()` through `useSyncExternalStore` and call the
 * actions.
 */
export class DeviceSession {
  /** The published menu on the device, fetched again on reconnect and when a new one is out. */
  readonly menu: MenuCache;
  /** Orders on their way to the kitchen; sent again on every reconnect. */
  readonly orders: OrderOutbox;
  /** The alerts of the person the phone alerts, when `followAlerts` is on (P2-06a). */
  readonly alerts: AlertCenter;
  private snapshot: DeviceSessionSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: DomainEvent) => void>();
  private client: ApiClient | undefined;
  private connection: RealtimeConnection | undefined;
  /** Bumped whenever the client is replaced, so late callbacks of an old client are ignored. */
  private generation = 0;
  /** When the person last touched the app (MOBILE-E3); the app's start until then. */
  private touchedAt: number;
  /** Looking for the PC at a new address after it stopped answering (P9-27). */
  private relocateTimer: ReturnType<typeof setTimeout> | undefined;
  private relocating = false;

  constructor(private readonly options: DeviceSessionOptions) {
    this.touchedAt = this.now();
    const wifi = options.wifi;
    if (wifi !== undefined) {
      this.snapshot = { ...INITIAL, wifiWithoutInternet: wifi.wifiWithoutInternet() };
      wifi.subscribe(() => {
        const wifiWithoutInternet = wifi.wifiWithoutInternet();
        if (wifiWithoutInternet !== this.snapshot.wifiWithoutInternet) {
          this.update({ wifiWithoutInternet });
        }
      });
    }
    this.menu = new MenuCache(options.plainStore);
    this.orders = new OrderOutbox({
      store: options.plainStore,
      api: () => this.api,
      staffId: () => this.snapshot.person?.id ?? null,
    });
    this.alerts = new AlertCenter({
      api: () => this.api,
      ...(options.alertNotifier !== undefined && { notifier: options.alertNotifier }),
      ...(options.onError !== undefined && { onError: options.onError }),
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): DeviceSessionSnapshot => this.snapshot;

  /** The typed REST API with this device's and person's credentials, for the screens. */
  get api(): TypedApi {
    if (this.client === undefined) throw new Error('The device is not paired');
    return this.client.api;
  }

  /**
   * The address and this device's credentials for a download Android's own HTTP client makes,
   * e.g. the app's new APK from the PC (P7-04e2).
   */
  async downloadRequest(
    operationId: 'downloadCurrentAppBuild',
  ): Promise<{ readonly url: string; headers: Record<string, string> }> {
    return this.requireClient().authorizedRequest(operationId);
  }

  /** Loads the stored device and session and checks them with the server. */
  async start(): Promise<void> {
    const serverUrl = (await this.options.plainStore.getItem(SERVER_KEY)) ?? undefined;
    const key = await this.options.keys.load();
    const credentials = await loadCredentials(this.options.secureStore);
    if (serverUrl === undefined || key === undefined || credentials?.device === undefined) {
      await this.routeTo(serverUrl === undefined ? [] : [serverUrl]);
      this.update({ phase: 'unpaired' });
      return;
    }
    // On a Wi-Fi without internet, the app's traffic goes over it while the PC answers there.
    await this.routeTo([serverUrl]);
    const generation = await this.replaceClient(serverUrl, key);
    const client = this.requireClient();
    let device: DeviceSummary | undefined;
    let person = client.session?.staff;
    let session = client.session?.session;
    try {
      device = await client.api.getCurrentDevice();
      if (client.session !== undefined) {
        const described = await client.api.getCurrentSession();
        person = described.staff;
        session = described.session;
      }
    } catch (error) {
      if (generation !== this.generation) return; // Unpaired while away: already handled.
      if (client.session === undefined) {
        person = undefined;
        session = undefined;
      }
      // Otherwise the server is unreachable: carry on with what was stored; the banner says so.
      this.options.onError?.(error);
    }
    if (generation !== this.generation) return;
    this.update({ phase: 'paired', serverUrl, device, person, session });
    this.connect(await this.loadResume());
  }

  /**
   * Finds the server to pair with among the addresses typed or scanned, checking a TLS server's CA
   * against the QR code's fingerprint (ADR-0011). Pass the result to `pair`.
   */
  findServer(target: PairingTarget): Promise<FoundServer> {
    return findServer(target, {
      ...(this.options.trust !== undefined && { trust: this.options.trust }),
      ...(this.options.fetch !== undefined && { fetch: this.options.fetch }),
    });
  }

  /**
   * Pairs with a manager's code (AUTH-007): a new Keystore key, then the server's device token.
   * Over TLS, the server's CA is pinned first (`authority`, from `findServer`), so the code only
   * ever travels to the server that CA vouches for (ADR-0011, SEC-010).
   */
  async pair(serverAddress: string, code: string, authority?: ServerAuthority): Promise<void> {
    const serverUrl = normalizeServerUrl(serverAddress);
    await this.trustServer(serverUrl, authority);
    const key = await this.newKey(serverUrl);
    await this.completePairing(serverUrl, key, code, authority);
  }

  /**
   * The waiter app connects by itself, with nobody pairing it (ADR-0025, Business Owner
   * 2026-11-01): it finds the restaurant PC (`locate`), pins its certificate (checked against the
   * Connect QR's or the built-in fingerprint, else trusted on first use, on the restaurant's
   * Wi-Fi), asks the PC for a waiter phone's code and pairs with a new Keystore key. The PC
   * answers only where it runs PIN-only, and the PIN is what lets anyone in.
   */
  async connectByItself(targets: ConnectTargets = {}): Promise<void> {
    const found = await this.locate(targets);
    await this.trustServer(found.serverUrl, found.authority);
    const key = await this.newKey(found.serverUrl);
    const { code } = await this.requireClient().api.createPhonePairingCode();
    await this.completePairing(found.serverUrl, key, code, found.authority);
  }

  /**
   * Finds the restaurant PC with no address built into the app (P9-27, AUTH-007, NFR-A01), in
   * this order: the address that worked last, the PCs that answer mDNS on the Wi-Fi, the Connect
   * QR code's addresses, then those the app was built with. Every PC over TLS must present the CA
   * the QR code (or the build) names; mDNS answers that announce another CA are not even tried.
   * Discovery listens while the remembered address is tried, so a PC that moved costs no extra wait.
   */
  async locate(targets: ConnectTargets = {}): Promise<FoundServer> {
    const { scanned, builtIn } = targets;
    const expected = scanned?.caSha256 ?? builtIn?.caSha256;
    const remembered = await this.options.plainStore.getItem(SERVER_KEY);
    const discovered = this.discoverUrls(expected);
    const stages: (() => Promise<readonly string[]>)[] = [
      () => Promise.resolve(remembered === null ? [] : [remembered]),
      () => discovered,
      () => Promise.resolve(scanned?.servers ?? []),
      () => Promise.resolve(builtIn?.servers ?? []),
    ];
    const tried = new Set<string>();
    let invalid = false;
    let mismatch = false;
    for (const stage of stages) {
      const urls: string[] = [];
      for (const given of await stage()) {
        let url: string;
        try {
          url = normalizeServerUrl(given);
        } catch {
          invalid = true;
          continue;
        }
        if (tried.has(url)) continue;
        tried.add(url);
        urls.push(url);
      }
      if (urls.length === 0) continue;
      await this.routeTo(urls);
      try {
        return await this.findServer({
          servers: urls,
          ...(expected !== undefined && { caSha256: expected }),
        });
      } catch (error) {
        if (error instanceof ServerMismatchError) mismatch = true;
        else if (error instanceof InvalidServerAddressError) invalid = true;
      }
    }
    if (mismatch) throw new ServerMismatchError();
    if (tried.size === 0 && invalid) throw new InvalidServerAddressError();
    throw new ServerUnreachableError([...tried]);
  }

  /** A new Keystore key, and a client for `serverUrl` that signs with it. */
  private async newKey(serverUrl: string): Promise<DeviceKey> {
    const key = await this.options.keys.create();
    await this.options.secureStore.removeItem(CREDENTIALS_KEY);
    await this.replaceClient(serverUrl, key);
    return key;
  }

  /** Pairs with `code` (AUTH-007) and starts working with the server. */
  private async completePairing(
    serverUrl: string,
    key: DeviceKey,
    code: string,
    authority?: ServerAuthority,
  ): Promise<void> {
    const client = this.requireClient();
    await client.pair({
      code: code.trim().toUpperCase(),
      key,
      ...(this.options.appVersion !== undefined && { appVersion: this.options.appVersion }),
    });
    const device = await client.api.getCurrentDevice();
    await this.options.plainStore.setItem(SERVER_KEY, serverUrl);
    // The PC's CA, to recognise it when the router gives it a new address (P9-27).
    if (authority !== undefined && serverUrl.startsWith('https:')) {
      await this.options.plainStore.setItem(SERVER_CA_KEY, authority.sha256);
    } else {
      await this.options.plainStore.removeItem(SERVER_CA_KEY);
    }
    await this.options.plainStore.removeItem(RESUME_KEY);
    // Another restaurant's menu and alerts are no use here.
    await this.menu.clear();
    this.alerts.reset();
    this.update({
      phase: 'paired',
      serverUrl,
      device,
      person: undefined,
      session: undefined,
      notice: undefined,
    });
    this.connect(undefined);
  }

  async staffTiles(): Promise<StaffTile[]> {
    return (await this.api.listStaffTiles()).staff;
  }

  /** Signs a person in with their PIN (AUTH-001, AUTH-004). */
  async signIn(staffId: string, pin: string): Promise<void> {
    this.touched();
    const login = await this.requireClient().signInWithPin({ staffId, pin });
    this.update({ person: login.staff, session: login.session, notice: undefined });
    // The person's role decides which rooms the connection joins.
    this.connect(undefined);
  }

  /**
   * Signs the person out on the server. On a waiter phone this also ends its alerts for them
   * (P2-06a); a sign-out for inactivity is the server's and keeps them, so never call this for it.
   */
  async signOut(notice?: SessionNotice): Promise<void> {
    await this.requireClient().signOut();
    this.update({ person: undefined, session: undefined, notice });
    this.connect(undefined);
  }

  /**
   * The person touched the screen (AUTH-005, MOBILE-E3). Their session lasts the inactivity time
   * from their last touch, however often the app reads by itself.
   */
  touched(): void {
    this.touchedAt = this.now();
  }

  /** Tells the server the person is still here (AUTH-005 inactivity). */
  async keepAlive(): Promise<void> {
    if (this.client?.session === undefined) return;
    this.touched();
    try {
      await this.client.api.getCurrentSession();
    } catch {
      // A session that ended is reported through `onSessionEnded`; offline is shown by the banner.
    }
  }

  /** Domain events from the live connection, for screens that show live data. */
  onEvent(listener: (event: DomainEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  dismissNotice(): void {
    if (this.snapshot.notice !== undefined) this.update({ notice: undefined });
  }

  stop(): void {
    this.cancelRelocate();
    this.connection?.stop();
    this.connection = undefined;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Pins the server's CA before anything is sent to it; nothing to pin without TLS. */
  private async trustServer(
    serverUrl: string,
    authority: ServerAuthority | undefined,
  ): Promise<void> {
    const trust = this.options.trust;
    if (trust === undefined || !serverUrl.startsWith('https:')) return;
    if (authority === undefined) throw new UnverifiedServerError();
    const pinned = await trust.pin(authority.certificate, serverUrl);
    if (pinned !== authority.sha256) {
      await trust.clear();
      throw new ServerMismatchError();
    }
  }

  private requireClient(): ApiClient {
    if (this.client === undefined) throw new Error('The device is not paired');
    return this.client;
  }

  private async replaceClient(serverUrl: string, key: DeviceKey): Promise<number> {
    this.stop();
    this.generation += 1;
    const generation = this.generation;
    this.client = await createMobileClient({
      baseUrl: serverUrl,
      secureStore: this.options.secureStore,
      signer: key,
      ...(this.options.fetch !== undefined && { fetch: this.options.fetch }),
      onSessionEnded: (code) => {
        if (generation === this.generation) this.sessionEnded(code);
      },
      onDeviceRevoked: () => {
        if (generation === this.generation) void this.forget();
      },
      ...(this.options.appKind !== undefined &&
        this.options.appVersion !== undefined && {
          client: { kind: this.options.appKind, version: this.options.appVersion },
        }),
      // The server counts the person active as of their last touch, so the reads the app makes
      // by itself (the pager card, live lists) never keep an idle session alive (MOBILE-E3).
      idleSeconds: () => (this.now() - this.touchedAt) / 1000,
      onClientTooOld: () => {
        if (generation !== this.generation || this.snapshot.clientTooOld) return;
        this.stop();
        this.update({ clientTooOld: true, connection: 'stopped' });
      },
    });
    return generation;
  }

  private sessionEnded(code: string): void {
    if (this.snapshot.person === undefined) return;
    this.update({
      person: undefined,
      session: undefined,
      notice: code === 'SESSION_EXPIRED' ? 'signedOutInactive' : 'signedOut',
    });
    this.connect(undefined);
  }

  /** The server no longer knows this device: drop its key and credentials (AUTH-008). */
  private async forget(): Promise<void> {
    this.stop();
    this.generation += 1;
    this.client = undefined;
    this.update({
      phase: 'unpaired',
      device: undefined,
      person: undefined,
      session: undefined,
      connection: 'stopped',
      notice: 'revoked',
    });
    this.alerts.reset();
    try {
      await this.options.keys.remove();
      await this.options.plainStore.removeItem(RESUME_KEY);
      await this.options.plainStore.removeItem(SERVER_CA_KEY);
      await this.options.trust?.clear();
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private loadResume(): Promise<ResumePoint | undefined> {
    return readJson(this.options.plainStore, RESUME_KEY, (value) => {
      if (typeof value !== 'object' || value === null) throw new TypeError('Not a resume point');
      return value as ResumePoint;
    }).then((point) => point ?? undefined);
  }

  private saveResume(point: ResumePoint | undefined): void {
    const store = this.options.plainStore;
    (point === undefined
      ? store.removeItem(RESUME_KEY)
      : store.setItem(RESUME_KEY, JSON.stringify(point))
    ).catch((error: unknown) => this.options.onError?.(error));
  }

  private connect(resume: ResumePoint | undefined): void {
    this.connection?.stop();
    if (resume === undefined) this.saveResume(undefined);
    const connection = this.requireClient().connectRealtime({
      ...(resume !== undefined && { resume }),
      ...(this.options.connect !== undefined && { connect: this.options.connect }),
      onEvent: (event) => {
        this.keepMenuCurrent(event);
        if (this.options.followAlerts === true) this.alerts.handleEvent(event);
        for (const listener of this.eventListeners) listener(event);
      },
      onStatus: (status) => {
        if (this.connection !== connection) return;
        const cameOnline = status === 'online' && this.snapshot.connection !== 'online';
        this.update({ connection: status });
        // The PC stopped answering: it may be at a new address (P9-27).
        if (status === 'online' || status === 'stopped') this.cancelRelocate();
        else this.scheduleRelocate();
        if (cameOnline) {
          this.refreshMenu({ force: true });
          this.orders.flush().catch((error: unknown) => this.options.onError?.(error));
          // Alerts missed while away are read again (NTF-006); so is a change of holder.
          if (this.options.followAlerts === true) void this.alerts.refresh();
        }
      },
      onResumePoint: (point) => {
        this.saveResume(point);
      },
    });
    this.connection = connection;
    connection.start();
  }

  /** The PC's addresses that answer mDNS with the CA `expected` (any CA when undefined). */
  private async discoverUrls(expected: string | undefined): Promise<string[]> {
    const discovery = this.options.discovery;
    if (discovery === undefined) return [];
    try {
      const services = await discovery.discover(
        this.options.discoveryTimeoutMs ?? DISCOVERY_TIMEOUT_MS,
      );
      return discoveredUrls(services, expected);
    } catch (error) {
      this.options.onError?.(error);
      return [];
    }
  }

  /** On a Wi-Fi without internet, routes the app over it when the PC answers there (P9-27). */
  private async routeTo(serverUrls: readonly string[]): Promise<void> {
    try {
      await this.options.wifi?.routeTo(serverUrls);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private scheduleRelocate(): void {
    if (this.options.discovery === undefined || this.relocateTimer !== undefined) return;
    this.relocateTimer = setTimeout(() => {
      this.relocateTimer = undefined;
      void this.relocate();
    }, this.options.relocateAfterMs ?? RELOCATE_AFTER_MS);
  }

  private cancelRelocate(): void {
    if (this.relocateTimer === undefined) return;
    clearTimeout(this.relocateTimer);
    this.relocateTimer = undefined;
  }

  /**
   * The PC has not answered for a while (P9-27): the router may have given it a new address. The
   * device asks mDNS again and, when the PC with the same CA answers elsewhere, pins that CA for
   * the new address, remembers it and reconnects there, with its device key and the person's
   * session as they were. Nothing changes when another CA answers, or when the old address comes
   * back first. A PC over TLS whose CA the device does not know is never followed.
   */
  private async relocate(): Promise<void> {
    if (this.relocating) return;
    this.relocating = true;
    try {
      const current = this.snapshot.serverUrl;
      if (this.snapshot.phase !== 'paired' || current === undefined) return;
      const generation = this.generation;
      const expected = await this.pinnedFingerprint();
      if (expected === undefined && current.startsWith('https:')) return;
      const urls = (await this.discoverUrls(expected)).filter((url) => url !== current);
      if (urls.length === 0) return;
      await this.routeTo(urls);
      let found: FoundServer;
      try {
        found = await this.findServer({
          servers: urls,
          ...(expected !== undefined && { caSha256: expected }),
        });
      } catch {
        return; // Nothing usable answered; the next attempt asks again.
      }
      const key = await this.options.keys.load();
      if (
        key === undefined ||
        generation !== this.generation ||
        this.snapshot.connection === 'online'
      ) {
        return;
      }
      await this.trustServer(found.serverUrl, found.authority);
      await this.options.plainStore.setItem(SERVER_KEY, found.serverUrl);
      await this.replaceClient(found.serverUrl, key);
      this.update({ serverUrl: found.serverUrl });
      this.connect(await this.loadResume());
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.relocating = false;
      // Still lost: look again after a while.
      if (this.snapshot.phase === 'paired' && this.snapshot.connection !== 'online') {
        if (this.connection !== undefined) this.scheduleRelocate();
      }
    }
  }

  /** The fingerprint of the CA the device trusts for its PC, if it knows one. */
  private async pinnedFingerprint(): Promise<string | undefined> {
    const stored = await this.options.plainStore.getItem(SERVER_CA_KEY);
    if (stored !== null && stored !== '') return stored;
    // Paired before the fingerprint was remembered: ask the trust module.
    return (await this.options.trust?.pinnedFingerprint?.()) ?? undefined;
  }

  /** A newer menu is fetched; availability changes apply to the stored one (MENU-006). */
  private keepMenuCurrent(event: DomainEvent): void {
    if (event.type === 'MenuPublished') {
      this.refreshMenu({ announcedVersion: event.payload.menuVersion });
    } else if (event.type === 'ItemAvailabilityChanged') {
      this.menu
        .applyAvailability(event.payload)
        .catch((error: unknown) => this.options.onError?.(error));
    }
  }

  private refreshMenu(options: { announcedVersion?: number; force?: boolean }): void {
    const client = this.client;
    if (client === undefined) return;
    this.menu
      .refresh(() => client.api.getMenu(), options)
      .catch((error: unknown) => this.options.onError?.(error));
  }

  private update(changes: Partial<DeviceSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }
}
