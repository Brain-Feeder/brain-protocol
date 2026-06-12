// Wire crypto for the reference server: card signing (Ed25519 JWS), JWS proof-of-possession
// verification, JCS canonicalisation (BP-03 §2.3, §4.2, BP-07 §3.2). Mirrors the kit's crypto;
// the reference is self-contained so a partner cloning it gets a working pipe.

import { createHash } from 'node:crypto';
import {
  generateKeyPair, exportJWK, importJWK, FlattenedSign, flattenedVerify, type JWK, type KeyLike,
} from 'jose';

export interface KeyPairJWK { publicJwk: JWK; privateJwk: JWK; publicKey: KeyLike; privateKey: KeyLike; kid: string; }

let n = 0;
export async function mintEd25519(prefix = 'id'): Promise<KeyPairJWK> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const kid = `${prefix}-${++n}`;
  return { publicKey, privateKey, kid, publicJwk: { ...(await exportJWK(publicKey)), kid, use: 'sig' }, privateJwk: { ...(await exportJWK(privateKey)), kid, use: 'sig' } };
}

export function jcs(value: unknown): string { return ser(value); }
function ser(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return JSON.stringify(v);
  if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + ser(o[k])).join(',') + '}';
  }
  throw new Error('jcs: bad type');
}

export function sha256hex(s: string | Uint8Array): string { return createHash('sha256').update(s).digest('hex'); }

export async function signCard(key: KeyPairJWK, body: unknown): Promise<unknown> {
  return new FlattenedSign(new TextEncoder().encode(jcs(body)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid }).sign(key.privateKey);
}

export interface PoPClaims { method: string; body_sha256: string; issued_at: string; nonce: string; }

/** Verify a flattened JWS PoP against a pinned public key; returns claims or throws. */
export async function verifyPoP(jws: unknown, pinnedPublicJwk: JWK): Promise<PoPClaims> {
  const key = await importJWK(pinnedPublicJwk, 'EdDSA');
  const { payload } = await flattenedVerify(jws as any, key);
  return JSON.parse(new TextDecoder().decode(payload)) as PoPClaims;
}
