// Brain Protocol v0.1 — vendored types + validators, zero dependencies. Bundled with the reference
// agent so it runs the moment you copy it, before @brainfeed/protocol is on your registry. It is a
// faithful mirror of the package; once you can `npm i @brainfeed/protocol`, replace this file with
// that import. The shapes here are the CONTRACT — do not change them. (The conformance runner
// validates against the real package, so any drift from this mirror is caught at the gate.)

export const PROTOCOL_VERSION = '0.1.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Entity {
  id: string; type: 'entity'; kind: string; name: string;
  summary?: string | null; attrs?: Record<string, unknown>;
  source: string; external_ref: string;
}
export interface Activity {
  id: string; type: 'activity'; activity_type: string; title: string;
  starts_at?: string | null; ends_at?: string | null; due_on?: string | null;
  status?: string | null; amount?: number | null; location?: string | null;
  source: string; external_ref: string;
}
export interface AgentCard {
  system_id: string; name: string; protocol_version: string; summary?: string;
  auth: { type: string; authorize_url?: string; token_url?: string; scopes?: string[] };
  capabilities: { name: string; verbs: string[] }[];
  endpoints: { a2a?: string };
}

export interface Result<T> { ok: boolean; value?: T; errors?: string[] }
const str = (v: unknown) => typeof v === 'string' && v.length > 0;

export function validateEntity(d: unknown): Result<Entity> {
  const e = d as Record<string, unknown>; const errs: string[] = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: ['not an object'] };
  if (!str(e.id) || !UUID.test(String(e.id))) errs.push('id: invalid uuid');
  if (e.type !== 'entity') errs.push('type: must be "entity"');
  if (!str(e.kind)) errs.push('kind: required');
  if (!str(e.name)) errs.push('name: required');
  if (!str(e.source)) errs.push('source: required');
  if (!str(e.external_ref)) errs.push('external_ref: required');
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: e as unknown as Entity };
}

export function validateActivity(d: unknown): Result<Activity> {
  const a = d as Record<string, unknown>; const errs: string[] = [];
  if (!a || typeof a !== 'object') return { ok: false, errors: ['not an object'] };
  if (!str(a.id) || !UUID.test(String(a.id))) errs.push('id: invalid uuid');
  if (a.type !== 'activity') errs.push('type: must be "activity"');
  if (!str(a.activity_type)) errs.push('activity_type: required');
  if (!str(a.title)) errs.push('title: required');
  if (!str(a.source)) errs.push('source: required');
  if (!str(a.external_ref)) errs.push('external_ref: required');
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: a as unknown as Activity };
}
