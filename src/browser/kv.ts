// A tiny key–value store in the browser's IndexedDB, for things that aren't
// files: e.g. where a home was last saved (a file handle, which only
// IndexedDB can keep). Per browser and per site address.
const DB = "odaja";
const STORE = "kv";

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = action(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const kvGet = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key)).catch(() => undefined);
export const kvSet = (key: string, value: unknown) => run<void>("readwrite", (s) => s.put(value, key)).catch(() => {});
export const kvDelete = (key: string) => run<void>("readwrite", (s) => s.delete(key)).catch(() => {});
