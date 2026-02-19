import {
  openBrowserRuntimeDb,
  requestToPromise,
  STORE_SESSION_MESSAGES,
  STORE_SESSIONS,
  txDone,
} from "./db.js";
import type { JsonValue, SessionMessageRecord, SessionRecord, SessionStore } from "./storage-adapter.js";

function nowMs(): number {
  return Date.now();
}

export class BrowserSessionStore implements SessionStore {
  async appendMessage(sessionKey: string, entry: JsonValue): Promise<SessionMessageRecord> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction([STORE_SESSIONS, STORE_SESSION_MESSAGES], "readwrite");

    const sessions = tx.objectStore(STORE_SESSIONS);
    const messages = tx.objectStore(STORE_SESSION_MESSAGES);
    const bySession = messages.index("bySession");

    const count = await requestToPromise(bySession.count(IDBKeyRange.only(sessionKey)));
    const createdAt = nowMs();
    const record: SessionMessageRecord = { sessionKey, seq: count, entry, createdAt };

    messages.put(record);

    const existing = (await requestToPromise(sessions.get(sessionKey))) as SessionRecord | undefined;
    if (existing) {
      sessions.put({ ...existing, updatedAt: createdAt });
    } else {
      sessions.put({ sessionKey, createdAt, updatedAt: createdAt } satisfies SessionRecord);
    }

    await txDone(tx);
    return record;
  }

  async readSessionMessages(sessionKey: string): Promise<SessionMessageRecord[]> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_SESSION_MESSAGES, "readonly");
    const messages = tx.objectStore(STORE_SESSION_MESSAGES);
    const bySession = messages.index("bySession");
    const records = await requestToPromise(bySession.getAll(IDBKeyRange.only(sessionKey)));
    await txDone(tx);
    return records as SessionMessageRecord[];
  }

  async listSessions(): Promise<SessionRecord[]> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_SESSIONS, "readonly");
    const sessions = tx.objectStore(STORE_SESSIONS);
    const records = await requestToPromise(sessions.getAll());
    await txDone(tx);
    return (records as SessionRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async upsertSession(session: SessionRecord): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_SESSIONS, "readwrite");
    tx.objectStore(STORE_SESSIONS).put(session);
    await txDone(tx);
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction([STORE_SESSIONS, STORE_SESSION_MESSAGES], "readwrite");

    tx.objectStore(STORE_SESSIONS).delete(sessionKey);

    const messages = tx.objectStore(STORE_SESSION_MESSAGES);
    const bySession = messages.index("bySession");
    const keys = await requestToPromise(bySession.getAllKeys(IDBKeyRange.only(sessionKey)));
    for (const key of keys) {
      messages.delete(key);
    }

    await txDone(tx);
  }
}
