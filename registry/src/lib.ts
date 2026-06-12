// Registry v0 core (BP-09 §4): a signed, append-only, hash-chained event log over conformance
// attestations. The registry records what systems attest; it observes nothing (CD-3). Current
// state is a fold of the events. History is append-only — a status change is a new event, never
// an overwrite — and each event is hash-chained to its predecessor and signed by the registry key.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { FlattenedSign, flattenedVerify, importJWK, type JWK } from 'jose';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_DIR = join(here, '..');
export const SCHEMA_DIR = join(REGISTRY_DIR, '..', 'schemas');

export type RegistryEntry = Record<string, unknown> & { system_id: string; status: string };

export interface RegistryEvent {
  seq: number;
  at: string;
  type: 'register' | 'status' | 'revoke';
  /** a full entry for 'register'; a partial patch (system_id + changed fields) for status/revoke. */
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  sig: unknown; // flattened JWS over `hash`, by the registry key
}

export interface RegistryFile {
  registry_format: 1;
  registry_key: JWK;
  events: RegistryEvent[];
}

// RFC 8785-style canonical JSON (sorted keys, omit undefined) — the signing/hashing input.
export function canonical(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return JSON.stringify(v);
  if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  throw new Error('canonical: bad type');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** The hash binds seq, time, type, payload and the prior hash — the chain link. */
export function eventHash(e: Omit<RegistryEvent, 'hash' | 'sig'>): string {
  return sha256(canonical({ seq: e.seq, at: e.at, type: e.type, payload: e.payload, prev_hash: e.prev_hash }));
}

export async function signHash(hash: string, privateJwk: JWK): Promise<unknown> {
  const key = await importJWK(privateJwk, 'EdDSA');
  return new FlattenedSign(new TextEncoder().encode(hash)).setProtectedHeader({ alg: 'EdDSA' }).sign(key);
}

export async function verifyEventSig(e: RegistryEvent, publicJwk: JWK): Promise<boolean> {
  try {
    const key = await importJWK(publicJwk, 'EdDSA');
    const { payload } = await flattenedVerify(e.sig as any, key);
    return new TextDecoder().decode(payload) === e.hash;
  } catch {
    return false;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const entrySchema = JSON.parse(readFileSync(join(SCHEMA_DIR, 'registry-entry.schema.json'), 'utf8'));
const validateEntry = ajv.compile(entrySchema);

export function entryErrors(entry: unknown): string[] {
  return validateEntry(entry) ? [] : (validateEntry.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

/** Fold the event log into the current set of entries (keyed by system_id). */
export function foldEntries(events: RegistryEvent[]): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>();
  for (const e of events) {
    const sid = e.payload.system_id as string;
    if (e.type === 'register') out.set(sid, e.payload as RegistryEntry);
    else { const cur = out.get(sid); if (cur) out.set(sid, { ...cur, ...e.payload } as RegistryEntry); }
  }
  return out;
}

/** Verify the entire registry: chain linkage, per-event hash + signature, and that every folded
 *  entry validates against the entry schema. Returns the list of problems (empty = sound). */
export async function verifyRegistry(reg: RegistryFile): Promise<string[]> {
  const problems: string[] = [];
  let prev = '';
  for (let i = 0; i < reg.events.length; i++) {
    const e = reg.events[i];
    if (e.seq !== i) problems.push(`event ${i}: seq ${e.seq} out of order`);
    if (e.prev_hash !== prev) problems.push(`event ${i}: prev_hash breaks the chain`);
    if (eventHash(e) !== e.hash) problems.push(`event ${i}: hash does not match its content (tampered)`);
    if (!(await verifyEventSig(e, reg.registry_key))) problems.push(`event ${i}: signature invalid`);
    prev = e.hash;
  }
  for (const [sid, entry] of foldEntries(reg.events)) {
    const errs = entryErrors(entry);
    if (errs.length) problems.push(`entry ${sid}: ${errs.join('; ')}`);
    // CD-2 invariant: any S2 capability requires verified certification.
    if (Array.isArray((entry as any).s2_capabilities) && (entry as any).s2_capabilities.length &&
        (entry as any).certification?.tier !== 'verified') {
      problems.push(`entry ${sid}: offers S2 capabilities but is not verified-certified (CD-2)`);
    }
  }
  return problems;
}

export function loadRegistry(path = join(REGISTRY_DIR, 'registry.json')): RegistryFile {
  return JSON.parse(readFileSync(path, 'utf8')) as RegistryFile;
}
