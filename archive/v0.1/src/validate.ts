// Validators + version/capability negotiation. Systems call validate*() at their boundary
// (BRAIN_PROTOCOL.md §9.3) and negotiate() on handshake (§8).
import { z } from 'zod';
import {
  Entity, Activity, Edge, Action, AgentCard, MigrationDescriptor, PROTOCOL_VERSION,
} from './schema.js';
import type { AgentCard as AgentCardT, Capability } from './types.js';

export interface ValidationResult<T> { ok: boolean; value?: T; errors?: string[] }

function check<S extends z.ZodTypeAny>(schema: S, data: unknown): ValidationResult<z.infer<S>> {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

export const validateEntity = (d: unknown) => check(Entity, d);
export const validateActivity = (d: unknown) => check(Activity, d);
export const validateEdge = (d: unknown) => check(Edge, d);
export const validateAction = (d: unknown) => check(Action, d);
export const validateAgentCard = (d: unknown) => check(AgentCard, d);
export const validateMigration = (d: unknown) => check(MigrationDescriptor, d);

const major = (v: string) => Number(v.split('.')[0]);
const lower = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] < pb[i] ? a : b; }
  return a;
};

export interface Negotiation { compatible: boolean; version: string; capabilities: string[]; reason?: string }

/** On handshake: operate at the highest COMMON version (same major) and the intersection of
 *  capabilities. Different majors are incompatible (BRAIN_PROTOCOL.md §7–8). */
export function negotiate(localVersion: string, localCapabilities: string[], remote: AgentCardT): Negotiation {
  if (major(localVersion) !== major(remote.protocol_version)) {
    return { compatible: false, version: localVersion, capabilities: [], reason: 'major version mismatch' };
  }
  const remoteCaps = remote.capabilities.map((c: Capability) => c.name);
  const capabilities = localCapabilities.filter(c => remoteCaps.includes(c));
  return { compatible: true, version: lower(localVersion, remote.protocol_version), capabilities };
}

/** Upgrade gate (BRAIN_PROTOCOL.md §13): additive may auto-adopt, breaking needs a human. */
export const canAutoAdopt = (m: z.infer<typeof MigrationDescriptor>) => m.compatibility === 'additive';

export { PROTOCOL_VERSION };
