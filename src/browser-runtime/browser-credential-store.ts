import { openBrowserRuntimeDb, requestToPromise, STORE_CREDENTIALS, txDone } from "./db.js";
import type { CredentialProfileStore, JsonValue } from "./storage-adapter.js";

export interface CredentialCodec<TProfile> {
  encode(profile: TProfile): Promise<JsonValue>;
  decode(stored: JsonValue): Promise<TProfile>;
}

type CredentialRecord<TProfile> = {
  profileId: string;
  profile: JsonValue;
};

export class BrowserCredentialStore<TProfile = JsonValue>
  implements CredentialProfileStore<TProfile>
{
  constructor(private readonly codec?: CredentialCodec<TProfile>) {}

  async getAll(): Promise<Record<string, TProfile>> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CREDENTIALS, "readonly");
    const store = tx.objectStore(STORE_CREDENTIALS);
    const items = (await requestToPromise(store.getAll())) as CredentialRecord<TProfile>[];
    await txDone(tx);

    const result: Record<string, TProfile> = {};
    for (const item of items) {
      result[item.profileId] = this.codec
        ? await this.codec.decode(item.profile)
        : (item.profile as TProfile);
    }
    return result;
  }

  async set(profileId: string, profile: TProfile): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CREDENTIALS, "readwrite");
    const encoded = this.codec ? await this.codec.encode(profile) : (profile as JsonValue);
    tx.objectStore(STORE_CREDENTIALS).put({
      profileId,
      profile: encoded,
    } satisfies CredentialRecord<TProfile>);
    await txDone(tx);
  }

  async delete(profileId: string): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CREDENTIALS, "readwrite");
    tx.objectStore(STORE_CREDENTIALS).delete(profileId);
    await txDone(tx);
  }

  async clear(): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CREDENTIALS, "readwrite");
    tx.objectStore(STORE_CREDENTIALS).clear();
    await txDone(tx);
  }
}
