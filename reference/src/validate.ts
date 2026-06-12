// The reference pipe's own boundary validator (BP-09 §1 layer 3: every receiver validates
// every inbound object against the canonical schemas at its boundary, regardless of what a
// peer's certificate claims). Independent of the kit — a partner cloning reference/ gets a
// self-contained pipe — but reads the same canonical schemas/ the kit does.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(here, '..', '..', 'schemas');
const load = (n: string) => JSON.parse(readFileSync(join(SCHEMA_DIR, n), 'utf8'));

export const VOCAB = load('vocabulary.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const envelope = load('envelope.schema.json');
for (const s of ['action.schema.json', 'agent-card.schema.json', 'grant.schema.json', 'forget-receipt.schema.json'].map(load)) {
  if (!ajv.getSchema(s.$id)) ajv.addSchema(s);
}
ajv.addSchema(envelope);
const vEnvelope = ajv.getSchema(envelope.$id)!;

const URN = /^urn:brain:([a-z0-9][a-z0-9-]{0,63}):(entity|activity|edge|action):[0-9a-f-]{36}$/;

export interface Rejection { reasons: string[]; }

function reasons(errs: ErrorObject[] | null | undefined): string[] {
  return (errs ?? []).map((e) => {
    const p = e.instancePath || '(root)';
    if (e.keyword === 'required') return `${p} missing required field: ${(e.params as any).missingProperty}`;
    if (e.keyword === 'enum') return `${p} not in ${JSON.stringify((e.params as any).allowedValues)}`;
    return `${p} ${e.message ?? 'invalid'}`;
  });
}

/** Validate a record against BP-01: schema plus the cross-field rules a single-record schema
 *  cannot express. Returns the list of reasons; empty means valid. */
export function validateRecord(rec: Record<string, unknown>): string[] {
  const ok = vEnvelope(rec) as boolean;
  const out = ok ? [] : reasons(vEnvelope.errors);
  const id = typeof rec.id === 'string' ? rec.id : undefined;
  if (id && typeof rec.type === 'string') {
    const m = URN.exec(id);
    if (m && m[2] !== rec.type) out.push(`/id urn rtype '${m[2]}' contradicts type '${rec.type}' (BP-01 §4)`);
    if (m && typeof rec.source === 'string' && !['manual', 'derived', 'agent-inference'].includes(rec.source) && m[1] !== rec.source)
      out.push(`/id urn system '${m[1]}' contradicts source '${rec.source}' (BP-01 §4)`);
  }
  const iv = rec.interval as { start?: string } | undefined;
  if (iv?.start && rec.valid_time !== iv.start) out.push('/interval.start must equal /valid_time (BP-01 §6)');
  for (const [k, v] of Object.entries(rec)) if (v === null) out.push(`/${k} is null — omit, never null (BP-01 §14)`);
  if ((rec.source === 'derived' || rec.source === 'agent-inference') && !(Array.isArray(rec.provenance) && rec.provenance.length))
    out.push('/provenance required on derived records (BP-01 §5.2)');
  return out;
}

export function isRegisteredScope(scope: string): boolean {
  return VOCAB.visibility?.registered_scopes?.some((r: any) => r.scope === scope) ?? false;
}

const BASE_SUBTYPES: Set<string> = new Set([
  ...VOCAB.entity_subtypes, ...VOCAB.activity_subtypes, ...VOCAB.edge_predicates,
]);
export function isBaseSubtype(s: string): boolean { return BASE_SUBTYPES.has(s); }
