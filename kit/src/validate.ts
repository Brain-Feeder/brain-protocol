// The boundary validator, built from the canonical schemas in schemas/ (BP-01).
//
// This is the kit's reference implementation of "validate every inbound object against
// the schemas at its boundary" (BP-09 §1, layer 3). The reference pipe reuses the same
// schemas, so a record the kit calls invalid is invalid for the system too. The ENV suite
// drives this validator (directly, and via the adapter's seed path) to prove the boundary
// rejects malformed envelopes and accepts valid ones, naming the failing field (T-ENV-01..).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { BrainRecord } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
// kit/src -> repo root /schemas
const SCHEMA_DIR = join(here, '..', '..', 'schemas');

function loadSchema(name: string): any {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'));
}

export const VOCABULARY = loadSchema('vocabulary.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Register all schemas so $ref between them resolves (action.schema.json $refs envelope).
const envelopeSchema = loadSchema('envelope.schema.json');
const actionSchema = loadSchema('action.schema.json');
const agentCardSchema = loadSchema('agent-card.schema.json');
const grantSchema = loadSchema('grant.schema.json');
const forgetReceiptSchema = loadSchema('forget-receipt.schema.json');

for (const s of [envelopeSchema, actionSchema, agentCardSchema, grantSchema, forgetReceiptSchema]) {
  if (!ajv.getSchema(s.$id)) ajv.addSchema(s);
}

const validateEnvelope = ajv.getSchema(envelopeSchema.$id)!;
const validateCard = ajv.getSchema(agentCardSchema.$id)!;
const validateGrant = ajv.getSchema(grantSchema.$id)!;
const validateReceipt = ajv.getSchema(forgetReceiptSchema.$id)!;

export interface ValidationResult {
  valid: boolean;
  /** field-naming reasons (e.g. "/owner missing required property 'owner'"). */
  reasons: string[];
}

function reasonsFrom(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  const out: string[] = [];
  for (const e of errors) {
    const path = e.instancePath || '(root)';
    if (e.keyword === 'required') {
      out.push(`${path} missing required field: ${(e.params as any).missingProperty}`);
    } else if (e.keyword === 'enum') {
      out.push(`${path} not one of ${JSON.stringify((e.params as any).allowedValues)}`);
    } else if (e.keyword === 'pattern') {
      out.push(`${path} does not match required pattern`);
    } else if (e.keyword === 'const') {
      out.push(`${path} must be ${JSON.stringify((e.params as any).allowedValue)}`);
    } else {
      out.push(`${path} ${e.message ?? 'invalid'}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-field rules the JSON Schema cannot express on a single record (BP-01).
// These make the boundary validator faithful to the spec, not just the schema.
// ---------------------------------------------------------------------------

const URN_RE = /^urn:brain:([a-z0-9][a-z0-9-]{0,63}):(entity|activity|edge|action):[0-9a-f-]{36}$/;

function semanticReasons(rec: BrainRecord): string[] {
  const out: string[] = [];
  const id = typeof rec.id === 'string' ? rec.id : undefined;
  const type = rec.type;

  // URN rtype segment MUST equal type (BP-01 §4).
  if (id && typeof type === 'string') {
    const m = URN_RE.exec(id);
    if (m && m[2] !== type) {
      out.push(`/id urn rtype segment '${m[2]}' contradicts type '${type}' (BP-01 §4)`);
    }
    // URN system segment MUST equal source where source names a system (BP-01 §4).
    if (m && typeof rec.source === 'string') {
      const methodValues = new Set(['manual', 'derived', 'agent-inference']);
      if (!methodValues.has(rec.source) && m[1] !== rec.source) {
        out.push(`/id urn system segment '${m[1]}' contradicts source '${rec.source}' (BP-01 §4)`);
      }
    }
  }

  // interval.start MUST equal valid_time when interval present (BP-01 §6).
  const interval = rec.interval as { start?: string } | undefined;
  if (interval && typeof interval.start === 'string' && rec.valid_time !== interval.start) {
    out.push(`/interval.start must equal /valid_time (BP-01 §6)`);
  }

  // null is not a permitted value for any envelope field (BP-01 §14).
  for (const [k, v] of Object.entries(rec)) {
    if (v === null) out.push(`/${k} is null — absent optional fields are omitted, never null (BP-01 §14)`);
  }

  // Derived/inferred records MUST carry provenance (BP-01 §5.2). If source is a derivation
  // method, provenance is required.
  if ((rec.source === 'derived' || rec.source === 'agent-inference') &&
      (!Array.isArray(rec.provenance) || rec.provenance.length === 0)) {
    out.push(`/provenance required on derived/inferred records (BP-01 §5.2)`);
  }

  // confidence MUST be present on derived/inferred records (BP-01 §5.5); MUST NOT be 1.0.
  if (typeof rec.confidence === 'number' && rec.confidence >= 1) {
    out.push(`/confidence must be < 1 — omit the field to assert as fact (BP-01 §5.5)`);
  }

  return out;
}

/** Validate a record against the BP-01 envelope schema plus cross-field semantic rules. */
export function validateRecord(rec: BrainRecord): ValidationResult {
  const schemaOk = validateEnvelope(rec) as boolean;
  const reasons = reasonsFrom(validateEnvelope.errors).concat(semanticReasons(rec));
  return { valid: schemaOk && reasons.length === 0, reasons };
}

export function validateAgentCard(card: unknown): ValidationResult {
  const ok = validateCard(card) as boolean;
  return { valid: ok, reasons: reasonsFrom(validateCard.errors) };
}

export function validateGrantDoc(grant: unknown): ValidationResult {
  const ok = validateGrant(grant) as boolean;
  return { valid: ok, reasons: reasonsFrom(validateGrant.errors) };
}

export function validateForgetReceipt(receipt: unknown): ValidationResult {
  const ok = validateReceipt(receipt) as boolean;
  return { valid: ok, reasons: reasonsFrom(validateReceipt.errors) };
}

/** Is this subtype/predicate a known base-vocabulary term? (BP-01 §10) */
export function isKnownTerm(field: 'subtype' | 'state' | 'edge', term: string): boolean {
  if (field === 'subtype') {
    return (
      VOCABULARY.entity_subtypes.includes(term) ||
      VOCABULARY.activity_subtypes.includes(term)
    );
  }
  if (field === 'edge') return VOCABULARY.edge_predicates.includes(term);
  return false;
}

/** The registered visibility scopes (BP-01 §8). Anything else lands as private. */
export function isRegisteredScope(scope: string): boolean {
  return VOCABULARY.visibility?.registered_scopes?.some((r: any) => r.scope === scope) ?? false;
}
