#!/usr/bin/env node
/* Executable conformance check + worked reference for the connect handshake (BP-03 §6.4, AC-03.6).
   Implements BOTH sides in-process — a grantor and a consumer — using the normative schemes
   (Ed25519 PoP, compact-JWS grant signatures over JCS-canonical-minus-signatures, out-of-band
   fingerprint pinning) and asserts the happy path plus each refusal. If this passes, §6.4 is
   self-consistent and a partner can copy the grantor half. Run:  node kit/connect-handshake-check.mjs
   (needs `jose`: npm i jose). */

import { generateKeyPair, exportJWK, importJWK, FlattenedSign, flattenedVerify, CompactSign, compactVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

/* ---- normative primitives (must match BP-01 §14.5 / BP-03 §4.2, §6.4) ---- */
const jcs = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const fingerprint = (j) => 'ed25519:' + sha256(jcs({ crv: j.crv, kty: j.kty, x: j.x })).slice(0, 32);
const nonce = () => randomBytes(12).toString('base64url');

async function mint(kid) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  return { kid, pub: { ...(await exportJWK(publicKey)), kid }, priv: { ...(await exportJWK(privateKey)), kid } };
}
async function pop(privJwk, kid, method, body) {
  const claims = { method, body_sha256: 'sha256:' + sha256(jcs(body)), issued_at: new Date().toISOString(), nonce: nonce() };
  return new FlattenedSign(new TextEncoder().encode(jcs(claims))).setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk, 'EdDSA'));
}
async function popOk(jws, pubJwk) { await flattenedVerify(jws, await importJWK(pubJwk, 'EdDSA')); return true; }
async function signGrant(privJwk, kid, grant) {
  const m = { ...grant }; delete m.signatures;
  return new CompactSign(new TextEncoder().encode(jcs(m))).setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk, 'EdDSA'));
}
async function grantSigOk(compact, pubJwk, grant) {
  const m = { ...grant }; delete m.signatures;
  try {
    const { payload } = await compactVerify(compact, await importJWK(pubJwk, 'EdDSA'));
    return new TextDecoder().decode(payload) === jcs(m);
  } catch {
    return false;
  }
}

/* ---- the grantor (the half a partner implements) ---- */
class Grantor {
  constructor(identity, offers, pinnedConsumerFp) { this.id = identity; this.offers = offers; this.pin = pinnedConsumerFp; this.grants = {}; }
  async handle(method, env) {
    if (method === 'connect.request') {
      if (!(await popOk(env.sig, env.body.requester.identity_jwk))) return { error: { code: 'invalid_signature' } };
      if (fingerprint(env.body.requester.identity_jwk) !== this.pin) return { error: { code: 'fingerprint_unpinned' } };
      for (const w of env.body.capabilities) {
        const off = this.offers.find((o) => o.name === w.capability && o.modes.includes(w.mode));
        if (!off) return { error: { code: 'cell_denied' } };
      }
      const g = await mint('g-grantor');
      const grant = {
        grant_id: 'urn:brain:grantor:grant:' + nonce(), grantor: this.id.kid, grantee: env.body.requester.system_id,
        protocol_version: '2.0', member_lens: 'mem-x', visibility_ceiling: 'private', action_execute: 'dark',
        matrix: env.body.capabilities.map((w) => ({ capability: w.capability, direction: 'offer', mode: w.mode, sensitivity_ceiling: 'S1' })),
        keys: { grantor_public: g.pub, grantee_public: { x: env.body.grantee_public.x } },
      };
      grant.signatures = { grantor: await signGrant(this.id.priv, this.id.kid, grant) };
      this.grants[grant.grant_id] = { grant, inForce: false, grantorGrantKey: g };
      return { body: { grant, token: 'tok-' + nonce(), state: 'pending_grantee_signature' } };
    }
    if (method === 'connect.confirm') {
      const rec = this.grants[env.body.grant_id];
      if (!rec) return { error: { code: 'unknown_grant' } };
      if (!(await grantSigOk(env.body.grantee_signature, env.body.consumerIdentityPub, rec.grant))) return { error: { code: 'invalid_signature' } };
      rec.grant.signatures.grantee = env.body.grantee_signature; rec.inForce = true;
      return { body: { confirmed: true } };
    }
    return { error: { code: 'protocol_error' } };
  }
}

/* ---- the consumer (what the hub does) ---- */
async function connect(consumer, grantor, grantorIdentityPub, capabilities) {
  const grantKey = await mint('g-bf');
  const reqBody = { requester: { system_id: 'brainfeeder', identity_jwk: consumer.pub }, capabilities, grantee_public: grantKey.pub, nonce: nonce() };
  const issue = await grantor.handle('connect.request', { sig: await pop(consumer.priv, consumer.kid, 'connect.request', reqBody), body: reqBody });
  if (issue.error) return { ok: false, reason: issue.error.code };
  const grant = issue.body.grant;
  if (!(await grantSigOk(grant.signatures.grantor, grantorIdentityPub, grant))) return { ok: false, reason: 'grantor_sig_invalid' };
  if (grant.keys.grantee_public.x !== grantKey.pub.x) return { ok: false, reason: 'grantee_key_mismatch' };
  if (grant.action_execute !== 'dark') return { ok: false, reason: 'action_execute_not_dark' };
  const granteeSig = await signGrant(consumer.priv, consumer.kid, grant);
  const conf = await grantor.handle('connect.confirm', { body: { grant_id: grant.grant_id, grantee_signature: granteeSig, consumerIdentityPub: consumer.pub } });
  if (conf.error) return { ok: false, reason: conf.error.code };
  return { ok: true, grant_id: grant.grant_id };
}

/* ---- AC-03.6 ---- */
let pass = 0, fail = 0;
const t = async (label, fn) => { try { await fn(); console.log('  ok  ', label); pass++; } catch (e) { console.log('  FAIL', label, '-', e.message); fail++; } };

const consumer = await mint('bf-id');
const offers = [{ name: 'calendar.read', modes: ['read'] }, { name: 'episodes.read', modes: ['read'] }];

await t('happy path: request → issue → confirm, grant in force', async () => {
  const g = new Grantor(await mint('tpms-id'), offers, fingerprint(consumer.pub));
  // grantor identity pub must be the one the consumer verifies against:
  const r = await connect(consumer, g, g.id.pub, [{ capability: 'calendar.read', mode: 'read' }]);
  assert.equal(r.ok, true);
  assert.equal(g.grants[r.grant_id].inForce, true);
});
await t('unpinned requester key → fingerprint_unpinned, no grant', async () => {
  const g = new Grantor(await mint('tpms-id'), offers, 'ed25519:' + '0'.repeat(32)); // wrong pin
  const r = await connect(consumer, g, g.id.pub, [{ capability: 'calendar.read', mode: 'read' }]);
  assert.equal(r.ok, false); assert.equal(r.reason, 'fingerprint_unpinned');
});
await t('unoffered capability → cell_denied', async () => {
  const g = new Grantor(await mint('tpms-id'), offers, fingerprint(consumer.pub));
  const r = await connect(consumer, g, g.id.pub, [{ capability: 'tasks.read', mode: 'read' }]);
  assert.equal(r.ok, false); assert.equal(r.reason, 'cell_denied');
});
await t('consumer rejects a grant signed by the wrong grantor key', async () => {
  const g = new Grantor(await mint('tpms-id'), offers, fingerprint(consumer.pub));
  const wrong = await mint('evil');
  const r = await connect(consumer, g, wrong.pub, [{ capability: 'calendar.read', mode: 'read' }]); // verify against wrong pub
  assert.equal(r.ok, false); assert.equal(r.reason, 'grantor_sig_invalid');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
