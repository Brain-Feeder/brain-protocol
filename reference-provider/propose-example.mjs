#!/usr/bin/env node
/* Worked PROPOSE (write-back) example for the reference provider. It connects, proposes a task, and
   shows the full propose-only path: the task parks as a `proposed` Action (nothing auto-executes), a
   stolen token cannot propose, a tampered confirm is rejected by hash binding, and only the human
   operator confirming the exact proposed payload executes it (BP-04 §5, BP-08).
   Run with the server up:  node server.mjs &   then   node propose-example.mjs */

import assert from 'node:assert/strict';
import { mint, signPoP, signGrant, nonce } from './bp-crypto.mjs';

const BASE = process.env.PROVIDER || 'http://localhost:8400';
const OPERATOR_TOKEN = process.env.OPERATOR_TOKEN || 'reference-operator';

async function call(a2a, method, body, sig, token) {
  const headers = { 'content-type': 'application/json' };
  if (sig) headers['brain-signature'] = JSON.stringify(sig);
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(a2a, { method: 'POST', headers, body: JSON.stringify({ envelope_format: 1, protocol_version: '2.0', method, body }) });
  return res.json();
}
async function operator(action_id, payload_hash, decision) {
  const res = await fetch(`${BASE}/operator/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator-token': OPERATOR_TOKEN },
    body: JSON.stringify({ action_id, payload_hash, decision }),
  });
  return res.json();
}

async function main() {
  // 1. discover the provider and confirm it offers the propose capability
  const card = await (await fetch(`${BASE}/.well-known/brain-protocol/card.json`)).json();
  const a2a = card.body.endpoints.a2a;
  assert.ok(card.body.capabilities.find((c) => c.name === 'task.propose'), 'provider offers task.propose');

  // 2. connect for task.propose
  const me = await mint('consumer-id');
  const grantKey = await mint('consumer-grant');
  const reqBody = { requester: { system_id: 'propose-consumer', identity_jwk: me.pub }, capabilities: [{ capability: 'task.propose', mode: 'propose' }], grantee_public: grantKey.pub, member_hint: 'mem-x', nonce: nonce() };
  const issue = await call(a2a, 'connect.request', reqBody, await signPoP(me.priv, me.kid, 'connect.request', reqBody));
  const grant = issue.body.grant, token = issue.body.token;
  const granteeSig = await signGrant(me.priv, me.kid, grant);
  const conf = await call(a2a, 'connect.confirm', { grant_id: grant.grant_id, grantee_signature: granteeSig }, await signPoP(me.priv, me.kid, 'connect.confirm', { grant_id: grant.grant_id }));
  assert.ok(conf.body?.confirmed, 'grant in force');

  // 3. propose a task; it parks as a proposed Action and does NOT execute
  const payload = { title: 'Draft show notes for episode 642', due_on: '2026-07-01' };
  const proposed = await call(a2a, 'task.propose', { payload }, await signPoP(grantKey.priv, grantKey.kid, 'task.propose', { payload }), token);
  assert.equal(proposed.body?.action?.state, 'proposed', 'task parks as a proposed Action (not executed)');
  const { id: actionId, payload_hash } = proposed.body.action;

  // 4. a stolen token without the per-grant proof cannot propose
  const stolen = await call(a2a, 'task.propose', { payload }, null, token);
  assert.ok(stolen.error, 'propose without proof-of-possession refused');

  // 5. a tampered confirm (wrong hash) is rejected by the gate's hash binding
  const bad = await operator(actionId, 'sha256:deadbeef');
  assert.equal(bad.error?.code, 'payload_mismatch', 'tampered confirm rejected (hash binding)');

  // 6. the human operator confirms the exact proposed payload; only now does it execute
  const okc = await operator(actionId, payload_hash);
  assert.equal(okc.action?.state, 'executed', 'operator confirm executes the bound payload');

  console.log(`OK - proposed "${payload.title}" as ${actionId} (state proposed); stolen-token blocked, tampered confirm rejected, operator confirm executed.`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
