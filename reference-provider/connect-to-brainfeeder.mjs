#!/usr/bin/env node
/* End-to-end smoke test against the LIVE Brainfeeder provider. Fetches Brainfeeder's card, runs the
   connect handshake, then proposes a task - which must land on /connect under "Waiting for your
   approval" (propose-only: nothing auto-writes). Reuses the reference consumer crypto.
   Run:  PROVIDER=https://brainfeeder.ai node connect-to-brainfeeder.mjs */

import assert from 'node:assert/strict';
import { mint, fingerprint, signPoP, signGrant, verifyGrantSig, nonce } from './bp-crypto.mjs';

const BASE = process.env.PROVIDER || 'https://brainfeeder.ai';

async function callRaw(a2a, method, body, sig, token) {
  const headers = { 'content-type': 'application/json' };
  if (sig) headers['brain-signature'] = JSON.stringify(sig);
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(a2a, { method: 'POST', headers, body: JSON.stringify({ envelope_format: 1, protocol_version: '2.0', method, body }) });
  return res.json();
}

async function main() {
  // 1. discover + pin Brainfeeder's identity from its card
  const card = await (await fetch(`${BASE}/.well-known/brain-protocol/card.json`)).json();
  const idKey = card.body.identity_keys[0];
  const pin = fingerprint(idKey);
  const a2a = card.body.endpoints.a2a;
  console.log(`Provider: "${card.body.name}" (${card.body.system_id})`);
  console.log(`Fingerprint to pin: ${pin}`);
  console.log(`A2A endpoint: ${a2a}`);
  assert.ok(card.body.capabilities.some((c) => c.name === 'task.propose'), 'card offers task.propose');

  // 2. mint our identity + a per-grant key
  const me = await mint('smoke-consumer-id');
  const grantKey = await mint('smoke-consumer-grant');

  // 3. connect.request for task.propose (mode: propose), signed by our identity key
  const reqBody = { requester: { system_id: 'smoke-consumer', identity_jwk: me.pub }, capabilities: [{ capability: 'task.propose', mode: 'propose' }], grantee_public: grantKey.pub, member_hint: 'mem-peter', nonce: nonce() };
  const issue = await callRaw(a2a, 'connect.request', reqBody, await signPoP(me.priv, me.kid, 'connect.request', reqBody));
  assert.ok(issue.body?.grant, `grant issued (got: ${JSON.stringify(issue)})`);
  const grant = issue.body.grant, token = issue.body.token;

  // 4. verify Brainfeeder's grantor signature against the pinned card, then counter-sign + confirm
  assert.ok(await verifyGrantSig(grant.signatures.grantor, idKey, grant), 'grantor signature verifies against the pinned card');
  const granteeSig = await signGrant(me.priv, me.kid, grant);
  const conf = await callRaw(a2a, 'connect.confirm', { grant_id: grant.grant_id, grantee_signature: granteeSig }, await signPoP(me.priv, me.kid, 'connect.confirm', { grant_id: grant.grant_id }));
  assert.ok(conf.body?.confirmed, `grant in force (got: ${JSON.stringify(conf)})`);

  // 5. propose a task with token + per-grant proof - must park for a human
  const propBody = { title: 'Test task from the reference consumer', due_on: '2026-06-20', notes: 'If you can see this on /connect, the provider handshake works.' };
  const prop = await callRaw(a2a, 'task.propose', propBody, await signPoP(grantKey.priv, grantKey.kid, 'task.propose', propBody), token);
  assert.equal(prop.body?.state, 'needs_human', `proposal parked for a human (got: ${JSON.stringify(prop)})`);

  // 6. a stolen token without the proof is useless
  const stolen = await callRaw(a2a, 'task.propose', propBody, null, token);
  assert.ok(stolen.error, 'token without PoP refused');

  console.log(`\nOK - connected to Brainfeeder and proposed a task.`);
  console.log(`Action id: ${prop.body.action_id}`);
  console.log(`Now open /connect in Brainfeeder - it should be under "Waiting for your approval".`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
