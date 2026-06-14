#!/usr/bin/env node
/* Reference Brain Protocol PROVIDER (BP-03 §2 card, §6.4 connect responder, BP-04 capability serve).
   Run it, point a consumer at it, and it federates: it publishes a signed card, accepts the connect
   handshake, issues a dual-signed grant, and serves a capability (notes.read) under token + per-call
   proof. This is the half a partner implements to become connectable — copy this folder, swap the
   identity + capabilities + data, deploy. Run:  npm i jose && node server.mjs   (PORT, BP_SYSTEM_ID). */

import http from 'node:http';
import { mint, fingerprint, signCard, signGrant, verifyGrantSig, verifyPoP, nonce, sha256 } from './bp-crypto.mjs';

const PORT = Number(process.env.PORT || 8400);
const SYSTEM_ID = process.env.BP_SYSTEM_ID || 'reference-provider';

// In production the identity key is a long-lived secret loaded from a vault/env, not minted at boot.
const identity = await mint(`${SYSTEM_ID}-id`);
const offers = [{ name: 'notes.read', direction: 'offer', modes: ['read'], sensitivity_ceiling: 'S1' }];
const NOTES = [
  { id: `urn:brain:${SYSTEM_ID}:note:1`, subtype: 'note', title: 'Welcome', body: 'From the reference provider.', valid_time: new Date().toISOString(), sensitivity: 'S1' },
  { id: `urn:brain:${SYSTEM_ID}:note:2`, subtype: 'note', title: 'It works', body: 'Federation over a signed handshake.', valid_time: new Date().toISOString(), sensitivity: 'S1' },
];

const cardBody = {
  card_format: 1, system_id: SYSTEM_ID, name: 'Reference Provider',
  operator: { legal_name: 'Reference', contact: 'admin@example.com', jurisdiction: 'GB' },
  protocol_versions: ['2.0'], vocabulary: { base_version: '2.0' },
  conformance: { class: 'D', certification: { tier: 'self', suite_version: '2.0.3' } },
  identity_keys: [{ kid: identity.kid, kty: 'OKP', crv: 'Ed25519', x: identity.pub.x, use: 'sig' }],
  capabilities: offers,
  endpoints: { a2a: `http://localhost:${PORT}/a2a` },
  limits: { max_batch_records: 500, max_batch_bytes: 1048576, rate_per_minute: 60 },
};
const signedCard = await signCard(identity.priv, identity.kid, cardBody);

const pins = {};   // system_id -> identity fingerprint (TOFU here; production pins out of band)
const grants = {}; // grant_id -> { grant, granteePub, granteeIdentity, tokenHash, inForce }
const tokens = {}; // token -> grant_id

const send = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    try {
      if (req.url.startsWith('/.well-known/brain-protocol/card.json')) return send(res, 200, { jws: signedCard, body: cardBody });
      if (req.url.startsWith('/a2a') && req.method === 'POST') {
        const env = JSON.parse(raw || '{}');
        const sig = req.headers['brain-signature'] ? JSON.parse(req.headers['brain-signature']) : null;
        const out = await handle(env, sig, req.headers);
        return send(res, out.status, out.payload);
      }
      send(res, 404, { error: { code: 'not_found' } });
    } catch (e) { send(res, 500, { error: { code: 'protocol_error', message: String(e) } }); }
  });
}).listen(PORT, () => console.log(`reference provider on :${PORT} — system_id ${SYSTEM_ID}, fingerprint ${fingerprint(identity.pub)}`));

async function handle(env, sig, headers) {
  const method = env.method;
  const body = env.body ?? {};

  if (method === 'connect.request') {
    if (!sig) return { status: 401, payload: { error: { code: 'invalid_signature' } } };
    const idJwk = body.requester?.identity_jwk;
    if (!idJwk || !body.grantee_public) return { status: 400, payload: { error: { code: 'malformed' } } };
    try { await verifyPoP(sig, idJwk); } catch { return { status: 401, payload: { error: { code: 'invalid_signature' } } }; }
    const sysId = body.requester.system_id;
    const fp = fingerprint(idJwk);
    if (pins[sysId] && pins[sysId] !== fp) return { status: 401, payload: { error: { code: 'fingerprint_unpinned' } } };
    pins[sysId] = fp;
    for (const w of body.capabilities ?? []) {
      if (!offers.find((o) => o.name === w.capability && o.modes.includes(w.mode))) return { status: 200, payload: { error: { code: 'cell_denied' } } };
    }
    const g = await mint(`${SYSTEM_ID}-grant`);
    const grant = {
      grant_format: 1, grant_id: `urn:brain:${SYSTEM_ID}:grant:${nonce()}`,
      grantor: SYSTEM_ID, grantee: sysId, protocol_version: '2.0',
      issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
      member_lens: body.member_hint ?? 'mem-x', visibility_ceiling: 'private', action_execute: 'dark',
      matrix: (body.capabilities ?? []).map((w) => ({ capability: w.capability, direction: 'offer', mode: w.mode, sensitivity_ceiling: 'S1' })),
      keys: { grantor_public: g.pub, grantee_public: { x: body.grantee_public.x }, rotation_days: 90 },
    };
    grant.signatures = { grantor: await signGrant(identity.priv, identity.kid, grant) };
    const token = `tok-${nonce()}`;
    grants[grant.grant_id] = { grant, granteePub: body.grantee_public, granteeIdentity: idJwk, tokenHash: sha256(token), inForce: false };
    tokens[token] = grant.grant_id;
    return { status: 200, payload: { body: { grant, token, state: 'pending_grantee_signature' } } };
  }

  if (method === 'connect.confirm') {
    const rec = grants[body.grant_id];
    if (!rec) return { status: 200, payload: { error: { code: 'unknown_grant' } } };
    if (!(await verifyGrantSig(body.grantee_signature, rec.granteeIdentity, rec.grant))) return { status: 200, payload: { error: { code: 'invalid_signature' } } };
    rec.grant.signatures.grantee = body.grantee_signature; rec.inForce = true;
    return { status: 200, payload: { body: { confirmed: true } } };
  }

  // capability call: token + per-grant proof-of-possession both required (stolen token alone is useless)
  const auth = headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const rec = grants[tokens[token]];
  if (!rec || !rec.inForce || sha256(token) !== rec.tokenHash) return { status: 401, payload: { error: { code: 'unauthenticated' } } };
  if (!sig) return { status: 401, payload: { error: { code: 'invalid_signature' } } };
  try { await verifyPoP(sig, { kty: 'OKP', crv: 'Ed25519', x: rec.granteePub.x }); } catch { return { status: 401, payload: { error: { code: 'invalid_signature' } } }; }
  if (!rec.grant.matrix.find((c) => c.capability === method)) return { status: 200, payload: { error: { code: 'cell_denied' } } };
  if (method === 'notes.read') return { status: 200, payload: { body: { records: NOTES, cursor: null, complete: true, truncated: false } } };
  return { status: 200, payload: { error: { code: 'cell_denied' } } };
}
