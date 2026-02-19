import { openBrowserRuntimeDb, requestToPromise, STORE_CONFIG, txDone } from "./db.js";
import type { ConfigStore, JsonValue } from "./storage-adapter.js";

const CONFIG_KEY = "main";

export class BrowserConfigStore<TConfig = JsonValue> implements ConfigStore<TConfig> {
  async get(): Promise<TConfig | null> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CONFIG, "readonly");
    const store = tx.objectStore(STORE_CONFIG);
    const value = await requestToPromise(store.get(CONFIG_KEY));
    await txDone(tx);
    return (value as TConfig | undefined) ?? null;
  }

  async set(config: TConfig): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CONFIG, "readwrite");
    tx.objectStore(STORE_CONFIG).put(config, CONFIG_KEY);
    await txDone(tx);
  }

  async clear(): Promise<void> {
    const db = await openBrowserRuntimeDb();
    const tx = db.transaction(STORE_CONFIG, "readwrite");
    tx.objectStore(STORE_CONFIG).delete(CONFIG_KEY);
    await txDone(tx);
  }
}
