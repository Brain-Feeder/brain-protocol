/* Minimal Brain Protocol crypto for the reference provider (BP-01 §14.5, BP-03 §4.2, §6.4).
   Self-contained so this folder copy-pastes into any project. Needs `jose`. */

import { generateKeyPair, exportJWK, importJWK, FlattenedSign, flattenedVerify, CompactSign, compactVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export function jcs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const fingerprint = (j) => 'ed25519:' + sha256(jcs({ crv: j.crv, kty: j.kty, x: j.x })).slice(0, 32);
export const nonce = () => randomBytes(12).toString('base64url');

export async function mint(kid) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  return { kid, pub: { ...(await exportJWK(publicKey)), kid, use: 'sig' }, priv: { ...(await exportJWK(privateKey)), kid, use: 'sig' } };
}

/* Proof-of-possession JWS over a call (method + body hash + issued_at + nonce). */
export async function signPoP(privJwk, kid, method, body) {
  const claims = { method, body_sha256: 'sha256:' + sha256(jcs(body)), issued_at: new Date().toISOString(), nonce: nonce() };
  return new FlattenedSign(new TextEncoder().encode(jcs(claims)))
    .setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk, 'EdDSA'));
}
export async function verifyPoP(jws, pubJwk) {
  const { payload } = await flattenedVerify(jws, await importJWK(pubJwk, 'EdDSA'));
  return JSON.parse(new TextDecoder().decode(payload));
}

/* Grant-document signature: compact JWS over the canonical grant body minus its signatures. */
export async function signGrant(privJwk, kid, grant) {
  const m = { ...grant }; delete m.signatures;
  return new CompactSign(new TextEncoder().encode(jcs(m))).setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk, 'EdDSA'));
}
export async function verifyGrantSig(compact, pubJwk, grant) {
  const m = { ...grant }; delete m.signatures;
  try {
    const { payload } = await compactVerify(compact, await importJWK(pubJwk, 'EdDSA'));
    return new TextDecoder().decode(payload) === jcs(m);
  } catch { return false; }
}

/* Sign the card body as a flattened JWS with the identity key (the published card is {jws, body}). */
export async function signCard(privJwk, kid, body) {
  return new FlattenedSign(new TextEncoder().encode(jcs(body)))
    .setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk, 'EdDSA'));
}
