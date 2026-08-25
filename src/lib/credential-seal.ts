import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as Crypto from "expo-crypto";
import { apiJson } from "./api";
import type { OaCredentials } from "./oa-credentials";

/**
 * Encrypting the OneAdvanced credentials to the backend itself, so that Cloudflare cannot read
 * them.
 *
 * <p>`otj-services.com` is proxied, which means the TLS the phone negotiates ends at a Cloudflare
 * edge node and a *second* connection carries the request the rest of the way. Between those two
 * hops the request body exists in plaintext inside someone else's infrastructure. For a bearer
 * token that is a nuisance; for the user's real institutional password — the one that opens their
 * university account, not just this app — it is the wrong place to leave a copy. So the two fields
 * that matter are sealed here, on the device, to a key only the backend process holds.
 *
 * <pre>
 *   shared = X25519(ephemeralPrivate, serverPublic)
 *   key    = HKDF-SHA256(shared, salt = serverPublic || ephemeralPublic, info = "otj-oa-credentials-v1")
 *   body   = ChaCha20-Poly1305(key, nonce, aad = "otj-oa-credentials-v1|" + keyId)
 *              over {"username": "...", "password": "...", "iat": <epoch seconds>}
 * </pre>
 *
 * <p><b>The pinned identity key is what makes any of this worth doing.</b> The key to seal to is
 * fetched from the server — over the same proxied connection. A client that trusted whatever came
 * back would be defended against an edge that *reads* and not at all against one that *answers*:
 * substituting its own key would let it decrypt, read, and re-seal to the real server invisibly.
 * So the server signs its announcement with a long-lived Ed25519 key, this app carries the public
 * half as a build-time constant, and an announcement that does not verify is refused outright.
 * There is no fallback to plaintext — a fallback would be a downgrade attack with extra steps.
 *
 * <p>What this does not do: hide that a submit is happening, hide the bearer token, or protect
 * anything else in the app. Those are still ordinary TLS. It also does not stop a replay — whoever
 * holds the token can replay the whole request — which is why the sealed `iat` only bounds how
 * long a captured envelope stays useful rather than pretending to be a nonce.
 *
 * <p>Pure JavaScript on purpose. React Native has no WebCrypto, and a native crypto module would
 * mean a development build, which this project deliberately cannot have — SDK 54 is pinned so the
 * app runs in Expo Go on iOS. `@noble/*` is audited, dependency-free and runs in Hermes.
 */

/**
 * The server's identity key, base64url, from the environment at bundle time.
 *
 * <p>Read the same way `api.ts` reads the base URL, and throwing for the same reason: a wrong
 * default here would not be a broken submit, it would be a submit that trusts the wrong key. It
 * is not a secret — it is the public half — but it must match the seed the backend was started
 * with, so `IdentityKeyTool generate` prints both together and they should be deployed together.
 */
const PINNED_IDENTITY_KEY = process.env.EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY;
if (!PINNED_IDENTITY_KEY) throw new Error("EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY is not set");

/** Bound into the derivation and the AAD. Must match `CredentialKeyRing.INFO` on the server. */
const INFO = "otj-oa-credentials-v1";
/** The prefix of the string the identity key signs. Must match `ANNOUNCEMENT_CONTEXT`. */
const ANNOUNCEMENT_CONTEXT = "otj-credential-key-v1";
const ALGORITHM = "X25519-HKDF-SHA256/ChaCha20-Poly1305";

/** The envelope shape the two prepare endpoints take. */
export type SealedEnvelope = {
  v: 1;
  keyId: string;
  epk: string;
  nonce: string;
  ciphertext: string;
};

/** What `GET /otj-services/crypto/public-key` answers, before any of it is believed. */
type Announcement = {
  algorithm: string;
  keyId: string;
  publicKey: string;
  expiresAt: number;
  signature: string;
};

/**
 * The server key could not be trusted, so nothing was sent.
 *
 * <p>Separate from `ApiError` because it is not the server's answer being reported — it is this
 * app refusing to act on one. The message is written to be shown to the user as-is: the screen
 * that catches it prints `e.message` into the error banner.
 */
export class KeyTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyTrustError";
  }
}

/**
 * The verified announcement, for as long as it is valid.
 *
 * <p>In memory only, and deliberately not in the secure store: the cost of re-fetching is one
 * small request per app session, while a persisted copy would have to be re-verified anyway and
 * would add a way for a stale key to outlive the process that vouched for it.
 */
let cached: { keyId: string; publicKey: Uint8Array; expiresAt: number } | null = null;

/**
 * Forgets the cached key, so the next seal re-fetches.
 *
 * <p>Called when the server answers `unknown_key` — it restarted between the fetch and the submit,
 * and is now holding a key this app has never seen.
 */
export function forgetServerKey(): void {
  cached = null;
}

/**
 * Seals one credential pair to the server's current key.
 *
 * @throws KeyTrustError if the announcement cannot be verified against the pinned identity key
 */
export async function sealCredentials(creds: OaCredentials): Promise<SealedEnvelope> {
  const key = await serverKey();

  // getRandomBytesAsync rather than the synchronous getRandomBytes: the docs note the sync one
  // "falls back to Math.random in development", and a predictable ephemeral key would hand the
  // whole conversation to anyone who could guess it.
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
      // Seconds, and inside the ciphertext — a timestamp beside the envelope could be edited by
      // anything on the path, which would make the server's freshness check meaningless.
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

/** The cached key if it is still valid, otherwise a freshly fetched and verified one. */
async function serverKey() {
  // A minute of headroom: a key that expires while the request is in flight would be refused by
  // the server as unknown, and re-fetching costs far less than a failed submit.
  if (cached && cached.expiresAt > Date.now() / 1000 + 60) return cached;

  const announcement = await apiJson<Announcement>("/otj-services/crypto/public-key");
  cached = verify(announcement);
  return cached;
}

/**
 * The whole trust decision, in one place.
 *
 * <p>Every check here ends the submit rather than degrading it. That is the point: the only reason
 * to encrypt at all is that the channel is not trusted, so "the channel said this key is fine" can
 * never be an acceptable answer.
 */
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
  // Rebuilt from the fields as they arrived rather than from the parsed ones, so what is verified
  // is exactly what is about to be used.
  let ok = false;
  try {
    ok = ed25519.verify(
      fromBase64url(announcement.signature),
      signed,
      fromBase64url(PINNED_IDENTITY_KEY!),
    );
  } catch {
    // A signature that is not even well-formed lands here. Same outcome as one that simply does
    // not verify — there is no version of this worth continuing from.
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

// ── Encoding ────────────────────────────────────────────────────────────────────────────────────
// Hand-rolled rather than reached for: Hermes has no Buffer, `atob`/`btoa` are not guaranteed
// across the platforms this bundle targets, and base64url is not what either would produce anyway.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const remaining = bytes.length - i;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    // Unpadded, which is what the server's Base64.getUrlEncoder().withoutPadding() expects.
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
    if (code > 0xffff) i++; // a surrogate pair; codePointAt consumed both halves
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
