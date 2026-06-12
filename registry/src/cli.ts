// brain-registry — tooling for the conformance registry v0 (BP-09 §4).
//
//   keygen                       mint the registry Ed25519 key (public committed, private kept by the maintainer)
//   register <entry.json>        append a signed 'register' event for a system, validated against the schema
//   status <system_id> <status>  append a signed status change (active|suspended|revoked) — never overwrites
//   verify                       verify the whole chain (hash links, signatures, schema, CD-2) — CI gate
//   show                         print the current folded entries
//
// The private key is required only for register/status/keygen; verify and show need only the
// public key embedded in registry.json (anyone can verify the registry; only the maintainer signs).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, type JWK } from 'jose';
import {
  REGISTRY_DIR, canonical, eventHash, signHash, entryErrors, foldEntries, verifyRegistry,
  loadRegistry, type RegistryEvent, type RegistryFile,
} from './lib.js';

const REG_PATH = join(REGISTRY_DIR, 'registry.json');
const KEYS_DIR = join(REGISTRY_DIR, 'keys');
const PUB_PATH = join(KEYS_DIR, 'registry-key.pub.json');
const PRIV_PATH = process.env.BRAIN_REGISTRY_KEY ?? join(KEYS_DIR, 'registry-key.priv.json');

async function keygen(): Promise<void> {
  if (existsSync(PUB_PATH)) { console.error('refusing to overwrite an existing registry key'); process.exit(2); }
  mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const pub = { ...(await exportJWK(publicKey)), use: 'sig', kid: 'registry-1' };
  const priv = { ...(await exportJWK(privateKey)), use: 'sig', kid: 'registry-1' };
  writeFileSync(PUB_PATH, JSON.stringify(pub, null, 2) + '\n');
  writeFileSync(PRIV_PATH, JSON.stringify(priv, null, 2) + '\n');
  console.log(`registry key minted.\n  public  (commit this):   ${PUB_PATH}\n  private (keep secret):    ${PRIV_PATH}`);
  console.log('IMPORTANT: the private key must NOT be committed (registry/keys/.gitignore covers it). Custody is the maintainer\'s.');
}

function readKey(path: string): JWK { return JSON.parse(readFileSync(path, 'utf8')) as JWK; }

function emptyRegistry(): RegistryFile {
  return { registry_format: 1, registry_key: readKey(PUB_PATH), events: [] };
}

async function appendEvent(type: RegistryEvent['type'], payload: Record<string, unknown>): Promise<void> {
  if (!existsSync(PRIV_PATH)) { console.error(`registry private key not found at ${PRIV_PATH}\nrun "keygen" first, or set BRAIN_REGISTRY_KEY`); process.exit(2); }
  const reg = existsSync(REG_PATH) ? loadRegistry(REG_PATH) : emptyRegistry();
  const prev = reg.events.length ? reg.events[reg.events.length - 1].hash : '';
  const base = { seq: reg.events.length, at: new Date().toISOString(), type, payload, prev_hash: prev };
  const hash = eventHash(base);
  const sig = await signHash(hash, readKey(PRIV_PATH));
  reg.events.push({ ...base, hash, sig });
  // re-verify before writing — never persist a registry that wouldn't verify.
  const problems = await verifyRegistry(reg);
  if (problems.length) { console.error('refusing to write — registry would not verify:\n  ' + problems.join('\n  ')); process.exit(1); }
  writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + '\n');
  console.log(`appended ${type} event for ${payload.system_id} (seq ${base.seq}).`);
}

async function register(entryPath: string): Promise<void> {
  const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
  const errs = entryErrors(entry);
  if (errs.length) { console.error('entry does not validate against registry-entry.schema.json:\n  ' + errs.join('\n  ')); process.exit(1); }
  await appendEvent('register', entry);
}

async function status(systemId: string, newStatus: string): Promise<void> {
  if (!['active', 'suspended', 'revoked'].includes(newStatus)) { console.error('status must be active|suspended|revoked'); process.exit(2); }
  const payload: Record<string, unknown> = { system_id: systemId, status: newStatus };
  if (newStatus === 'revoked') payload.revocation = { at: new Date().toISOString().slice(0, 10), reason: process.env.REASON ?? 'unspecified', evidence_url: process.env.EVIDENCE_URL ?? null, appeal: null };
  await appendEvent(newStatus === 'revoked' ? 'revoke' : 'status', payload);
}

async function verify(): Promise<void> {
  if (!existsSync(REG_PATH)) { console.log('no registry yet (registry.json absent) — nothing to verify'); return; }
  const problems = await verifyRegistry(loadRegistry(REG_PATH));
  if (problems.length) { console.error('REGISTRY INVALID:\n  ' + problems.join('\n  ')); process.exit(1); }
  const n = foldEntries(loadRegistry(REG_PATH).events).size;
  console.log(`registry OK — chain intact, all signatures valid, ${n} entr${n === 1 ? 'y' : 'ies'} schema-valid.`);
}

function show(): void {
  if (!existsSync(REG_PATH)) { console.log('(no registry yet)'); return; }
  for (const [, e] of foldEntries(loadRegistry(REG_PATH).events)) console.log(canonical(e));
}

const [cmd, ...rest] = process.argv.slice(2);
const run = async () => {
  switch (cmd) {
    case 'keygen': return keygen();
    case 'register': return register(rest[0]);
    case 'status': return status(rest[0], rest[1]);
    case 'verify': return verify();
    case 'show': return show();
    default: console.error('usage: brain-registry keygen | register <entry.json> | status <id> <active|suspended|revoked> | verify | show'); process.exit(2);
  }
};
run().catch((e) => { console.error(e); process.exit(2); });
