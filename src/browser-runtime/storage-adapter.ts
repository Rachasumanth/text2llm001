export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface SessionMessageRecord {
  sessionKey: string;
  seq: number;
  entry: JsonValue;
  createdAt: number;
}

export interface SessionRecord {
  sessionKey: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStore {
  appendMessage(sessionKey: string, entry: JsonValue): Promise<SessionMessageRecord>;
  readSessionMessages(sessionKey: string): Promise<SessionMessageRecord[]>;
  listSessions(): Promise<SessionRecord[]>;
  upsertSession(session: SessionRecord): Promise<void>;
  deleteSession(sessionKey: string): Promise<void>;
}

export interface ConfigStore<TConfig = JsonValue> {
  get(): Promise<TConfig | null>;
  set(config: TConfig): Promise<void>;
  clear(): Promise<void>;
}

export interface CredentialProfileStore<TProfile = JsonValue> {
  getAll(): Promise<Record<string, TProfile>>;
  set(profileId: string, profile: TProfile): Promise<void>;
  delete(profileId: string): Promise<void>;
  clear(): Promise<void>;
}
