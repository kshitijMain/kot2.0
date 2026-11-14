/**
 * One IndexedDB object store for the phone web app (P9-28): values are structured-cloned, so a
 * WebCrypto key pair is kept as the key objects themselves and its private half never becomes
 * bytes a script could read (SEC-006). Opened on first use.
 */
export class BrowserDatabase {
  private database: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly name: string,
    private readonly indexedDb: IDBFactory | undefined = globalThis.indexedDB,
    private readonly storeName = 'values',
  ) {}

  async get(key: string): Promise<unknown> {
    return requestResult((await this.store('readonly')).get(key));
  }

  async put(key: string, value: unknown): Promise<void> {
    await requestResult((await this.store('readwrite')).put(value, key));
  }

  async delete(key: string): Promise<void> {
    await requestResult((await this.store('readwrite')).delete(key));
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    this.database ??= this.open();
    return (await this.database).transaction(this.storeName, mode).objectStore(this.storeName);
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.indexedDb;
    if (factory === undefined) {
      return Promise.reject(new Error('IndexedDB is not available in this browser'));
    }
    return new Promise((resolve, reject) => {
      const open = factory.open(this.name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(this.storeName);
      };
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        // A failed open is not kept: the next call tries again.
        this.database = undefined;
        reject(open.error ?? new Error('IndexedDB is not available in this browser'));
      };
    });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}
