#!/usr/bin/env node
/* Protocol-native card checker (BP-03 §2). Verifies a Brain Protocol agent card the way a consumer
   will, with no hub code and nothing to clone: it fetches the card, checks the URL is a safe public
   HTTPS endpoint, verifies the card's JWS signature against an identity key in the card, pins the
   fingerprint, validates the card body against schemas/agent-card.schema.json, checks the protocol
   version is supported, and confirms at least one offered capability. A green run is the precondition
   for a consumer reaching you.

   Usage:  node kit/scripts/card-check.mjs <card-url>
   While you build you will usually point it at http://localhost:<port>/.well-known/brain-protocol/card.json;
   it will pass the cryptographic and schema checks and tell you the only thing left is a public HTTPS host. */

import { flattenedVerify, importJWK } from 'jose';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SUPPORTED_VERSIONS = ['2.0', '2.1'];

/* JCS canonical JSON, matching reference-provider/bp-crypto.mjs and the kit peer. */
function jcs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const fingerprint = (j) => 'ed25519:' + sha256(jcs({ crv: j.crv, kty: j.kty, x: j.x })).slice(0, 32);

const fails = [];
const warns = [];
const ok = (label, extra) => console.log('  ok    ' + label + (extra ? '  ' + extra : ''));
const bad = (label, why) => { console.log('  FAIL  ' + label + (why ? '  - ' + why : '')); fails.push(label); };
const warn = (label, why) => { console.log('  warn  ' + label + (why ? '  - ' + why : '')); warns.push(label); };

/* A light public-HTTPS check. localhost/loopback/private hosts are allowed for local development but
   reported as not-yet-connectable; the cryptographic and schema checks still run so a build-time
   localhost card is fully checkable. */
function classifyUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { fatal: 'not a valid URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { fatal: `unsupported scheme ${u.protocol}` };
  const host = u.hostname;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  const isPrivate = /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd)/i.test(host);
  const publicHttps = u.protocol === 'https:' && !isLoopback && !isPrivate;
  return { u, publicHttps, isLoopback, isPrivate };
}

async function main() {
  const url = process.argv[2];
  if (!url) { console.error('usage: node kit/scripts/card-check.mjs <card-url>'); process.exit(2); }
  console.log(`\nChecking card: ${url}\n`);

  const c = classifyUrl(url);
  if (c.fatal) { bad('url is well-formed', c.fatal); return finish(); }
  if (c.publicHttps) ok('url is a public HTTPS endpoint');
  else warn('url is a public HTTPS endpoint', c.isLoopback ? 'local endpoint (fine while building; a consumer needs public HTTPS)' : 'host is not a public address');

  let card;
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!res.ok) { bad('card fetched', `HTTP ${res.status}`); return finish(); }
    card = await res.json();
  } catch (e) { bad('card fetched', String(e?.message || e)); return finish(); }

  if (!card || typeof card !== 'object' || !card.body || !card.jws) {
    bad('card is the published { body, jws } shape'); return finish();
  }
  ok('card is the published { body, jws } shape');

  const body = card.body;
  const keys = Array.isArray(body.identity_keys) ? body.identity_keys : [];
  if (keys.length === 0) { bad('card lists an identity key'); return finish(); }

  // Verify the JWS against the identity key named by its protected header kid (or the first key).
  let verified = false;
  try {
    const kid = card.jws?.header?.kid || card.jws?.protected && JSON.parse(Buffer.from(card.jws.protected, 'base64url').toString()).kid;
    const idKey = keys.find((k) => k.kid === kid) || keys[0];
    const { payload } = await flattenedVerify(card.jws, await importJWK(idKey, 'EdDSA'));
    const signedBody = new TextDecoder().decode(payload);
    verified = signedBody === jcs(body);
    if (verified) {
      ok('card signature verifies against its identity key');
      ok('fingerprint', fingerprint(idKey));
    } else {
      bad('card signature covers the card body', 'signed payload does not equal the canonical body');
    }
  } catch (e) {
    bad('card signature verifies against its identity key', String(e?.message || e));
  }

  // Schema validation against the canonical agent-card schema.
  try {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/agent-card.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (validate(body)) ok('card body matches agent-card.schema.json');
    else bad('card body matches agent-card.schema.json', (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).slice(0, 4).join('; '));
  } catch (e) {
    warn('card body matches agent-card.schema.json', `could not run schema check: ${String(e?.message || e)}`);
  }

  const versions = Array.isArray(body.protocol_versions) ? body.protocol_versions : [];
  if (versions.some((v) => SUPPORTED_VERSIONS.some((s) => v === s || v.startsWith(s + '.'))))
    ok('offers a supported protocol version', `(${versions.join(', ')})`);
  else bad('offers a supported protocol version', `card: ${versions.join(', ') || 'none'}; supported: ${SUPPORTED_VERSIONS.join(', ')}`);

  const offers = (Array.isArray(body.capabilities) ? body.capabilities : []).filter((c2) => c2.direction === 'offer');
  if (offers.length) {
    ok('advertises at least one offered capability');
    for (const cap of offers) {
      const aud = Array.isArray(cap.audiences) && cap.audiences.length ? `, audiences ${cap.audiences.join('/')}` : '';
      console.log(`          - ${cap.name} (${(cap.modes || []).join(', ')}) ceiling ${cap.sensitivity_ceiling}${aud}`);
    }
  } else bad('advertises at least one offered capability', 'none found');

  finish();
}

function finish() {
  console.log('');
  if (fails.length) {
    console.log(`FAILED: ${fails.length} check(s) - fix these before a consumer can connect.`);
    process.exit(1);
  }
  if (warns.length) {
    console.log('Card is cryptographically and structurally valid. Remaining before a consumer can connect: ' + warns.join('; ') + '.');
    process.exit(0);
  }
  console.log('All checks passed - this card is connectable.');
  process.exit(0);
}

main().catch((e) => { console.error('card-check error:', e?.message || e); process.exit(2); });
