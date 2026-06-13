#!/usr/bin/env node
/* Reference CONSUMER + end-to-end test for the reference provider. Fetches the card, runs the
   connect handshake, reads the capability, and checks a stolen token (no proof) is refused.
   This is the half a hub (like Brainfeeder) implements. Run with the server up:
     node server.mjs &   then   node connect-client.mjs */

import assert from 'node:assert/strict';
import { mint, fingerprint, signPoP, signGrant, verifyGrantSig, nonce } from './bp-crypto.mjs';

const BASE = process.env.PROVIDER || 'http://localhost:8400';

async function callRaw(a2a, method, body, sig, token) {
  const headers = { 'content-type': 'application/json' };
  if (sig) headers['brain-signature'] = JSON.stringify(sig);
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(a2a, { method: 'POST', headers, body: JSON.stringify({ envelope_format: 1, protocol_version: '2.0', method, body }) });
  return res.json();
}

async function main() {
  // 1. discover + pin the provider's identity
  const card = (await (await fetch(`${BASE}/.well-known/brain-protocol/card.json`)).json());
  const idKey = card.body.identity_keys[0];
  const pin = fingerprint(idKey);
  const a2a = card.body.endpoints.a2a;
  assert.ok(pin.startsWith('ed25519:'), 'fingerprint computed');

  // 2. mint our identity + a per-grant key
  const me = await mint('consumer-id');
  const grantKey = await mint('consumer-grant');

  // 3. connect.request — signed by our identity key
  const reqBody = { requester: { system_id: 'consumer', identity_jwk: me.pub }, capabilities: [{ capability: 'notes.read', mode: 'read' }], grantee_public: grantKey.pub, member_hint: 'mem-x', nonce: nonce() };
  const issue = await callRaw(a2a, 'connect.request', reqBody, await signPoP(me.priv, me.kid, 'connect.request', reqBody));
  assert.ok(issue.body?.grant, 'grant issued');
  const grant = issue.body.grant, token = issue.body.token;

  // 4. verify the grant, then counter-sign + confirm
  assert.ok(await verifyGrantSig(grant.signatures.grantor, idKey, grant), 'grantor signature verifies against pinned card');
  assert.equal(grant.keys.grantee_public.x, grantKey.pub.x, 'grantee key is the one we minted');
  const granteeSig = await signGrant(me.priv, me.kid, grant);
  const conf = await callRaw(a2a, 'connect.confirm', { grant_id: grant.grant_id, grantee_signature: granteeSig }, await signPoP(me.priv, me.kid, 'connect.confirm', { grant_id: grant.grant_id }));
  assert.ok(conf.body?.confirmed, 'grant in force');

  // 5. read the capability with token + per-grant proof
  const read = await callRaw(a2a, 'notes.read', {}, await signPoP(grantKey.priv, grantKey.kid, 'notes.read', {}), token);
  assert.ok(Array.isArray(read.body?.records) && read.body.records.length > 0, 'capability returned records');

  // 6. a stolen token without the proof-of-possession is useless
  const stolen = await callRaw(a2a, 'notes.read', {}, null, token);
  assert.ok(stolen.error, 'token without PoP refused');

  // 7. an unoffered capability is denied
  const denied = await callRaw(a2a, 'secrets.read', {}, await signPoP(grantKey.priv, grantKey.kid, 'secrets.read', {}), token);
  assert.ok(denied.error?.code === 'cell_denied', 'unoffered capability denied');

  console.log(`OK - connected to "${card.body.name}", read ${read.body.records.length} records; stolen-token and unoffered-capability both blocked.`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
