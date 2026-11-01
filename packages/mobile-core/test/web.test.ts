import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  BrowserDatabase,
  IndexedDbStore,
  type WebAlertEnvironment,
  WebAlertNotifier,
  type WebNotificationState,
  WebCryptoDeviceKeys,
  WebStorageStore,
} from '../src/web/index.js';
import { alertView, HOLDER } from '../src/testing/index.js';

const freshDatabase = () => new BrowserDatabase('rp-phone-test', new IDBFactory());

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('[P9-28] the phone web app keeps its device in the browser', () => {
  it('[AUTH-007] keeps tokens in IndexedDB and addresses in localStorage, each under its own name', async () => {
    const database = freshDatabase();
    const secure = new IndexedDbStore(database);
    await secure.setItem('token', 'secret');
    expect(await secure.getItem('token')).toBe('secret');
    expect(await secure.getItem('missing')).toBeNull();
    // Something that is not text (the key pair) is never handed out as a token.
    await database.put('kv:odd', { not: 'text' });
    expect(await secure.getItem('odd')).toBeNull();
    await secure.removeItem('token');
    expect(await secure.getItem('token')).toBeNull();

    const storage = new FakeStorage();
    const plain = new WebStorageStore(storage);
    await plain.setItem('rp.server.v1', 'https://192.168.1.20:8080');
    expect(storage.getItem('rp-phone.rp.server.v1')).toBe('https://192.168.1.20:8080');
    expect(await plain.getItem('rp.server.v1')).toBe('https://192.168.1.20:8080');
    await plain.removeItem('rp.server.v1');
    expect(await plain.getItem('rp.server.v1')).toBeNull();
  });

  it('[SEC-006] makes a device key whose private half cannot be exported, and keeps it', async () => {
    const database = freshDatabase();
    const keys = new WebCryptoDeviceKeys(database);
    expect(await keys.load()).toBeUndefined();
    const created = await keys.create();
    expect(created.algorithm).toBe('ES256');
    const stored = (await database.get('device-key')) as CryptoKeyPair;
    expect(stored.privateKey.extractable).toBe(false);

    const loaded = await keys.load();
    expect(loaded?.publicKey).toBe(created.publicKey);
    // The loaded key signs what the public key verifies: the server will accept it.
    const signature = Uint8Array.from(atob(await (loaded?.sign('hello') ?? '')), (c) =>
      c.charCodeAt(0),
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      stored.publicKey,
      signature,
      new TextEncoder().encode('hello'),
    );
    expect(verified).toBe(true);

    await keys.remove();
    expect(await keys.load()).toBeUndefined();
  });

  it('says so when the browser has no IndexedDB, and tries again next time', async () => {
    const database = new BrowserDatabase('none', undefined);
    await expect(database.get('x')).rejects.toThrow(/IndexedDB/);
  });
});

interface Shown {
  id: string;
  title: string;
  body: string;
  table: string | null;
}

function fakeEnvironment(state: WebNotificationState = 'granted') {
  const log: string[] = [];
  const shown: Shown[] = [];
  const closed: string[] = [];
  let permission = state;
  let visible = false;
  let listener: ((table: string) => void) | undefined;
  let launched: string | null = null;
  const environment: WebAlertEnvironment = {
    notifications: {
      state: () => permission,
      request: () => {
        log.push('asked');
        permission = 'granted';
        return Promise.resolve(permission);
      },
      show: (id, title, body, table) => {
        shown.push({ id, title, body, table });
        return Promise.resolve();
      },
      close: (id) => {
        closed.push(id);
        return Promise.resolve();
      },
      onOpen: (open) => {
        listener = open;
        return () => {
          listener = undefined;
        };
      },
    },
    ring: () => log.push('ring'),
    vibrate: (pattern) => log.push(`vibrate ${pattern.join(',')}`),
    visible: () => visible,
    keepAwake: (on) => {
      log.push(on ? 'awake' : 'asleep');
      return Promise.resolve();
    },
    launchedTable: () => {
      const table = launched;
      launched = null;
      return table;
    },
  };
  return {
    environment,
    log,
    shown,
    closed,
    show: (on: boolean) => {
      visible = on;
    },
    tap: (table: string) => listener?.(table),
    launchWith: (table: string) => {
      launched = table;
    },
  };
}

const TEXT = {
  alert: (alert: { tableLabel: string | null; type: string }) => ({
    title: `Table ${alert.tableLabel ?? '?'} · ${alert.type}`,
    text: 'Dal Makhani',
  }),
};

describe('[P9-28] [WTR-005] the phone web app rings for alerts', () => {
  it('rings, vibrates and keeps the screen on while someone is signed in', async () => {
    const fake = fakeEnvironment();
    const notifier = new WebAlertNotifier(TEXT, fake.environment);
    // Nobody signed in: nothing rings.
    await notifier.announce(alertView());
    expect(fake.log).toEqual([]);

    await notifier.start(HOLDER);
    await notifier.announce(alertView());
    expect(fake.log).toEqual(['awake', 'ring', 'vibrate 200,100,200']);
    await notifier.stop();
    expect(fake.log.at(-1)).toBe('asleep');
  });

  it('shows a notification only when the page is not on screen, and takes it away when cleared', async () => {
    const fake = fakeEnvironment();
    const notifier = new WebAlertNotifier(TEXT, fake.environment);
    await notifier.start(HOLDER);
    fake.show(true);
    await notifier.announce(alertView());
    expect(fake.shown).toEqual([]);

    fake.show(false);
    const ready = alertView();
    await notifier.announce(ready);
    expect(fake.shown).toEqual([
      {
        id: ready.id,
        title: `Table ${ready.tableLabel ?? '?'} · ${ready.type}`,
        body: 'Dal Makhani',
        table: ready.tableSessionId,
      },
    ]);
    await notifier.dismiss('someone-else');
    expect(fake.closed).toEqual([]);
    await notifier.dismiss(ready.id);
    expect(fake.closed).toEqual([ready.id]);

    // Signing out takes every notification away.
    await notifier.announce(ready);
    await notifier.stop();
    expect(fake.closed).toEqual([ready.id, ready.id]);
  });

  it('never asks at sign-in, asks on "Turn on", and says nothing where there are no notifications', async () => {
    const fake = fakeEnvironment('default');
    const notifier = new WebAlertNotifier(TEXT, fake.environment);
    expect(await notifier.request()).toBe(false);
    expect(fake.log).not.toContain('asked');
    await notifier.openSettings();
    expect(fake.log).toContain('asked');
    expect(await notifier.enabled()).toBe(true);

    // An iPhone outside the Home Screen: no notifications, so no hint either.
    const bare = new WebAlertNotifier(TEXT, { visible: () => true });
    await expect(bare.enabled()).rejects.toThrow(/no notifications/);
    await bare.start(HOLDER);
    await bare.announce(alertView());
    await bare.openSettings();
    await bare.dismiss('x');
    await bare.stop();
    expect(await bare.takeOpenedTable()).toBeNull();
    expect(bare.onOpenTable(() => undefined)).toBeTypeOf('function');
  });

  it('a tapped notification opens its table, also one that opened the page', async () => {
    const fake = fakeEnvironment();
    fake.launchWith('table-session-7');
    const notifier = new WebAlertNotifier(TEXT, fake.environment);
    expect(await notifier.takeOpenedTable()).toBe('table-session-7');
    expect(await notifier.takeOpenedTable()).toBeNull();

    const opened: string[] = [];
    const stop = notifier.onOpenTable((table) => opened.push(table));
    fake.tap('table-session-3');
    stop();
    fake.tap('table-session-4');
    expect(opened).toEqual(['table-session-3']);
  });
});
