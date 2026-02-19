const DB_NAME = "text2llm-browser-runtime";
const DB_VERSION = 1;

export const STORE_CONFIG = "config";
export const STORE_SESSIONS = "sessions";
export const STORE_SESSION_MESSAGES = "session_messages";
export const STORE_CREDENTIALS = "credentials";

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openBrowserRuntimeDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG);
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionKey" });
      }
      if (!db.objectStoreNames.contains(STORE_SESSION_MESSAGES)) {
        const messages = db.createObjectStore(STORE_SESSION_MESSAGES, {
          keyPath: ["sessionKey", "seq"],
        });
        messages.createIndex("bySession", "sessionKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CREDENTIALS)) {
        db.createObjectStore(STORE_CREDENTIALS, { keyPath: "profileId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

export { requestToPromise };
