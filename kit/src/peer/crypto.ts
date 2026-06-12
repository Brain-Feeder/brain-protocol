// Cryptographic primitives for the kit-peer (BP-03 §4, BP-07 §3.4).
//
// Mandatory-to-implement suite, ratified v2.0:
//   - JWS signing:           Ed25519 (EdDSA)
//   - JWE key agreement+enc:  ECDH-ES on X25519 + A256GCM
//   - Hashing:                SHA-256
//   - Card signing:           Ed25519 over the canonical card body
//
// The kit-peer mints fresh per-grant key pairs, signs every batch, can replay nonces and
// skew its clock, and serves a signed (or deliberately broken) agent card — everything a
// real counterpart system does, so the wire tests exercise the target honestly.

import { createHash } from 'node:crypto';
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  FlattenedSign,
  flattenedVerify,
  CompactEncrypt,
  compactDecrypt,
  type JWK,
  type KeyLike,
} from 'jose';

export interface KeyPairJWK {
  publicJwk: JWK;
  privateJwk: JWK;
  publicKey: KeyLike;
  privateKey: KeyLike;
  kid: string;
}

let kidCounter = 0;
function nextKid(prefix: string): string {
  return `${prefix}-${++kidCounter}`;
}

/** Mint an Ed25519 signing pair (identity key or per-grant signing key). */
export async function mintEd25519(kidPrefix = 'sig'): Promise<KeyPairJWK> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const kid = nextKid(kidPrefix);
  const publicJwk = { ...(await exportJWK(publicKey)), kid, use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, use: 'sig' };
  return { publicKey, privateKey, publicJwk, privateJwk, kid };
}

/** Mint an X25519 encryption pair (per-grant JWE key, BP-07 §3.4). */
export async function mintX25519(kidPrefix = 'enc'): Promise<KeyPairJWK> {
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'X25519', extractable: true });
  const kid = nextKid(kidPrefix);
  const publicJwk = { ...(await exportJWK(publicKey)), kid };
  const privateJwk = { ...(await exportJWK(privateKey)), kid };
  return { publicKey, privateKey, publicJwk, privateJwk, kid };
}

// ---------------------------------------------------------------------------
// RFC 8785 (JCS) canonical JSON — the signing input (BP-01 §14.5).
// ---------------------------------------------------------------------------

export function jcsCanonical(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number not permitted in JCS');
    return JSON.stringify(v);
  }
  if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(serialize).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(obj[k])).join(',') + '}';
  }
  throw new Error(`cannot serialize ${typeof v}`);
}

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Prefixed(input: string | Uint8Array): string {
  return 'sha256:' + sha256(input);
}

// ---------------------------------------------------------------------------
// JWS proof-of-possession over a message envelope (BP-03 §4.2, BP-04 §2.3).
// The signature covers: method, SHA-256 hash of the body, issued_at, nonce.
// ---------------------------------------------------------------------------

export interface PoPClaims {
  method: string;
  body_sha256: string;
  issued_at: string;
  nonce: string;
}

/** Sign a batch/envelope as a flattened JWS with a grant signing key. */
export async function signBatch(
  key: KeyPairJWK,
  method: string,
  body: unknown,
  opts: { issuedAt?: string; nonce: string },
): Promise<{ jws: any; claims: PoPClaims }> {
  const bodyHash = sha256Prefixed(jcsCanonical(body));
  const claims: PoPClaims = {
    method,
    body_sha256: bodyHash,
    issued_at: opts.issuedAt ?? new Date().toISOString(),
    nonce: opts.nonce,
  };
  const jws = await new FlattenedSign(new TextEncoder().encode(jcsCanonical(claims)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .sign(key.privateKey);
  return { jws, claims };
}

/** Verify a flattened JWS against a public key; returns the parsed claims or throws. */
export async function verifyBatch(jws: any, publicJwk: JWK): Promise<PoPClaims> {
  const key = await importJWK(publicJwk, 'EdDSA');
  const { payload } = await flattenedVerify(jws, key);
  return JSON.parse(new TextDecoder().decode(payload)) as PoPClaims;
}

// ---------------------------------------------------------------------------
// JWE for S2 payloads (BP-07 §3.3): ECDH-ES(X25519) + A256GCM, end-to-end.
// ---------------------------------------------------------------------------

export async function encryptS2(recipientPublicJwk: JWK, plaintext: string): Promise<string> {
  const key = await importJWK(recipientPublicJwk, 'ECDH-ES');
  return new CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM' })
    .encrypt(key);
}

export async function decryptS2(recipientPrivateJwk: JWK, jwe: string): Promise<string> {
  const key = await importJWK(recipientPrivateJwk, 'ECDH-ES');
  const { plaintext } = await compactDecrypt(jwe, key);
  return new TextDecoder().decode(plaintext);
}

/** Ed25519 key fingerprint for out-of-band pinning (BP-03 §2.3.3). */
export function keyFingerprint(publicJwk: JWK): string {
  return 'ed25519:' + sha256(jcsCanonical({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x })).slice(0, 32);
}

export function randomNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
