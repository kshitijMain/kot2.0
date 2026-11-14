import { type DeviceKey, generateWebCryptoDeviceKey, webCryptoDeviceKey } from '@rp/api-client';
import type { DeviceKeyStore } from '../device-session.js';
import type { KeyValueStore } from '../storage.js';
import type { BrowserDatabase } from './browser-database.js';

/**
 * The phone web app's "secure" store (P9-28): the device and staff tokens in IndexedDB, on this
 * origin only. A browser has no Keystore; what guards them is the origin, the page's CSP and
 * Trusted Types (SEC-017), and the device key below, without which a stolen token is refused.
 */
export class IndexedDbStore implements KeyValueStore {
  constructor(
    private readonly database: BrowserDatabase,
    private readonly prefix = 'kv:',
  ) {}

  async getItem(key: string): Promise<string | null> {
    const value = await this.database.get(this.prefix + key);
    return typeof value === 'string' ? value : null;
  }

  setItem(key: string, value: string): Promise<void> {
    return this.database.put(this.prefix + key, value);
  }

  removeItem(key: string): Promise<void> {
    return this.database.delete(this.prefix + key);
  }
}

/** `localStorage` as a store: the server address and the live-update resume point (not secret). */
export class WebStorageStore implements KeyValueStore {
  constructor(
    private readonly storage: Storage,
    private readonly prefix = 'rp-phone.',
  ) {}

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.storage.getItem(this.prefix + key));
  }

  setItem(key: string, value: string): Promise<void> {
    this.storage.setItem(this.prefix + key, value);
    return Promise.resolve();
  }

  removeItem(key: string): Promise<void> {
    this.storage.removeItem(this.prefix + key);
    return Promise.resolve();
  }
}

const KEY_PAIR = 'device-key';

function isKeyPair(value: unknown): value is CryptoKeyPair {
  return (
    typeof value === 'object' && value !== null && 'privateKey' in value && 'publicKey' in value
  );
}

/**
 * The phone web app's device key (AUTH-007, P9-28): a WebCrypto ECDSA P-256 pair whose private
 * half cannot be exported, kept in IndexedDB as the key objects, like the web console's.
 */
export class WebCryptoDeviceKeys implements DeviceKeyStore {
  constructor(
    private readonly database: BrowserDatabase,
    private readonly generate: typeof generateWebCryptoDeviceKey = generateWebCryptoDeviceKey,
  ) {}

  async load(): Promise<DeviceKey | undefined> {
    const stored = await this.database.get(KEY_PAIR);
    return isKeyPair(stored) ? webCryptoDeviceKey(stored) : undefined;
  }

  async create(): Promise<DeviceKey> {
    const { keyPair, key } = await this.generate();
    await this.database.put(KEY_PAIR, keyPair);
    return key;
  }

  remove(): Promise<void> {
    return this.database.delete(KEY_PAIR);
  }
}
