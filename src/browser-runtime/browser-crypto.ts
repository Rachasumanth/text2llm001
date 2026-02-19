import type { JsonValue } from "./storage-adapter.js";

export type EncryptedPayload = {
  v: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2";
  iterations: number;
  saltB64: string;
  ivB64: string;
  dataB64: string;
};

const PBKDF2_ITERATIONS = 120_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJsonValue(
  value: JsonValue,
  passphrase: string,
): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2",
    iterations: PBKDF2_ITERATIONS,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    dataB64: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptJsonValue(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<JsonValue> {
  const salt = base64ToBytes(payload.saltB64);
  const iv = base64ToBytes(payload.ivB64);
  const encrypted = base64ToBytes(payload.dataB64);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  const text = new TextDecoder().decode(new Uint8Array(decrypted));
  return JSON.parse(text) as JsonValue;
}
