import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as Crypto from "expo-crypto";
import { apiJson } from "./api";
import type { OaCredentials } from "./oa-credentials";

// Seals the OneAdvanced credentials to the backend process, so Cloudflare's TLS termination never
// sees them. Wire format: otjServices/credential-encryption-spec.md. The key to seal to arrives over
// that same hop, so its announcement must verify against the pinned identity key or nothing is sent.
// Pure JS: Expo Go allows no native crypto module.

const PINNED_IDENTITY_KEY = process.env.EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY;
if (!PINNED_IDENTITY_KEY) throw new Error("EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY is not set");

const INFO = "otj-oa-credentials-v1";
const ANNOUNCEMENT_CONTEXT = "otj-credential-key-v1";
const ALGORITHM = "X25519-HKDF-SHA256/ChaCha20-Poly1305";

export type SealedEnvelope = {
  v: 1;
  keyId: string;
  epk: string;
  nonce: string;
  ciphertext: string;
};

type Announcement = {
  algorithm: string;
  keyId: string;
  publicKey: string;
  expiresAt: number;
  signature: string;
};

// Its message is shown to the user as-is.
export class KeyTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyTrustError";
  }
}

// Memory only: a persisted key would outlive the process that verified it.
let cached: { keyId: string; publicKey: Uint8Array; expiresAt: number } | null = null;

export function forgetServerKey(): void {
  cached = null;
}

export async function sealCredentials(creds: OaCredentials): Promise<SealedEnvelope> {
  const key = await serverKey();

  // Not the sync getRandomBytes, which can fall back to Math.random in development.
  const ephemeralPrivate = await Crypto.getRandomBytesAsync(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const shared = x25519.getSharedSecret(ephemeralPrivate, key.publicKey);

  const salt = concat(key.publicKey, ephemeralPublic);
  const derived = hkdf(sha256, shared, salt, utf8(INFO), 32);

  const nonce = await Crypto.getRandomBytesAsync(12);
  const payload = utf8(
    JSON.stringify({
      username: creds.username,
      password: creds.password,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const ciphertext = chacha20poly1305(derived, nonce, utf8(`${INFO}|${key.keyId}`)).encrypt(payload);

  return {
    v: 1,
    keyId: key.keyId,
    epk: base64url(ephemeralPublic),
    nonce: base64url(nonce),
    ciphertext: base64url(ciphertext),
  };
}

async function serverKey() {
  // A minute's headroom so the key can't expire in flight.
  if (cached && cached.expiresAt > Date.now() / 1000 + 60) return cached;

  const announcement = await apiJson<Announcement>("/otj-services/crypto/public-key");
  cached = verify(announcement);
  return cached;
}

// Every failure here ends the submit; there is no plaintext fallback.
function verify(announcement: Announcement) {
  if (announcement?.algorithm !== ALGORITHM) {
    throw new KeyTrustError(
      "The server offered an encryption scheme this app does not know. Update the app and try again.",
    );
  }

  const publicKey = fromBase64url(announcement.publicKey);
  if (publicKey.length !== 32) {
    throw new KeyTrustError("The server's encryption key is malformed. Your details were not sent.");
  }
  if (!(announcement.expiresAt > Date.now() / 1000)) {
    throw new KeyTrustError("The server's encryption key has expired. Try again in a moment.");
  }

  const signed = utf8(
    `${ANNOUNCEMENT_CONTEXT}|${announcement.keyId}|${announcement.publicKey}|${announcement.expiresAt}`,
  );
  let ok = false;
  try {
    ok = ed25519.verify(
      fromBase64url(announcement.signature),
      signed,
      fromBase64url(PINNED_IDENTITY_KEY!),
    );
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new KeyTrustError(
      "This server could not prove it is the one this app was built for, so your OneAdvanced " +
        "details were not sent. If this keeps happening, do not retry on this network.",
    );
  }

  return { keyId: announcement.keyId, publicKey, expiresAt: announcement.expiresAt };
}

// Hand-rolled: Hermes has no Buffer, and atob/btoa aren't base64url.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const remaining = bytes.length - i;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    if (remaining > 1) out += ALPHABET[(chunk >> 6) & 63];
    if (remaining > 2) out += ALPHABET[chunk & 63];
  }
  return out;
}

function fromBase64url(value: string): Uint8Array {
  const clean = value.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let written = 0;

  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new KeyTrustError("The server's answer was not readable.");
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (accumulator >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, written);
}

function utf8(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 3);
  let written = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i)!;
    if (code > 0xffff) i++; // codePointAt consumed both halves of a surrogate pair
    if (code < 0x80) {
      bytes[written++] = code;
    } else if (code < 0x800) {
      bytes[written++] = 0xc0 | (code >> 6);
      bytes[written++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      bytes[written++] = 0xe0 | (code >> 12);
      bytes[written++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[written++] = 0x80 | (code & 0x3f);
    } else {
      bytes[written++] = 0xf0 | (code >> 18);
      bytes[written++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[written++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[written++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes.subarray(0, written);
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}
