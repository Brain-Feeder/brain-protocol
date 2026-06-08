// Brain Protocol v0.1 — the shared vocabulary as Zod schemas (single source for types +
// runtime validation). Implements BRAIN_PROTOCOL.md §2–4. Forward-compatible: unknown fields
// are passed through (`.passthrough()`), unknown kinds/predicates are accepted as free strings.
import { z } from 'zod';

export const PROTOCOL_VERSION = '0.1.0';

export const Visibility = z.enum(['private', 'partners', 'adults', 'everyone']);

export const NodeRef = z.object({
  type: z.enum(['entity', 'activity']),
  id: z.string().uuid(),
});

// kinds/predicates/types are a known *core* set but extensible — accept any string so a newer
// system's new kind doesn't break an older receiver (BRAIN_PROTOCOL.md §7 forward-compat rule).
export const Entity = z.object({
  id: z.string().uuid(),
  type: z.literal('entity'),
  kind: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().nullish(),
  attrs: z.record(z.unknown()).default({}),
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  source: z.string().min(1),
  external_ref: z.string().min(1),
}).passthrough();

export const Activity = z.object({
  id: z.string().uuid(),
  type: z.literal('activity'),
  activity_type: z.string().min(1),
  title: z.string().min(1),
  starts_at: z.string().nullish(),
  ends_at: z.string().nullish(),
  due_on: z.string().nullish(),
  status: z.string().nullish(),
  amount: z.number().nullish(),
  location: z.string().nullish(),
  source: z.string().min(1),
  external_ref: z.string().min(1),
}).passthrough();

export const Edge = z.object({
  id: z.string().uuid(),
  subject: NodeRef,
  predicate: z.string().min(1),
  object: NodeRef,
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  source: z.string().min(1),
}).passthrough();

export const Action = z.object({
  id: z.string().uuid(),
  type: z.enum(['pay', 'book', 'renew', 'send', 'switch', 'update']),
  summary: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  requires_confirm: z.boolean(),
  status: z.enum(['proposed', 'confirmed', 'executed', 'declined']),
}).passthrough();

export const CoreCapabilities = ['calendar', 'tasks', 'presence', 'projects', 'finance', 'documents', 'contacts'] as const;
export const Verb = z.enum(['read', 'query', 'subscribe', 'act']);

export const Capability = z.object({
  name: z.string().min(1),          // core set in CoreCapabilities, but extensible
  verbs: z.array(Verb).min(1),
}).passthrough();

export const AgentCard = z.object({
  system_id: z.string().min(1),
  name: z.string().min(1),
  protocol_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  auth: z.object({
    type: z.string().min(1),         // 'oauth2.1' etc.
    authorize_url: z.string().url().optional(),
    token_url: z.string().url().optional(),
    scopes: z.array(z.string()).default([]),
  }).passthrough(),
  capabilities: z.array(Capability),
  endpoints: z.object({
    a2a: z.string().url().optional(),
    mcp: z.string().url().optional(),
  }).passthrough(),
}).passthrough();

// upgrade distribution (BRAIN_PROTOCOL.md §13) — what a release event carries
export const MigrationDescriptor = z.object({
  from_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  to_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  compatibility: z.enum(['additive', 'breaking']),
  added: z.array(z.string()).default([]),
  deprecated: z.array(z.string()).default([]),
  migration_window_days: z.number().int().nonnegative().optional(),
  changelog_url: z.string().url().optional(),
}).passthrough();
